'use strict';

const crypto = require('crypto');

function authMiddleware(req, res, next) {
  const header = req.headers['authorization'];

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const raw = header.slice(7);

  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length < 4) {
      return res.status(401).json({ error: 'Invalid token format' });
    }

    const userId = parts[0];
    const username = parts[1];
    const timestamp = parts[2];
    const signature = parts[3];

    const secret = process.env.JWT_SECRET || 'change-me';
    const payload = `${userId}:${username}:${timestamp}`;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    if (signature !== expected) {
      return res.status(401).json({ error: 'Invalid token signature' });
    }

    const tokenAge = Date.now() - parseInt(timestamp);
    const MAX_TOKEN_AGE = 24 * 60 * 60 * 1000;
    if (tokenAge > MAX_TOKEN_AGE) {
      return res.status(401).json({ error: 'Token expired' });
    }

    req.user = { id: parseInt(userId), username };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function optionalAuth(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }
  return authMiddleware(req, res, next);
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!req.user.role || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = authMiddleware;
module.exports.optional = optionalAuth;
module.exports.requireRole = requireRole;
