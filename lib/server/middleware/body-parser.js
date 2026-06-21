'use strict';

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (limit && size > limit) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseQuery(str) {
  const result = {};
  if (!str) return result;
  for (const pair of str.split('&')) {
    const [k, ...v] = pair.split('=');
    const key = decodeURIComponent(k);
    const val = decodeURIComponent(v.join('='));
    if (result[key] !== undefined) {
      if (!Array.isArray(result[key])) result[key] = [result[key]];
      result[key].push(val);
    } else {
      result[key] = val;
    }
  }
  return result;
}

function parseMultipart(buf, boundary) {
  const parts = {};
  const files = [];
  const boundaryBuf = Buffer.from('--' + boundary);
  const endBuf = Buffer.from('--' + boundary + '--');

  let start = buf.indexOf(boundaryBuf) + boundaryBuf.length + 2;

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

    if (filenameMatch) {
      files.push({
        fieldname: nameMatch ? nameMatch[1] : '',
        filename: filenameMatch[1],
        contentType: headers['content-type'] || 'application/octet-stream',
        data: body
      });
    } else if (nameMatch) {
      parts[nameMatch[1]] = body.toString();
    }

    start = nextBoundary + boundaryBuf.length + 2;
    if (buf.slice(nextBoundary, nextBoundary + endBuf.length).equals(endBuf)) break;
  }

  return { fields: parts, files };
}

function bodyParser(options = {}) {
  const limit = options.limit || 1024 * 1024;

  return async function bodyParserMiddleware(req, res, next) {
    const contentType = (req.headers['content-type'] || '').toLowerCase();

    if (!contentType || req.method === 'GET' || req.method === 'HEAD') {
      return next();
    }

    try {
      if (contentType.includes('application/json')) {
        const buf = await readBody(req, limit);
        req.body = buf.length ? JSON.parse(buf.toString()) : {};
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        const buf = await readBody(req, limit);
        req.body = parseQuery(buf.toString());
      } else if (contentType.includes('multipart/form-data')) {
        const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
        if (!boundaryMatch) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing multipart boundary' }));
          return;
        }
        const buf = await readBody(req, limit);
        const { fields, files } = parseMultipart(buf, boundaryMatch[1]);
        req.body = fields;
        req.files = files;
      } else {
        const buf = await readBody(req, limit);
        req.body = buf;
      }
    } catch (err) {
      if (err.message === 'Request body too large') {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload too large' }));
        return;
      }
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request body' }));
      return;
    }

    next();
  };
}

module.exports = bodyParser;
