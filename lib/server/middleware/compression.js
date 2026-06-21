'use strict';

const zlib = require('zlib');

function compression(options = {}) {
  const threshold = options.threshold || 1024;
  const level = options.level || zlib.constants.Z_DEFAULT_COMPRESSION;

  return function compressionMiddleware(req, res, next) {
    const acceptEncoding = req.headers['accept-encoding'] || '';

    let encoding = null;
    if (acceptEncoding.includes('gzip')) {
      encoding = 'gzip';
    } else if (acceptEncoding.includes('deflate')) {
      encoding = 'deflate';
    }

    if (!encoding) return next();

    const originalWrite = res.write;
    const originalEnd = res.end;
    const chunks = [];
    let totalSize = 0;
    let headersSent = false;

    res.write = function (chunk, ...args) {
      if (typeof chunk === 'string') chunk = Buffer.from(chunk);
      chunks.push(chunk);
      totalSize += chunk.length;
      return true;
    };

    res.end = function (chunk, ...args) {
      if (chunk) {
        if (typeof chunk === 'string') chunk = Buffer.from(chunk);
        chunks.push(chunk);
        totalSize += chunk.length;
      }

      const body = Buffer.concat(chunks);

      const noCompress = res.getHeader('Content-Type') &&
        /^(image\/|video\/|audio\/|application\/zip|application\/gzip)/.test(res.getHeader('Content-Type'));

      if (totalSize < threshold || noCompress) {
        res.setHeader('Content-Length', String(body.length));
        originalWrite.call(res, body);
        originalEnd.call(res);
        return;
      }

      const compress = encoding === 'gzip'
        ? zlib.gzipSync(body, { level })
        : zlib.deflateSync(body, { level });

      res.setHeader('Content-Encoding', encoding);
      res.setHeader('Content-Length', String(compress.length));
      res.removeHeader('Content-Length');
      res.setHeader('Content-Length', String(compress.length));

      originalWrite.call(res, compress);
      originalEnd.call(res);
    };

    next();
  };
}

module.exports = compression;
