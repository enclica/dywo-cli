'use strict';

const path = require('path');
const fs = require('fs');

function _readServerSources(projectRoot, config) {
  const serverDir = config.serverDir
    ? path.resolve(projectRoot, config.serverDir)
    : path.resolve(projectRoot, 'server', 'src');

  const sources = {};

  if (fs.existsSync(serverDir)) {
    _walkDir(serverDir, serverDir, sources);
  }

  const entryFile = config.serverEntry
    ? path.resolve(projectRoot, config.serverEntry)
    : path.resolve(serverDir, 'index.js');

  if (fs.existsSync(entryFile)) {
    sources['index.js'] = fs.readFileSync(entryFile, 'utf8');
  }

  return sources;
}

function _walkDir(baseDir, currentDir, sources) {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      _walkDir(baseDir, fullPath, sources);
    } else if (/\.(js|json)$/.test(entry.name)) {
      const relative = path.relative(baseDir, fullPath);
      sources[relative] = fs.readFileSync(fullPath, 'utf8');
    }
  }
}

function _generateEnvBlock(config) {
  const port = config.port || 3000;
  const dbAdapter = (config.db && config.db.adapter) || 'none';
  const dbName = (config.db && config.db.name) || 'dywo_db';

  const lines = [
    `const PORT = process.env.PORT || ${port};`,
    `const HOST = process.env.HOST || '0.0.0.0';`,
    `const NODE_ENV = process.env.NODE_ENV || 'production';`,
    `const DB_ADAPTER = process.env.DB_ADAPTER || '${dbAdapter}';`,
    `const DB_NAME = process.env.DB_NAME || '${dbName}';`,
    `const DB_HOST = process.env.DB_HOST || 'localhost';`,
    `const DB_PORT = process.env.DB_PORT || 5432;`,
    `const DB_USER = process.env.DB_USER || '';`,
    `const DB_PASS = process.env.DB_PASS || '';`,
    `const DB_CONNECTION_STRING = process.env.DATABASE_URL || '';`
  ];

  return lines.join('\n');
}

function _generateCorsMiddleware(config) {
  const cors = config.cors || {};
  const origin = cors.origin || '*';
  const methods = cors.methods || 'GET,HEAD,PUT,PATCH,POST,DELETE';
  const headers = cors.headers || 'Content-Type, Authorization';

  return `
function corsMiddleware(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '${origin}');
  res.setHeader('Access-Control-Allow-Methods', '${methods}');
  res.setHeader('Access-Control-Allow-Headers', '${headers}');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  next();
}`;
}

function _generateRequestLogger() {
  return `
function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(\`[\${new Date().toISOString()}] \${req.method} \${req.url} \${res.statusCode} \${duration}ms\`);
  });
  next();
}`;
}

function _generateBodyParser() {
  return `
function bodyParser(req) {
  return new Promise((resolve) => {
    if (['POST', 'PUT', 'PATCH'].indexOf(req.method) === -1) {
      req.body = {};
      return resolve();
    }
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const contentType = req.headers['content-type'] || '';
      if (contentType.includes('application/json')) {
        try { req.body = JSON.parse(body); } catch (e) { req.body = {}; }
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        const qs = require('querystring');
        req.body = qs.parse(body);
      } else {
        req.body = body;
      }
      resolve();
    });
  });
}`;
}

function _generateRouter() {
  return `
class Router {
  constructor() {
    this.routes = [];
  }

  get(p, ...handlers) { this._add('GET', p, handlers); return this; }
  post(p, ...handlers) { this._add('POST', p, handlers); return this; }
  put(p, ...handlers) { this._add('PUT', p, handlers); return this; }
  patch(p, ...handlers) { this._add('PATCH', p, handlers); return this; }
  delete(p, ...handlers) { this._add('DELETE', p, handlers); return this; }
  all(p, ...handlers) { this._add('*', p, handlers); return this; }

  _add(method, pattern, handlers) {
    const paramNames = [];
    const regexStr = pattern
      .replace(/:([^/]+)/g, (_, name) => { paramNames.push(name); return '([^/]+)'; })
      .replace(/\\*/g, '(.*)');
    this.routes.push({ method, pattern, regex: new RegExp('^' + regexStr + '$'), paramNames, handlers });
  }

  match(method, pathname) {
    for (const route of this.routes) {
      if (route.method !== '*' && route.method !== method) continue;
      const m = route.regex.exec(pathname);
      if (m) {
        const params = {};
        route.paramNames.forEach((name, i) => { params[name] = decodeURIComponent(m[i + 1]); });
        return { route, params };
      }
    }
    return null;
  }
}`;
}

function _generateDbModule(config) {
  const adapter = (config.db && config.db.adapter) || 'none';

  if (adapter === 'none') {
    return `
const db = {
  query: async () => { throw new Error('No database configured'); },
  close: async () => {}
};`;
  }

  let connectBlock;
  switch (adapter) {
    case 'postgres':
    case 'postgresql':
      connectBlock = `
  async connect() {
    const { Pool } = require('pg');
    this.pool = new Pool({
      connectionString: DB_CONNECTION_STRING || undefined,
      host: DB_HOST,
      port: parseInt(DB_PORT, 10),
      database: DB_NAME,
      user: DB_USER,
      password: DB_PASS
    });
    await this.pool.query('SELECT 1');
    console.log('[DYWO-DB] PostgreSQL connected');
  }
  async query(text, params) {
    const result = await this.pool.query(text, params);
    return result.rows;
  }
  async close() {
    if (this.pool) await this.pool.end();
  }`;
      break;
    case 'mysql':
      connectBlock = `
  async connect() {
    const mysql = require('mysql2/promise');
    this.pool = await mysql.createPool({
      host: DB_HOST,
      port: parseInt(DB_PORT, 10),
      database: DB_NAME,
      user: DB_USER,
      password: DB_PASS
    });
    console.log('[DYWO-DB] MySQL connected');
  }
  async query(text, params) {
    const [rows] = await this.pool.execute(text, params);
    return rows;
  }
  async close() {
    if (this.pool) await this.pool.end();
  }`;
      break;
    case 'mongodb':
      connectBlock = `
  async connect() {
    const { MongoClient } = require('mongodb');
    const uri = DB_CONNECTION_STRING || 'mongodb://' + DB_HOST + ':' + DB_PORT;
    this.client = new MongoClient(uri);
    await this.client.connect();
    this.db = this.client.db(DB_NAME);
    console.log('[DYWO-DB] MongoDB connected');
  }
  collection(name) {
    return this.db.collection(name);
  }
  async query(collectionName, filter) {
    return this.db.collection(collectionName).find(filter || {}).toArray();
  }
  async close() {
    if (this.client) await this.client.close();
  }`;
      break;
    case 'sqlite':
      connectBlock = `
  async connect() {
    const Database = require('better-sqlite3');
    const dbPath = DB_NAME === ':memory:' ? ':memory:' : require('path').resolve(DB_NAME);
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    console.log('[DYWO-DB] SQLite connected');
  }
  query(sql, params) {
    const stmt = this.db.prepare(sql);
    return params ? stmt.all(...(Array.isArray(params) ? params : [params])) : stmt.all();
  }
  execute(sql, params) {
    const stmt = this.db.prepare(sql);
    return params ? stmt.run(...(Array.isArray(params) ? params : [params])) : stmt.run();
  }
  async close() {
    if (this.db) this.db.close();
  }`;
      break;
    default:
      connectBlock = `
  async connect() { console.warn('[DYWO-DB] Unknown adapter: ${adapter}'); }
  async query() { throw new Error('No database configured'); }
  async close() {}`;
  }

  return `
class Database {${connectBlock}
}

const db = new Database();`;
}

function _generateRouteRegistration(config) {
  const routes = config.routes || [];
  const lines = [];

  for (const route of routes) {
    const method = (route.method || 'get').toLowerCase();
    const handlerName = 'handler_' + route.path.replace(/[^a-zA-Z0-9]/g, '_');
    lines.push(`router.${method}('${route.path}', ${handlerName});`);
  }

  if (lines.length === 0) {
    lines.push("router.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));");
    lines.push("router.get('/', (req, res) => res.json({ message: 'DYWO Server is running' }));");
  }

  return lines.join('\n  ');
}

function _generateRouteHandlers(config) {
  const routes = config.routes || [];
  const lines = [];

  for (const route of routes) {
    const handlerName = 'handler_' + route.path.replace(/[^a-zA-Z0-9]/g, '_');
    if (route.handler) {
      lines.push(`function ${handlerName}(req, res) {\n  ${route.handler}\n}`);
    } else {
      lines.push(`function ${handlerName}(req, res) {\n  res.json({ path: '${route.path}', params: req.params, query: req.query });\n}`);
    }
  }

  return lines.join('\n\n');
}

function _generateServerFile(config, sources) {
  const sections = [];

  sections.push("'use strict';");
  sections.push('');
  sections.push("const http = require('http');");
  sections.push("const https = require('https');");
  sections.push("const url = require('url');");
  sections.push("const path = require('path');");
  sections.push("const fs = require('fs');");
  sections.push('');

  sections.push('// ── Environment ──────────────────────────────────────────────────────────');
  sections.push(_generateEnvBlock(config));
  sections.push('');

  sections.push('// ── Body Parser ──────────────────────────────────────────────────────────');
  sections.push(_generateBodyParser());
  sections.push('');

  sections.push('// ── Router ───────────────────────────────────────────────────────────────');
  sections.push(_generateRouter());
  sections.push('');

  sections.push('// ── Database ─────────────────────────────────────────────────────────────');
  sections.push(_generateDbModule(config));
  sections.push('');

  sections.push('// ── Middleware ────────────────────────────────────────────────────────────');
  sections.push(_generateCorsMiddleware(config));
  sections.push('');
  sections.push(_generateRequestLogger());
  sections.push('');

  sections.push('// ── Route Handlers ───────────────────────────────────────────────────────');
  const handlers = _generateRouteHandlers(config);
  if (handlers) sections.push(handlers);
  sections.push('');

  sections.push('// ── Route Registration ───────────────────────────────────────────────────');
  sections.push('const router = new Router();');
  sections.push(_generateRouteRegistration(config));
  sections.push('');

  sections.push(`// ── Server ─────────────────────────────────────────────────────────────────
const middleware = [corsMiddleware, requestLogger];

function runChain(chain, req, res, index) {
  if (index >= chain.length) return;
  const handler = chain[index];
  const next = (err) => {
    if (err) return handleError(err, req, res);
    runChain(chain, req, res, index + 1);
  };
  try {
    const result = handler(req, res, next);
    if (result && typeof result.catch === 'function') {
      result.catch(err => handleError(err, req, res));
    }
  } catch (err) {
    handleError(err, req, res);
  }
}

function handleError(err, req, res) {
  console.error('[DYWO-Server] Error:', err.message);
  try {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal Server Error', message: err.message }));
  } catch (e) { /* response already sent */ }
}

function handleRequest(req, res) {
  const parsed = url.parse(req.url, true);
  req.query = parsed.query;
  req.params = {};
  req.path = parsed.pathname;

  res.json = (data, status) => {
    res.writeHead(status || 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  res.send = (data, status) => {
    if (typeof data === 'object') return res.json(data, status);
    res.writeHead(status || 200, { 'Content-Type': 'text/html' });
    res.end(String(data));
  };
  res.status = (code) => { res.statusCode = code; return res; };
  res.redirect = (loc, status) => {
    res.writeHead(status || 302, { Location: loc });
    res.end();
  };

  bodyParser(req).then(() => {
    const matched = router.match(req.method.toUpperCase(), req.path);
    if (!matched) {
      res.status(404).json({ error: 'Not Found', path: req.path });
      return;
    }
    req.params = matched.params;
    const chain = [...middleware, ...matched.route.handlers];
    runChain(chain, req, res, 0);
  }).catch(err => handleError(err, req, res));
}

async function start() {
  if (DB_ADAPTER !== 'none') {
    try {
      await db.connect();
    } catch (err) {
      console.error('[DYWO-Server] Database connection failed:', err.message);
      process.exit(1);
    }
  }

  const server = http.createServer(handleRequest);

  server.listen(parseInt(PORT, 10), HOST, () => {
    console.log(\`[DYWO-Server] Running at http://\${HOST}:\${PORT} (\${NODE_ENV})\`);
  });

  const shutdown = async (signal) => {
    console.log(\`\\n[DYWO-Server] \${signal} received, shutting down...\`);
    server.close(async () => {
      if (DB_ADAPTER !== 'none') await db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start();
`);

  return sections.join('\n');
}

module.exports = async function compileSingleFile(projectRoot, config, outputDir) {
  const sources = _readServerSources(projectRoot, config);
  const serverCode = _generateServerFile(config, sources);

  const outputPath = path.join(outputDir, 'server.js');
  fs.writeFileSync(outputPath, serverCode);

  return {
    target: 'single',
    outputDir,
    files: ['server.js']
  };
};
