'use strict';

/**
 * Parse a .dywo Single File Component file.
 * Returns extracted template, styles, and script blocks.
 *
 * @param {string} source   Raw file content
 * @param {string} filePath Absolute file path (for error messages)
 * @returns {DywoParsed}
 *
 * @typedef {Object} DywoParsed
 * @property {{ content: string, start: number, end: number }|null} template
 * @property {Array<{ content: string, scoped: boolean, lang: string, start: number, end: number }>} styles
 * @property {{ content: string, lang: string, start: number, end: number }|null} script
 */
function parseSFC(source, filePath) {
  const result = {
    template: null,
    styles: [],
    script: null,
    filename: filePath
  };

  // Match <template>, <style [scoped]>, <script> blocks
  // Use a regex that handles multiline content and attributes
  const blockRe = /<(template|style|script)(\s[^>]*)?>[\s\S]*?<\/\1>/gi;

  let match;
  while ((match = blockRe.exec(source)) !== null) {
    const tag = match[1].toLowerCase();
    const attrs = match[2] || '';
    const fullMatch = match[0];
    const start = match.index;
    const end = start + fullMatch.length;

    // Extract inner content (between opening and closing tag)
    const openTagEnd = fullMatch.indexOf('>') + 1;
    const closeTagStart = fullMatch.lastIndexOf(`</${tag}>`);
    const content = fullMatch.slice(openTagEnd, closeTagStart).trim();

    if (tag === 'template' && !result.template) {
      result.template = { content, start, end };
    } else if (tag === 'style') {
      const scoped = /\bscoped\b/i.test(attrs);
      const lang = /lang=['"]([^'"]+)['"]/i.exec(attrs);
      result.styles.push({
        content,
        scoped,
        lang: lang ? lang[1] : 'css',
        start,
        end
      });
    } else if (tag === 'script' && !result.script) {
      const lang = /lang=['"]([^'"]+)['"]/i.exec(attrs);
      result.script = {
        content,
        lang: lang ? lang[1] : 'js',
        start,
        end
      };
    }
  }

  return result;
}

/**
 * Extract the component name from a script block.
 * Looks for `name: 'Foo'` in the export default object.
 */
function extractComponentName(scriptContent, filePath) {
  if (!scriptContent) {
    // Derive from filename
    const base = require('path').basename(filePath, '.dywo');
    return base.charAt(0).toUpperCase() + base.slice(1);
  }
  const match = /name\s*:\s*['"]([^'"]+)['"]/i.exec(scriptContent);
  if (match) return match[1];
  // Fallback to filename
  const base = require('path').basename(filePath, '.dywo');
  return base.charAt(0).toUpperCase() + base.slice(1);
}

module.exports = { parseSFC, extractComponentName };
