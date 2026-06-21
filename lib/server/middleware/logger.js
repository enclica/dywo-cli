'use strict';

function logger(options = {}) {
  const output = options.output || console;
  const format = options.format || 'combined';

  return function loggerMiddleware(req, res, next) {
    const start = Date.now();
    const originalEnd = res.end;

    res.end = function (...args) {
      const duration = Date.now() - start;
      const { method, url } = req;
      const status = res.statusCode;
      const contentLength = res.getHeader('Content-Length') || 0;

      if (format === 'short') {
        output.log(`${method} ${url} ${status} ${duration}ms`);
      } else {
        const ip = req.socket.remoteAddress;
        const userAgent = req.headers['user-agent'] || '-';
        output.log(`${ip} - ${method} ${url} ${status} ${contentLength} ${duration}ms "${userAgent}"`);
      }

      originalEnd.apply(res, args);
    };

    next();
  };
}

module.exports = logger;
