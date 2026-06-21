'use strict';

/**
 * TempModuleCache
 *
 * A simple temp-file cache used during DYWO compilation to let webpack resolve
 * extracted <script> and <style> blocks from .dywo files without needing a
 * custom virtual-module webpack plugin.
 *
 * Usage:
 *   1. The dywo-loader calls `cache.write(id, content, ext)` to persist each
 *      extracted block to `.dywo-cache/<safe-name><ext>`.
 *   2. The loader uses the returned path as the module path that webpack
 *      resolves normally.
 *   3. After the build completes, call `cache.clean()` to empty the directory.
 *
 * The `.dywo-cache/` directory is intentionally excluded from version control
 * via the project's .gitignore.
 */

const path = require('path');
const fs = require('fs-extra');

class TempModuleCache {
  /**
   * @param {string} projectRoot  Absolute path to the project root. The cache
   *                              directory is created here as `.dywo-cache/`.
   */
  constructor(projectRoot) {
    this.cacheDir = path.join(projectRoot, '.dywo-cache');
    fs.ensureDirSync(this.cacheDir);
  }

  /**
   * Write extracted module content to a temp file and return its absolute path.
   *
   * The `id` is used to derive a filename. Any character that is not
   * alphanumeric is replaced with `_` to produce a safe filesystem name.
   *
   * @param {string} id       Logical identifier for the module
   *                          (e.g. '/project/src/Button.dywo?script').
   * @param {string} content  The module content to write.
   * @param {string} [ext]    File extension including the leading dot.
   *                          Defaults to `.js`.
   * @returns {string}        Absolute path to the written temp file.
   */
  write(id, content, ext = '.js') {
    const safeName = id.replace(/[^a-z0-9]/gi, '_');
    const filePath = path.join(this.cacheDir, safeName + ext);
    fs.writeFileSync(filePath, content, 'utf8');
    return filePath;
  }

  /**
   * Remove all files from the cache directory without removing the directory
   * itself. Safe to call between incremental builds.
   */
  clean() {
    fs.emptyDirSync(this.cacheDir);
  }

  /**
   * Return the absolute path to the cache directory.
   *
   * @returns {string}
   */
  getCacheDir() {
    return this.cacheDir;
  }
}

module.exports = TempModuleCache;
