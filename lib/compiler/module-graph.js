'use strict';

/**
 * ModuleGraph
 *
 * Builds and maintains a dependency graph of all .dywo files in a project.
 * Supports topological ordering, incremental change detection, and
 * affected-file propagation for HMR.
 */

const path = require('path');
const fs = require('fs-extra');

// Matches all ES import-from forms (named, default, namespace) and side-effect
// imports so we can extract .dywo (and aliased) dependency specifiers.
const IMPORT_RE = /import\s+(?:\w+|\{[^}]+\}|\*\s+as\s+\w+|\w+\s*,\s*(?:\{[^}]+\}|\*\s+as\s+\w+))\s+from\s+['"]([^'"]+)['"]/g;
const SIDE_EFFECT_IMPORT_RE = /import\s+['"]([^'"]+)['"]/g;

class ModuleGraph {
  /**
   * @param {string} projectRoot  Absolute path to the project root.
   */
  constructor(projectRoot) {
    this.projectRoot = projectRoot;

    /**
     * nodes: Map<absoluteFilePath, { imports: string[], dependents: string[], mtime: number|null }>
     *
     * imports   — absolute paths of files this node depends on
     * dependents — absolute paths of files that import this node
     * mtime     — last-known modification time (ms), or null if unknown
     */
    this.nodes = new Map();
  }

  // ---------------------------------------------------------------------------
  // Graph construction
  // ---------------------------------------------------------------------------

  /**
   * Ensure a file is represented in the graph (creates an empty node if new).
   *
   * @param {string} filePath  Absolute path.
   */
  addFile(filePath) {
    if (!this.nodes.has(filePath)) {
      this.nodes.set(filePath, { imports: [], dependents: [], mtime: null });
    }
  }

  /**
   * Parse a .dywo file, extract its imports, and register edges in the graph.
   * Recurses into imported .dywo files that have not yet been scanned.
   *
   * @param {string} filePath  Absolute path to the .dywo file to scan.
   */
  async scanFile(filePath) {
    this.addFile(filePath);

    let content;
    try {
      content = await fs.readFile(filePath, 'utf8');
      // Record modification time
      const stat = await fs.stat(filePath);
      this.nodes.get(filePath).mtime = stat.mtimeMs;
    } catch (err) {
      process.stderr.write(`[dywo module-graph] Cannot read ${filePath}: ${err.message}\n`);
      return;
    }

    // Extract the <script> block only (we don't care about template imports here)
    const scriptContent = _extractScriptBlock(content);
    const specifiers = _extractImportSpecifiers(scriptContent);

    const node = this.nodes.get(filePath);
    const fileDir = path.dirname(filePath);
    const newImports = [];

    for (const specifier of specifiers) {
      // Only follow .dywo imports — leave npm packages / CSS / JS to webpack.
      if (!specifier.endsWith('.dywo')) continue;

      // Resolve relative paths against the importing file's directory.
      // Alias resolution is left to JSProcessor / webpack; here we only
      // follow paths we can resolve to an actual file.
      if (specifier.startsWith('.')) {
        const absTarget = path.resolve(fileDir, specifier);
        newImports.push(absTarget);

        // Register reverse edge (dependent)
        this.addFile(absTarget);
        const targetNode = this.nodes.get(absTarget);
        if (!targetNode.dependents.includes(filePath)) {
          targetNode.dependents.push(filePath);
        }

        // Recurse if not yet scanned (no mtime means we haven't read it)
        if (targetNode.mtime === null) {
          await this.scanFile(absTarget);
        }
      }
    }

    node.imports = newImports;
  }

  // ---------------------------------------------------------------------------
  // Topological ordering
  // ---------------------------------------------------------------------------

  /**
   * Return all files in the graph sorted so that each file appears before any
   * file that imports it (leaves first — dependencies before dependents).
   *
   * Circular dependencies are detected, reported, and broken by skipping the
   * back-edge rather than crashing.
   *
   * @returns {string[]}
   */
  getOrderedFiles() {
    const ordered = [];
    const visited = new Set();   // permanently visited
    const inStack = new Set();   // currently in the DFS call stack (cycle detection)

    const visit = (filePath) => {
      if (visited.has(filePath)) return;

      if (inStack.has(filePath)) {
        process.stderr.write(`[dywo module-graph] Circular dependency detected at ${filePath} — skipping back-edge.\n`);
        return;
      }

      inStack.add(filePath);

      const node = this.nodes.get(filePath);
      if (node) {
        for (const dep of node.imports) {
          visit(dep);
        }
      }

      inStack.delete(filePath);
      visited.add(filePath);
      ordered.push(filePath);
    };

    for (const filePath of this.nodes.keys()) {
      visit(filePath);
    }

    return ordered;
  }

  // ---------------------------------------------------------------------------
  // Discovery
  // ---------------------------------------------------------------------------

  /**
   * Recursively find all `.dywo` files under `srcDir`, scan each one, and
   * populate the graph.
   *
   * @param {string} srcDir  Absolute path to the source directory.
   * @returns {Promise<string[]>}  Absolute paths of discovered files.
   */
  async discoverAll(srcDir) {
    const files = await _findDywoFiles(srcDir);

    for (const filePath of files) {
      if (!this.nodes.has(filePath) || this.nodes.get(filePath).mtime === null) {
        await this.scanFile(filePath);
      }
    }

    return files;
  }

  // ---------------------------------------------------------------------------
  // HMR helpers
  // ---------------------------------------------------------------------------

  /**
   * Check whether a file's on-disk modification time is newer than what was
   * recorded when the graph was last built.
   *
   * @param {string} filePath     Absolute path.
   * @param {number} lastModified Known-good mtime in milliseconds (e.g. from
   *                              a previous `scanFile` call stored externally).
   *                              If omitted, compares against the graph's own
   *                              stored mtime.
   * @returns {boolean}
   */
  hasChanged(filePath, lastModified) {
    const node = this.nodes.get(filePath);

    // If we have no record of this file it's effectively new → changed.
    if (!node) return true;

    const reference = lastModified !== undefined ? lastModified : node.mtime;
    if (reference === null) return true;

    try {
      const stat = fs.statSync(filePath);
      return stat.mtimeMs > reference;
    } catch (_) {
      // File disappeared → treat as changed so consumers can react.
      return true;
    }
  }

  /**
   * Given a file that has changed, return the set of files that need to be
   * recompiled: the changed file itself plus all transitive dependents.
   *
   * @param {string} changedFile  Absolute path to the changed file.
   * @returns {string[]}
   */
  getAffectedFiles(changedFile) {
    const affected = new Set();
    const queue = [changedFile];

    while (queue.length > 0) {
      const current = queue.shift();
      if (affected.has(current)) continue; // already processed
      affected.add(current);

      const node = this.nodes.get(current);
      if (node) {
        for (const dependent of node.dependents) {
          if (!affected.has(dependent)) {
            queue.push(dependent);
          }
        }
      }
    }

    return Array.from(affected);
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Extract the content of the first `<script>…</script>` block in a .dywo file.
 * Returns an empty string if no block is found.
 *
 * @param {string} source  Full .dywo file source.
 * @returns {string}
 */
function _extractScriptBlock(source) {
  const match = source.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
  return match ? match[1] : '';
}

/**
 * Extract all import specifiers from a script string.
 *
 * @param {string} scriptContent
 * @returns {string[]}
 */
function _extractImportSpecifiers(scriptContent) {
  const specifiers = new Set();
  let match;

  const importRe = new RegExp(IMPORT_RE.source, 'g');
  while ((match = importRe.exec(scriptContent)) !== null) {
    specifiers.add(match[1]);
  }

  const sideEffectRe = new RegExp(SIDE_EFFECT_IMPORT_RE.source, 'g');
  while ((match = sideEffectRe.exec(scriptContent)) !== null) {
    specifiers.add(match[1]);
  }

  return Array.from(specifiers);
}

/**
 * Recursively collect all `.dywo` files under a directory.
 *
 * @param {string} dir  Absolute path to search.
 * @returns {Promise<string[]>}
 */
async function _findDywoFiles(dir) {
  const results = [];

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (_) {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await _findDywoFiles(fullPath);
      results.push(...nested);
    } else if (entry.isFile() && entry.name.endsWith('.dywo')) {
      results.push(fullPath);
    }
  }

  return results;
}

module.exports = ModuleGraph;
