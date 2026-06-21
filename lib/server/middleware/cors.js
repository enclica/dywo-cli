'use strict';

function cors(options = {}) {
  const defaults = {
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    headers: 'Content-Type, Authorization',
    credentials: false,
    maxAge: 86400
  };
  const opts = { ...defaults, ...options };

  return function corsMiddleware(req, res, next) {
    res.setHeader('Access-Control-Allow-Origin', opts.origin);
    res.setHeader('Access-Control-Allow-Methods', opts.methods);
    res.setHeader('Access-Control-Allow-Headers', opts.headers);
    if (opts.credentials) res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Max-Age', String(opts.maxAge));

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    next();
  };
}

module.exports = cors;
