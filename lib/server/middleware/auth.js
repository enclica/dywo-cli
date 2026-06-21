'use strict';

const crypto = require('crypto');

function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

function base64urlEncode(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function jwt(secret, options = {}) {
  const algorithms = options.algorithms || ['HS256'];
  const headerName = options.header || 'authorization';
  const scheme = options.scheme || 'Bearer';

  return function jwtMiddleware(req, res, next) {
    const authHeader = req.headers[headerName.toLowerCase()];
    if (!authHeader) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No authorization header' }));
      return;
    }

    let token;
    if (scheme) {
      const parts = authHeader.split(' ');
      if (parts.length !== 2 || parts[0] !== scheme) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid authorization scheme' }));
        return;
      }
      token = parts[1];
    } else {
      token = authHeader;
    }

    const segments = token.split('.');
    if (segments.length !== 3) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid token format' }));
      return;
    }

    const [headerB64, payloadB64, signatureB64] = segments;

    let header, payload;
    try {
      header = JSON.parse(base64urlDecode(headerB64).toString());
      payload = JSON.parse(base64urlDecode(payloadB64).toString());
    } catch (e) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid token encoding' }));
      return;
    }

    if (!algorithms.includes(header.alg)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unsupported algorithm' }));
      return;
    }

    const signingInput = headerB64 + '.' + payloadB64;
    let expectedSig;
    if (header.alg === 'HS256') {
      expectedSig = base64urlEncode(
        crypto.createHmac('sha256', secret).update(signingInput).digest()
      );
    } else if (header.alg === 'HS384') {
      expectedSig = base64urlEncode(
        crypto.createHmac('sha384', secret).update(signingInput).digest()
      );
    } else if (header.alg === 'HS512') {
      expectedSig = base64urlEncode(
        crypto.createHmac('sha512', secret).update(signingInput).digest()
      );
    } else {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unsupported algorithm' }));
      return;
    }

    if (!crypto.timingSafeEqual(Buffer.from(signatureB64), Buffer.from(expectedSig))) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid token signature' }));
      return;
    }

    if (payload.exp && Date.now() >= payload.exp * 1000) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Token expired' }));
      return;
    }

    if (payload.nbf && Date.now() < payload.nbf * 1000) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Token not yet valid' }));
      return;
    }

    req.user = payload;
    next();
  };
}

function session(options = {}) {
  const cookieName = options.cookie || 'sid';
  const store = options.store || new Map();
  const maxAge = options.maxAge || 86400000;
  const secret = options.secret || '';

  function signSessionId(sid) {
    return sid + '.' + crypto.createHmac('sha256', secret).update(sid).digest('hex');
  }

  function verifySessionId(signed) {
    const idx = signed.lastIndexOf('.');
    if (idx === -1) return null;
    const sid = signed.slice(0, idx);
    const expected = signSessionId(sid);
    if (signed.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(signed), Buffer.from(expected))) return null;
    return sid;
  }

  function parseCookies(header) {
    const cookies = {};
    if (!header) return cookies;
    header.split(';').forEach(pair => {
      const [k, ...v] = pair.trim().split('=');
      if (k) cookies[k.trim()] = decodeURIComponent(v.join('='));
    });
    return cookies;
  }

  return function sessionMiddleware(req, res, next) {
    const cookies = parseCookies(req.headers.cookie);
    const signedSid = cookies[cookieName];

    if (signedSid) {
      const sid = verifySessionId(signedSid);
      if (sid) {
        const data = store.get(sid);
        if (data && (!data._expires || Date.now() < data._expires)) {
          req.user = data;
          req.sessionId = sid;
        }
      }
    }

    req.session = {
      create(userData) {
        const sid = crypto.randomBytes(32).toString('hex');
        const sessionData = { ...userData, _expires: Date.now() + maxAge };
        store.set(sid, sessionData);
        const signed = signSessionId(sid);
        res.setHeader('Set-Cookie', `${cookieName}=${encodeURIComponent(signed)}; Path=/; HttpOnly; Max-Age=${Math.floor(maxAge / 1000)}`);
        req.user = sessionData;
        req.sessionId = sid;
        return sid;
      },
      destroy() {
        if (req.sessionId) {
          store.delete(req.sessionId);
          res.setHeader('Set-Cookie', `${cookieName}=; Path=/; HttpOnly; Max-Age=0`);
          req.user = null;
          req.sessionId = null;
        }
      }
    };

    next();
  };
}

function apiKey(header, keys) {
  const headerName = header.toLowerCase();
  const validKeys = new Set(Array.isArray(keys) ? keys : [keys]);

  return function apiKeyMiddleware(req, res, next) {
    const key = req.headers[headerName];
    if (!key || !validKeys.has(key)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid or missing API key' }));
      return;
    }
    req.user = { apiKey: key };
    next();
  };
}

function basicAuth(users) {
  const userMap = new Map(Object.entries(users));

  return function basicAuthMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Basic ')) {
      res.writeHead(401, {
        'Content-Type': 'application/json',
        'WWW-Authenticate': 'Basic realm="Restricted"'
      });
      res.end(JSON.stringify({ error: 'Authentication required' }));
      return;
    }

    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
    const colonIdx = decoded.indexOf(':');
    if (colonIdx === -1) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid credentials' }));
      return;
    }

    const username = decoded.slice(0, colonIdx);
    const password = decoded.slice(colonIdx + 1);
    const expectedPassword = userMap.get(username);

    if (!expectedPassword || !crypto.timingSafeEqual(Buffer.from(password), Buffer.from(expectedPassword))) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid credentials' }));
      return;
    }

    req.user = { username };
    next();
  };
}

module.exports = { jwt, session, apiKey, basicAuth };
