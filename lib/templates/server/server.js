'use strict';

const { createServer } = require('dywo-cli/lib/server');
const config = require('./dywo.server');
const apiRoutes = require('./routes/api');
const authMiddleware = require('./middleware/auth');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = createServer({
  port: config.port,
  host: config.host
});

// ── Database ────────────────────────────────────────────────────────────────

const dbPath = path.resolve(config.database.path);
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

let db;
try {
  const Database = require('better-sqlite3');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
} catch (e) {
  db = {
    _store: {},
    prepare(stmt) {
      return {
        run(...args) { return { changes: 0, lastInsertRowid: 0 }; },
        get(...args) { return undefined; },
        all(...args) { return []; }
      };
    },
    exec(sql) {},
    transaction(fn) { return fn; }
  };
  console.log('[DYWO] better-sqlite3 not found — using in-memory stub');
}

app.db = db;

// ── Middleware ───────────────────────────────────────────────────────────────

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
  });
  next();
});

app.use((req, res, next) => {
  const cors = config.middleware.cors;
  if (cors) {
    res.setHeader('Access-Control-Allow-Origin', cors.origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  next();
});

let rateLimitStore = {};
app.use((req, res, next) => {
  const rl = config.middleware.rateLimit;
  if (!rl) return next();
  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  if (!rateLimitStore[ip]) rateLimitStore[ip] = [];
  rateLimitStore[ip] = rateLimitStore[ip].filter(t => now - t < rl.windowMs);
  if (rateLimitStore[ip].length >= rl.max) {
    res.status(429).json({ error: 'Too many requests' });
    return;
  }
  rateLimitStore[ip].push(now);
  next();
});

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

app.authMiddleware = authMiddleware;
app.authConfig = config.middleware.auth;
app.jwtSecret = config.middleware.auth.secret;

// ── Health Check ────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: require('./package.json').version
  });
});

// ── Auth Routes ─────────────────────────────────────────────────────────────

app.post('/auth/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(409).json({ error: 'Username already taken' });
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');

  const result = db.prepare(
    'INSERT INTO users (username, password_hash, salt, created_at) VALUES (?, ?, ?, ?)'
  ).run(username, hash, salt, new Date().toISOString());

  res.status(201).json({ id: result.lastInsertRowid, username });
});

app.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const hash = crypto.pbkdf2Sync(password, user.salt, 10000, 64, 'sha512').toString('hex');
  if (hash !== user.password_hash) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const payload = `${user.id}:${user.username}:${Date.now()}`;
  const signature = crypto.createHmac('sha256', config.middleware.auth.secret)
    .update(payload)
    .digest('hex');
  const token = Buffer.from(`${payload}:${signature}`).toString('base64');

  res.json({ token, user: { id: user.id, username: user.username } });
});

// ── API Routes ──────────────────────────────────────────────────────────────

apiRoutes(app);

// ── Error Handler ───────────────────────────────────────────────────────────

app.onError((err, req, res) => {
  console.error('[DYWO-Server] Error:', err.message);
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// ── Start ───────────────────────────────────────────────────────────────────

app.listen(config.port, config.host, () => {
  console.log(`[DYWO] Server ready at http://${config.host}:${config.port}`);
  console.log(`[DYWO] Health check: http://${config.host}:${config.port}/health`);
});

module.exports = app;
