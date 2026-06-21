'use strict';
const crypto = require('crypto');
const path = require('path');

/**
 * Generate a deterministic 8-character scope ID for a .dywo file.
 * Based on the file's relative path so it's stable across machines.
 */
function generateScopeId(filePath, projectRoot) {
  const rel = projectRoot ? path.relative(projectRoot, filePath) : filePath;
  return 'dywo-' + crypto.createHash('md5').update(rel).digest('hex').slice(0, 8);
}

module.exports = { generateScopeId };
