'use strict';

/**
 * HTML Processor for the DYWO compiler pipeline.
 * Handles minification, asset injection, template scoping, and full-page builds.
 *
 * Tries to use html-minifier-terser when available; falls back to a
 * built-in implementation otherwise.
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Try to load optional peer dependency
// ---------------------------------------------------------------------------

let htmlMinifierTerser = null;

try {
  htmlMinifierTerser = require('html-minifier-terser');
} catch (_) {
  // Not installed – will use built-in minifier
}

// ---------------------------------------------------------------------------
// Built-in HTML minifier fallback
// ---------------------------------------------------------------------------

/**
 * Minimal HTML minification without external dependencies.
 * - Strips HTML comments (preserves IE conditionals: <!--[if ...]>)
 * - Collapses inter-tag whitespace
 * - Collapses runs of whitespace inside text nodes to a single space
 */
function builtinMinify(html) {
  // Remove HTML comments but keep IE conditional comments
  html = html.replace(/<!--(?!\[if\s)[\s\S]*?-->/g, '');

  // Collapse whitespace between tags
  html = html.replace(/>\s+</g, '><');

  // Collapse multiple spaces/tabs/newlines inside text to a single space
  html = html.replace(/\s{2,}/g, ' ');

  return html.trim();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const HTMLProcessor = {
  /**
   * Minify an HTML string.
   * Uses html-minifier-terser when available, falls back to built-in.
   *
   * @param {string} html
   * @param {object} options
   * @returns {Promise<string>}
   */
  async minify(html, options = {}) {
    if (htmlMinifierTerser) {
      const defaults = {
        collapseWhitespace: true,
        removeComments: true,
        removeOptionalTags: false,
        removeRedundantAttributes: true,
        removeScriptTypeAttributes: true,
        removeStyleLinkTypeAttributes: true,
        minifyCSS: true,
        minifyJS: true,
        ...options
      };
      return htmlMinifierTerser.minify(html, defaults);
    }

    // Built-in fallback
    return builtinMinify(html);
  },

  /**
   * Inject <link> and <script> tags into an HTML template string.
   * Styles are inserted before </head>; scripts before </body>.
   * If neither tag exists the assets are appended to the end.
   *
   * @param {string} template   Base HTML string
   * @param {{ scripts?: string[], styles?: string[], title?: string }} assets
   * @returns {string}
   */
  inject(template, { scripts = [], styles = [], title = '' } = {}) {
    let html = template;

    // Optionally set/replace <title>
    if (title) {
      if (/<title>/i.test(html)) {
        html = html.replace(/<title>[^<]*<\/title>/i, `<title>${title}</title>`);
      } else {
        html = html.replace(/<\/head>/i, `  <title>${title}</title>\n</head>`);
      }
    }

    // Build link tags
    const linkTags = styles
      .map(href => `  <link rel="stylesheet" href="${href}">`)
      .join('\n');

    // Build script tags
    const scriptTags = scripts
      .map(src => `  <script src="${src}"></script>`)
      .join('\n');

    // Inject styles before </head>
    if (linkTags) {
      if (/<\/head>/i.test(html)) {
        html = html.replace(/<\/head>/i, `${linkTags}\n</head>`);
      } else {
        html += '\n' + linkTags;
      }
    }

    // Inject scripts before </body>
    if (scriptTags) {
      if (/<\/body>/i.test(html)) {
        html = html.replace(/<\/body>/i, `${scriptTags}\n</body>`);
      } else {
        html += '\n' + scriptTags;
      }
    }

    return html;
  },

  /**
   * Add a data-{scopeId} attribute to the root element of a template fragment.
   * Only the FIRST element in the content receives the attribute.
   * Handles existing attributes, self-closing tags, and plain tags.
   *
   * @param {string} templateContent   Inner HTML of a <template> block
   * @param {string} scopeId           e.g. "dywo-abc123"
   * @returns {string}
   */
  processTemplate(templateContent, scopeId) {
    const attr = `data-${scopeId}`;

    // Match the first opening HTML tag (not a comment, not <!DOCTYPE>)
    // Group 1: tag name + existing attributes, Group 2: optional self-close /
    return templateContent.replace(
      /(<(?![\/?!])[a-zA-Z][a-zA-Z0-9-]*)([^>]*?)(\/?)>/,
      (match, tagOpen, attrs, selfClose) => {
        // Don't add the attribute twice
        if (attrs.includes(attr)) {
          return match;
        }
        const closing = selfClose ? ' />' : '>';
        return `${tagOpen}${attrs} ${attr}${closing}`;
      }
    );
  },

  /**
   * Read an HTML template file from disk, inject assets, and optionally minify.
   *
   * @param {string} templatePath   Absolute path to the HTML template file
   * @param {{ scripts?: string[], styles?: string[], title?: string }} assets
   * @param {{ minify?: boolean }} options
   * @returns {Promise<string>}
   */
  async buildPage(templatePath, assets = {}, options = {}) {
    const opts = {
      minify: true,
      ...options
    };

    let html = fs.readFileSync(templatePath, 'utf8');

    // Inject assets
    html = this.inject(html, assets);

    // Minify
    if (opts.minify) {
      html = await this.minify(html);
    }

    return html;
  }
};

module.exports = HTMLProcessor;
