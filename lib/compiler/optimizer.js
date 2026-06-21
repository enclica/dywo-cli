'use strict';

/**
 * Optimizer for the DYWO compiler pipeline.
 * Compresses built output files using gzip and brotli.
 * Uses Node's built-in zlib module – no external dependencies required.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);
const brotliCompress = promisify(zlib.brotliCompress);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const stat = promisify(fs.stat);

// ---------------------------------------------------------------------------
// File extension filters
// ---------------------------------------------------------------------------

const COMPRESSIBLE_EXTENSIONS = new Set(['.js', '.css', '.html']);

function isCompressible(filePath) {
  return COMPRESSIBLE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

// ---------------------------------------------------------------------------
// Directory walk (recursive, synchronous iteration)
// ---------------------------------------------------------------------------

function walkDir(dirPath) {
  const results = [];

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && isCompressible(fullPath)) {
        results.push(fullPath);
      }
    }
  }

  walk(dirPath);
  return results;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const Optimizer = {
  /**
   * Compress a single file and write .gz and/or .br sidecar files.
   *
   * @param {string} filePath   Absolute path to the source file
   * @param {{ gzip?: boolean, brotli?: boolean }} options
   * @returns {Promise<{ gzPath?: string, brPath?: string }>}
   */
  async compressFile(filePath, options = {}) {
    const opts = {
      gzip: true,
      brotli: true,
      ...options
    };

    const content = await readFile(filePath);
    const written = {};

    if (opts.gzip) {
      const compressed = await gzip(content, {
        level: zlib.constants.Z_BEST_COMPRESSION
      });
      const gzPath = filePath + '.gz';
      await writeFile(gzPath, compressed);
      written.gzPath = gzPath;
    }

    if (opts.brotli) {
      const compressed = await brotliCompress(content, {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY
        }
      });
      const brPath = filePath + '.br';
      await writeFile(brPath, compressed);
      written.brPath = brPath;
    }

    return written;
  },

  /**
   * Recursively walk a directory and compress all .js, .css, .html files.
   *
   * @param {string} dirPath   Absolute path to the dist directory
   * @param {{ gzip?: boolean, brotli?: boolean, concurrency?: number }} options
   * @returns {Promise<{ file: string, gzPath?: string, brPath?: string }[]>}
   */
  async compressDir(dirPath, options = {}) {
    const opts = {
      gzip: true,
      brotli: true,
      concurrency: 8,
      ...options
    };

    const files = walkDir(dirPath);

    // Process files in batches to avoid exhausting file descriptors
    const results = [];
    const { concurrency } = opts;

    for (let i = 0; i < files.length; i += concurrency) {
      const batch = files.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(async file => {
          const compressed = await this.compressFile(file, opts);
          return { file, ...compressed };
        })
      );
      results.push(...batchResults);
    }

    return results;
  },

  /**
   * Return size information for a file and any existing compressed sidecars.
   *
   * @param {string} filePath
   * @returns {Promise<{
   *   original: { size: number, path: string },
   *   gz?: { size: number, path: string, ratio: string },
   *   br?: { size: number, path: string, ratio: string }
   * }>}
   */
  async getStats(filePath) {
    const originalStat = await stat(filePath);
    const originalSize = originalStat.size;

    const result = {
      original: { size: originalSize, path: filePath }
    };

    const gzPath = filePath + '.gz';
    const brPath = filePath + '.br';

    try {
      const gzStat = await stat(gzPath);
      result.gz = {
        size: gzStat.size,
        path: gzPath,
        ratio: ((1 - gzStat.size / originalSize) * 100).toFixed(1) + '%'
      };
    } catch (_) {
      // .gz sidecar does not exist
    }

    try {
      const brStat = await stat(brPath);
      result.br = {
        size: brStat.size,
        path: brPath,
        ratio: ((1 - brStat.size / originalSize) * 100).toFixed(1) + '%'
      };
    } catch (_) {
      // .br sidecar does not exist
    }

    return result;
  }
};

module.exports = Optimizer;
