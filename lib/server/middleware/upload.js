'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

function upload(options = {}) {
  const dest = options.dest || '/tmp';
  const maxFileSize = options.maxFileSize || 10 * 1024 * 1024;
  const maxFiles = options.maxFiles || 10;
  const allowedTypes = options.allowedTypes || null;
  const fieldName = options.fieldName || null;

  return async function uploadMiddleware(req, res, next) {
    const contentType = (req.headers['content-type'] || '').toLowerCase();

    if (!contentType.includes('multipart/form-data')) {
      return next();
    }

    const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
    if (!boundaryMatch) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing multipart boundary' }));
      return;
    }

    const chunks = [];
    let totalSize = 0;

    try {
      await new Promise((resolve, reject) => {
        req.on('data', chunk => {
          totalSize += chunk.length;
          if (totalSize > maxFileSize * maxFiles) {
            reject(new Error('Upload too large'));
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        req.on('end', resolve);
        req.on('error', reject);
      });
    } catch (err) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Upload too large' }));
      return;
    }

    const buf = Buffer.concat(chunks);
    const boundary = boundaryMatch[1];
    const boundaryBuf = Buffer.from('--' + boundary);
    const endBuf = Buffer.from('--' + boundary + '--');

    const files = [];
    const fields = {};
    let start = buf.indexOf(boundaryBuf) + boundaryBuf.length + 2;
    let fileCount = 0;

    while (start < buf.length) {
      const nextBoundary = buf.indexOf(boundaryBuf, start);
      if (nextBoundary === -1) break;

      const partData = buf.slice(start, nextBoundary - 2);
      const headerEnd = partData.indexOf('\r\n\r\n');
      if (headerEnd === -1) {
        start = nextBoundary + boundaryBuf.length + 2;
        continue;
      }

      const headerStr = partData.slice(0, headerEnd).toString();
      const body = partData.slice(headerEnd + 4);

      const headers = {};
      for (const line of headerStr.split('\r\n')) {
        const colonIdx = line.indexOf(':');
        if (colonIdx !== -1) {
          headers[line.slice(0, colonIdx).trim().toLowerCase()] = line.slice(colonIdx + 1).trim();
        }
      }

      const disposition = headers['content-disposition'] || '';
      const nameMatch = disposition.match(/name="([^"]+)"/);
      const filenameMatch = disposition.match(/filename="([^"]+)"/);

      if (filenameMatch && filenameMatch[1]) {
        fileCount++;
        if (fileCount > maxFiles) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Too many files' }));
          return;
        }

        if (fieldName && nameMatch && nameMatch[1] !== fieldName) {
          start = nextBoundary + boundaryBuf.length + 2;
          continue;
        }

        const mimeType = headers['content-type'] || 'application/octet-stream';
        if (allowedTypes && !allowedTypes.includes(mimeType)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `File type not allowed: ${mimeType}` }));
          return;
        }

        if (body.length > maxFileSize) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `File too large: ${filenameMatch[1]}` }));
          return;
        }

        const ext = path.extname(filenameMatch[1]) || '';
        const safeName = crypto.randomBytes(16).toString('hex') + ext;
        const filePath = path.join(dest, safeName);

        if (!fs.existsSync(dest)) {
          fs.mkdirSync(dest, { recursive: true });
        }

        fs.writeFileSync(filePath, body);

        files.push({
          fieldname: nameMatch ? nameMatch[1] : '',
          filename: filenameMatch[1],
          savedAs: safeName,
          path: filePath,
          size: body.length,
          mimetype: mimeType
        });
      } else if (nameMatch) {
        fields[nameMatch[1]] = body.toString();
      }

      start = nextBoundary + boundaryBuf.length + 2;
      if (buf.slice(nextBoundary, nextBoundary + endBuf.length).equals(endBuf)) break;
    }

    req.body = fields;
    req.files = files;
    next();
  };
}

module.exports = upload;
