'use strict';

function rateLimit(options = {}) {
  const windowMs = options.windowMs || 60000;
  const max = options.max || 100;
  const keyFn = options.keyFn || (req => req.socket.remoteAddress);
  const store = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [key, data] of store) {
      if (now - data.start > windowMs) store.delete(key);
    }
  }, windowMs).unref();

  return function rateLimitMiddleware(req, res, next) {
    const key = keyFn(req);
    const now = Date.now();
    let data = store.get(key);

    if (!data || now - data.start > windowMs) {
      data = { count: 0, start: now };
      store.set(key, data);
    }

    data.count++;
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - data.count)));

    if (data.count > max) {
      const retryAfter = Math.ceil((data.start + windowMs - now) / 1000);
      res.writeHead(429, {
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfter)
      });
      res.end(JSON.stringify({ error: 'Too many requests' }));
      return;
    }
    next();
  };
}

module.exports = rateLimit;
