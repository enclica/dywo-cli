'use strict';

function security(options = {}) {
  const defaults = {
    frameOptions: 'DENY',
    contentTypeOptions: 'nosniff',
    xssProtection: '1; mode=block',
    hsts: 'max-age=31536000; includeSubDomains',
    csp: null,
    referrerPolicy: 'strict-origin-when-cross-origin',
    poweredBy: null
  };
  const opts = { ...defaults, ...options };

  return function securityMiddleware(req, res, next) {
    if (opts.frameOptions) {
      res.setHeader('X-Frame-Options', opts.frameOptions);
    }
    if (opts.contentTypeOptions) {
      res.setHeader('X-Content-Type-Options', opts.contentTypeOptions);
    }
    if (opts.xssProtection) {
      res.setHeader('X-XSS-Protection', opts.xssProtection);
    }
    if (opts.hsts) {
      res.setHeader('Strict-Transport-Security', opts.hsts);
    }
    if (opts.csp) {
      res.setHeader('Content-Security-Policy', opts.csp);
    }
    if (opts.referrerPolicy) {
      res.setHeader('Referrer-Policy', opts.referrerPolicy);
    }
    if (opts.poweredBy === null) {
      res.removeHeader('X-Powered-By');
    } else if (opts.poweredBy) {
      res.setHeader('X-Powered-By', opts.poweredBy);
    }

    next();
  };
}

module.exports = security;
