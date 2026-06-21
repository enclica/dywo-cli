'use strict';

/**
 * DYWO-Server — Lightweight API framework
 * Part of the DYWO pipeline for building APIs alongside your frontend.
 *
 * Features:
 * - Express-like routing with decorator-style syntax
 * - Built-in middleware stack
 * - Request/response helpers
 * - WebSocket support
 * - File upload handling
 * - Static file serving
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const querystring = require('querystring');

class DywoServer {
  constructor(options = {}) {
    this.port = options.port || 3000;
    this.host = options.host || '0.0.0.0';
    this.routes = [];
    this.middleware = [];
    this.errorHandlers = [];
    this.wsHandlers = {};
    this.staticDirs = [];
    this.options = options;
  }

  // ── Routing ─────────────────────────────────────────────────────────────
  get(path, ...handlers) { return this._addRoute('GET', path, handlers); }
  post(path, ...handlers) { return this._addRoute('POST', path, handlers); }
  put(path, ...handlers) { return this._addRoute('PUT', path, handlers); }
  patch(path, ...handlers) { return this._addRoute('PATCH', path, handlers); }
  delete(path, ...handlers) { return this._addRoute('DELETE', path, handlers); }
  options(path, ...handlers) { return this._addRoute('OPTIONS', path, handlers); }
  all(path, ...handlers) { return this._addRoute('*', path, handlers); }

  // ── Route Groups ────────────────────────────────────────────────────────
  group(prefix, fn) {
    const group = new RouteGroup(this, prefix);
    fn(group);
    return this;
  }

  // ── Middleware ──────────────────────────────────────────────────────────
  use(fn) {
    if (typeof fn === 'string') {
      this.staticDirs.push(fn);
    } else {
      this.middleware.push(fn);
    }
    return this;
  }

  // ── Error Handling ─────────────────────────────────────────────────────
  onError(fn) {
    this.errorHandlers.push(fn);
    return this;
  }

  // ── WebSocket ──────────────────────────────────────────────────────────
  ws(path, handler) {
    this.wsHandlers[path] = handler;
    return this;
  }

  // ── Static Files ───────────────────────────────────────────────────────
  static(dir, options = {}) {
    this.staticDirs.push({ dir, prefix: options.prefix || '/', ...options });
    return this;
  }

  // ── Internal Route Registration ────────────────────────────────────────
  _addRoute(method, pathPattern, handlers) {
    const { regex, paramNames } = this._compilePath(pathPattern);
    this.routes.push({ method, pathPattern, regex, paramNames, handlers });
    return this;
  }

  _compilePath(pattern) {
    const paramNames = [];
    const regexStr = pattern
      .replace(/:([^/]+)/g, (_, name) => {
        paramNames.push(name);
        return '([^/]+)';
      })
      .replace(/\*/g, '(.*)');
    return { regex: new RegExp('^' + regexStr + '$'), paramNames };
  }

  // ── Request Handling ───────────────────────────────────────────────────
  _handleRequest(req, res) {
    const parsed = url.parse(req.url, true);
    const pathname = parsed.pathname;
    const method = req.method.toUpperCase();

    // Enhance request
    req.query = parsed.query;
    req.params = {};
    req.path = pathname;

    // Enhance response
    res.json = (data, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    res.send = (data, status = 200) => {
      if (typeof data === 'object') return res.json(data, status);
      res.writeHead(status, { 'Content-Type': 'text/html' });
      res.end(String(data));
    };
    res.status = (code) => { res.statusCode = code; return res; };
    res.redirect = (url, status = 302) => {
      res.writeHead(status, { Location: url });
      res.end();
    };
    res.cookie = (name, value, options = {}) => {
      let cookie = `${name}=${encodeURIComponent(value)}`;
      if (options.maxAge) cookie += `; Max-Age=${options.maxAge}`;
      if (options.path) cookie += `; Path=${options.path}`;
      if (options.httpOnly) cookie += '; HttpOnly';
      if (options.secure) cookie += '; Secure';
      if (options.sameSite) cookie += `; SameSite=${options.sameSite}`;
      res.setHeader('Set-Cookie', cookie);
    };

    // Parse body for POST/PUT/PATCH
    this._parseBody(req).then(() => {
      // Try static files first
      if (this._tryStatic(req, res)) return;

      // Find matching route
      const route = this._matchRoute(method, pathname, req);
      if (!route) {
        res.status(404).json({ error: 'Not Found', path: pathname });
        return;
      }

      // Run middleware chain then route handlers
      const chain = [...this.middleware, ...route.handlers];
      this._runChain(chain, req, res, 0);
    }).catch(err => {
      this._handleError(err, req, res);
    });
  }

  _parseBody(req) {
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
          req.body = querystring.parse(body);
        } else {
          req.body = body;
        }
        resolve();
      });
    });
  }

  _matchRoute(method, pathname, req) {
    for (const route of this.routes) {
      if (route.method !== '*' && route.method !== method) continue;
      const match = route.regex.exec(pathname);
      if (match) {
        route.paramNames.forEach((name, i) => {
          req.params[name] = decodeURIComponent(match[i + 1]);
        });
        return route;
      }
    }
    return null;
  }

  _tryStatic(req, res) {
    for (const staticDir of this.staticDirs) {
      if (typeof staticDir === 'string') {
        const filePath = path.join(staticDir, req.path);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          res.sendFile(filePath);
          return true;
        }
      } else {
        const prefix = staticDir.prefix || '/';
        if (req.path.startsWith(prefix)) {
          const relativePath = req.path.slice(prefix.length);
          const filePath = path.join(staticDir.dir, relativePath);
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const ext = path.extname(filePath);
            const mimeTypes = {
              '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
              '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
              '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
              '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf'
            };
            res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
            fs.createReadStream(filePath).pipe(res);
            return true;
          }
        }
      }
    }
    return false;
  }

  _runChain(chain, req, res, index) {
    if (index >= chain.length) return;
    const handler = chain[index];
    const next = (err) => {
      if (err) return this._handleError(err, req, res);
      this._runChain(chain, req, res, index + 1);
    };
    try {
      const result = handler(req, res, next);
      if (result && typeof result.catch === 'function') {
        result.catch(err => this._handleError(err, req, res));
      }
    } catch (err) {
      this._handleError(err, req, res);
    }
  }

  _handleError(err, req, res) {
    if (this.errorHandlers.length > 0) {
      for (const handler of this.errorHandlers) {
        try { handler(err, req, res); return; } catch (e) { /* continue */ }
      }
    }
    console.error('[DYWO-Server] Error:', err.message);
    try {
      res.status(500).json({ error: 'Internal Server Error', message: err.message });
    } catch (e) { /* response already sent */ }
  }

  // ── Start Server ───────────────────────────────────────────────────────
  listen(port, host, callback) {
    if (typeof port === 'function') { callback = port; port = this.port; }
    if (typeof host === 'function') { callback = host; host = this.host; }
    port = port || this.port;
    host = host || this.host;

    const server = this.options.https
      ? https.createServer(this.options.https, (req, res) => this._handleRequest(req, res))
      : http.createServer((req, res) => this._handleRequest(req, res));

    server.listen(port, host, () => {
      console.log(`[DYWO-Server] Running at http://${host}:${port}`);
      if (callback) callback(server);
    });

    return server;
  }
}

class RouteGroup {
  constructor(server, prefix) {
    this.server = server;
    this.prefix = prefix;
  }
  get(path, ...handlers) { return this.server._addRoute('GET', this.prefix + path, handlers); }
  post(path, ...handlers) { return this.server._addRoute('POST', this.prefix + path, handlers); }
  put(path, ...handlers) { return this.server._addRoute('PUT', this.prefix + path, handlers); }
  patch(path, ...handlers) { return this.server._addRoute('PATCH', this.prefix + path, handlers); }
  delete(path, ...handlers) { return this.server._addRoute('DELETE', this.prefix + path, handlers); }
}

// ── Factory Function ───────────────────────────────────────────────────────
function createServer(options) {
  return new DywoServer(options);
}

module.exports = { DywoServer, createServer, RouteGroup };
