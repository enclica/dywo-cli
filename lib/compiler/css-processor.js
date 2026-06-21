'use strict';

/**
 * CSS Processor for the DYWO compiler pipeline.
 * Handles scoping, autoprefixing, minification, and compressed output.
 *
 * Tries to use postcss + autoprefixer + cssnano when available.
 * Falls back to built-in implementations when they are not installed.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);
const brotliCompress = promisify(zlib.brotliCompress);

// ---------------------------------------------------------------------------
// Try to load optional peer dependencies
// ---------------------------------------------------------------------------

let postcss = null;
let autoprefixerPlugin = null;
let cssnanoPlugin = null;

try {
  postcss = require('postcss');
} catch (_) {
  // postcss not installed – will use fallback implementations
}

try {
  autoprefixerPlugin = require('autoprefixer');
} catch (_) {
  // autoprefixer not installed – will use built-in prefix logic
}

try {
  cssnanoPlugin = require('cssnano');
} catch (_) {
  // cssnano not installed – will use built-in minifier
}

// ---------------------------------------------------------------------------
// Built-in autoprefixer fallback
// Adds common vendor prefixes for flex, transform, grid, transition,
// user-select, appearance, and placeholder selectors.
// ---------------------------------------------------------------------------

function builtinAutoprefixer(css) {
  // flex-related
  css = css.replace(/(\s)(display\s*:\s*flex)/g, '$1display: -webkit-box;\n  display: -ms-flexbox;\n  $2');
  css = css.replace(/(\s)(flex\s*:\s*([^;]+))/g, '$1-webkit-box-flex: $3;\n  -ms-flex: $3;\n  $2');
  css = css.replace(/(\s)(flex-direction\s*:\s*([^;]+))/g, '$1-webkit-box-orient: $3;\n  -ms-flex-direction: $3;\n  $2');
  css = css.replace(/(\s)(flex-wrap\s*:\s*([^;]+))/g, '$1-ms-flex-wrap: $3;\n  $2');
  css = css.replace(/(\s)(align-items\s*:\s*([^;]+))/g, '$1-webkit-box-align: $3;\n  -ms-flex-align: $3;\n  $2');
  css = css.replace(/(\s)(justify-content\s*:\s*([^;]+))/g, '$1-webkit-box-pack: $3;\n  -ms-flex-pack: $3;\n  $2');

  // transform
  css = css.replace(/(\s)(transform\s*:\s*([^;]+))/g, '$1-webkit-transform: $3;\n  -ms-transform: $3;\n  $2');

  // transition
  css = css.replace(/(\s)(transition\s*:\s*([^;]+))/g, '$1-webkit-transition: $3;\n  $2');

  // user-select
  css = css.replace(/(\s)(user-select\s*:\s*([^;]+))/g, '$1-webkit-user-select: $3;\n  -moz-user-select: $3;\n  -ms-user-select: $3;\n  $2');

  // appearance
  css = css.replace(/(\s)(appearance\s*:\s*([^;]+))/g, '$1-webkit-appearance: $3;\n  -moz-appearance: $3;\n  $2');

  // grid
  css = css.replace(/(\s)(display\s*:\s*grid)/g, '$1display: -ms-grid;\n  $2');

  return css;
}

// ---------------------------------------------------------------------------
// Built-in CSS minifier fallback
// ---------------------------------------------------------------------------

function builtinMinify(css) {
  // Remove single-line comments (but not url(//...))
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  // Collapse whitespace (spaces, tabs, newlines) to a single space
  css = css.replace(/\s+/g, ' ');
  // Remove spaces around structural characters
  css = css.replace(/\s*{\s*/g, '{');
  css = css.replace(/\s*}\s*/g, '}');
  css = css.replace(/\s*:\s*/g, ':');
  css = css.replace(/\s*;\s*/g, ';');
  css = css.replace(/\s*,\s*/g, ',');
  // Remove trailing semicolons before closing braces
  css = css.replace(/;}/g, '}');
  // Collapse zero values
  css = css.replace(/(\s|:)0(px|em|rem|%|vh|vw)/g, '$10');
  return css.trim();
}

// ---------------------------------------------------------------------------
// PostCSS scoping plugin (used when postcss is available)
// ---------------------------------------------------------------------------

/**
 * Returns a PostCSS plugin that prepends [data-{scopeId}] to every selector
 * that is not inside @keyframes.
 */
function createScopingPlugin(scopeId) {
  const attr = `[data-${scopeId}]`;

  return {
    postcssPlugin: 'dywo-scope',
    Once(root) {
      root.walkRules(rule => {
        // Don't scope keyframe selectors (from, to, percentages)
        let parent = rule.parent;
        while (parent) {
          if (parent.type === 'atrule' && /keyframes$/i.test(parent.name)) {
            return;
          }
          parent = parent.parent;
        }

        rule.selectors = rule.selectors.map(selector => {
          selector = selector.trim();

          // :root special case – scope as :root[data-xxx] not [data-xxx]:root
          if (selector === ':root') {
            return `:root${attr}`;
          }

          // * universal selector
          if (selector === '*') {
            return `*${attr}`;
          }

          // For everything else, append the attribute to the last simple selector
          // before any pseudo-element (::before / ::after)
          const pseudoElementMatch = selector.match(/(::[\w-]+.*)$/);
          if (pseudoElementMatch) {
            const idx = selector.lastIndexOf(pseudoElementMatch[1]);
            return selector.slice(0, idx) + attr + selector.slice(idx);
          }

          return selector + attr;
        });
      });
    }
  };
}

// ---------------------------------------------------------------------------
// Regex-based scoping fallback (used when postcss is NOT available)
// ---------------------------------------------------------------------------

function regexScope(css, scopeId) {
  const attr = `[data-${scopeId}]`;

  // We process rule-by-rule by splitting on '{' and '}' boundaries.
  // This is intentionally simple and handles the common cases.
  const lines = css.split('\n');
  const result = [];
  let insideKeyframes = false;
  let depth = 0;
  let keyframeDepth = -1;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect @keyframes block entry
    if (/^@(-webkit-|-moz-|-o-|-ms-)?keyframes\b/.test(trimmed)) {
      insideKeyframes = true;
      keyframeDepth = depth;
    }

    const openCount = (line.match(/{/g) || []).length;
    const closeCount = (line.match(/}/g) || []).length;

    // Lines that are rule openers (contain selectors + '{')
    if (!insideKeyframes && trimmed.includes('{') && !trimmed.startsWith('@')) {
      const scopedLine = line.replace(/([^{]+){/, (match, selectorsPart) => {
        const scoped = scopeSelectors(selectorsPart.trim(), attr);
        return `${scoped} {`;
      });
      result.push(scopedLine);
    } else {
      result.push(line);
    }

    depth += openCount - closeCount;

    // Detect keyframe block exit
    if (insideKeyframes && depth <= keyframeDepth) {
      insideKeyframes = false;
      keyframeDepth = -1;
    }
  }

  return result.join('\n');
}

function scopeSelectors(selectorGroup, attr) {
  return selectorGroup
    .split(',')
    .map(s => {
      s = s.trim();
      if (!s) return s;
      if (s === ':root') return `:root${attr}`;
      if (s === '*') return `*${attr}`;
      const pseudoMatch = s.match(/(::[\w-]+.*)$/);
      if (pseudoMatch) {
        const idx = s.lastIndexOf(pseudoMatch[1]);
        return s.slice(0, idx) + attr + s.slice(idx);
      }
      return s + attr;
    })
    .join(', ');
}

// ---------------------------------------------------------------------------
// Core CSS processing helpers
// ---------------------------------------------------------------------------

async function runPostcss(css, plugins, options = {}) {
  const result = await postcss(plugins).process(css, {
    from: options.from || undefined,
    map: options.sourcemap ? { inline: false } : false
  });
  return result.css;
}

async function applyAutoprefixer(css, options) {
  if (!options.autoprefixer) return css;

  if (postcss && autoprefixerPlugin) {
    return runPostcss(css, [autoprefixerPlugin()], options);
  }
  return builtinAutoprefixer(css);
}

async function applyMinify(css, options) {
  if (!options.minify) return css;

  if (postcss && cssnanoPlugin) {
    return runPostcss(css, [cssnanoPlugin({ preset: 'default' })], options);
  }
  return builtinMinify(css);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const CSSProcessor = {
  /**
   * Process a CSS string with scoping applied.
   * Optionally runs autoprefixer and minification.
   *
   * @param {string} css
   * @param {string} scopeId  e.g. "dywo-abc123"
   * @param {object} options
   * @returns {Promise<string>}
   */
  async processScoped(css, scopeId, options = {}) {
    const opts = {
      minify: true,
      autoprefixer: true,
      sourcemap: false,
      ...options
    };

    let result = css;

    // 1. Scope
    if (postcss) {
      const scopePlugin = createScopingPlugin(scopeId);
      scopePlugin.postcssPlugin = 'dywo-scope'; // required by postcss 8
      result = await runPostcss(result, [{ postcssPlugin: 'dywo-scope', Once: scopePlugin.Once }], opts);
    } else {
      result = regexScope(result, scopeId);
    }

    // 2. Autoprefixer
    result = await applyAutoprefixer(result, opts);

    // 3. Minify
    result = await applyMinify(result, opts);

    return result;
  },

  /**
   * Process a raw CSS string (no scoping).
   *
   * @param {string} css
   * @param {object} options
   * @returns {Promise<string>}
   */
  async process(css, options = {}) {
    const opts = {
      minify: true,
      autoprefixer: true,
      sourcemap: false,
      ...options
    };

    let result = css;
    result = await applyAutoprefixer(result, opts);
    result = await applyMinify(result, opts);
    return result;
  },

  /**
   * Combine an array of CSS strings and process them together.
   *
   * @param {string[]} cssArray
   * @param {object} options
   * @returns {Promise<string>}
   */
  async combine(cssArray, options = {}) {
    const combined = cssArray.filter(Boolean).join('\n');
    return this.process(combined, options);
  },

  /**
   * Write processed CSS to a file. Optionally writes .gz and .br sidecars.
   *
   * @param {string} css
   * @param {string} outputPath
   * @param {object} options
   */
  async writeOutput(css, outputPath, options = {}) {
    const opts = {
      gzip: false,
      brotli: false,
      ...options
    };

    const dir = path.dirname(outputPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outputPath, css, 'utf8');

    const buf = Buffer.from(css, 'utf8');

    if (opts.gzip) {
      const gz = await gzip(buf, { level: zlib.constants.Z_BEST_COMPRESSION });
      fs.writeFileSync(outputPath + '.gz', gz);
    }

    if (opts.brotli) {
      const br = await brotliCompress(buf, {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY
        }
      });
      fs.writeFileSync(outputPath + '.br', br);
    }
  }
};

module.exports = CSSProcessor;
