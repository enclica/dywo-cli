'use strict';

const { parseSFC } = require('./parser');
const { generateScopeId } = require('./scope-id');

/**
 * Webpack loader for .dywo Single File Component files.
 * Transforms a .dywo file into a JS module that:
 * - Exports the component options object
 * - Has __template, __styles, __scopeId, __file injected
 * - Injects scoped styles into the document at runtime
 */
module.exports = function dywoLoader(source) {
  const filePath = this.resourcePath;
  const projectRoot = this.rootContext || process.cwd();

  // Tell webpack this loader result is not cacheable during dev (to support HMR)
  // this.cacheable && this.cacheable(false);

  const parsed = parseSFC(source, filePath);
  const scopeId = generateScopeId(filePath, projectRoot);

  // ── Template processing ──────────────────────────────────────────────────
  const rawTemplate = parsed.template ? parsed.template.content : '<div></div>';
  // Add scope attribute to root element
  const template = addScopeAttr(rawTemplate, scopeId);

  // ── Style processing ─────────────────────────────────────────────────────
  // Scope CSS and collect as strings
  const styles = parsed.styles.map(style => {
    if (style.scoped) {
      return scopeCSS(style.content, scopeId);
    }
    return style.content;
  });

  // ── Script processing ────────────────────────────────────────────────────
  let scriptContent = parsed.script ? parsed.script.content : 'export default {};';

  // Transform ES module export default to a variable capture
  // Handle both:  export default { ... }  and  export default class Foo { ... }
  // We'll wrap it so we can capture the value
  const transformedScript = transformScript(scriptContent);

  // ── Generate output module ───────────────────────────────────────────────
  const output = generateModule(template, styles, scopeId, filePath, transformedScript);

  return output;
};

/**
 * Add data-{scopeId} boolean attribute to the root element of an HTML template.
 */
function addScopeAttr(html, scopeId) {
  return html.replace(/(<[a-z][a-z0-9-]*)(\s|>|\/)/gi, (m, tag, rest) => {
    return `${tag} data-${scopeId}${rest}`;
  });
}

/**
 * Scope CSS: append [data-{scopeId}] to all selectors.
 * Handles @media, @keyframes, :root, * correctly.
 */
function scopeCSS(css, scopeId) {
  const attr = `[data-${scopeId}]`;

  // Simple state machine: track whether we're inside @keyframes
  let inKeyframes = false;

  return css.replace(/([^{}]+)\{/g, (match, selector) => {
    const trimmed = selector.trim();

    // @rules: detect keyframes entry/exit
    if (/^@keyframes/i.test(trimmed)) {
      inKeyframes = true;
      return match;
    }
    if (/^@/.test(trimmed)) {
      return match; // @media, @supports, etc. — don't scope
    }

    // Inside @keyframes: selectors are percentages / from / to, don't scope
    if (inKeyframes) {
      // We'd need bracket counting to know when keyframes ends
      // Simple heuristic: if selector is from/to or percentage, skip
      if (/^(from|to|\d+%)$/i.test(trimmed)) return match;
    }

    // Scope each comma-separated selector
    const scoped = trimmed.split(',').map(sel => {
      sel = sel.trim();
      if (!sel) return sel;

      // :root → [data-scopeId]
      if (sel === ':root') return attr;
      // * → *[data-scopeId]
      if (sel === '*') return `*${attr}`;

      // Insert scope before pseudo-elements (::before, ::after)
      if (/::/.test(sel)) {
        return sel.replace(/::/, `${attr}::`);
      }

      return `${sel}${attr}`;
    }).join(', ');

    return `${scoped} {`;
  });
}

/**
 * Transform an ES module script block so the default export is captured into
 * a local variable we can attach metadata to before re-exporting.
 *
 * Handles every legal `export default` form:
 *   - export default { ... }
 *   - export default class Foo { ... }
 *   - export default function Foo() { ... }
 *   - export default function () { ... }
 *   - export default <identifier> / <expression>;
 *
 * Named exports (export const, export { }) are left untouched — they remain
 * valid ESM and webpack keeps them alongside the default export.
 */
function transformScript(script) {
  // Replace every `export default ` with `var __componentOptions = `.
  // This single pass correctly handles all legal default-export forms:
  //   export default { … }            → var __componentOptions = { … }       (object literal)
  //   export default class Foo { … }  → var __componentOptions = class Foo … (class expression)
  //   export default function () {}   → var __componentOptions = function () {} (fn expression)
  //   export default function* gen()  → var __componentOptions = function* gen()
  //   export default async function f → var __componentOptions = async function f
  //   export default MyApp;           → var __componentOptions = MyApp;     (expression)
  // Named exports (export const, export { }) are left untouched.
  let transformed = script.replace(/export\s+default\s+/g, 'var __componentOptions = ');

  // If no export default was found, add a default empty one.
  if (!/var __componentOptions/.test(transformed)) {
    transformed += '\nvar __componentOptions = {};';
  }

  return transformed;
}

/**
 * Generate the final ES module output string.
 *
 * The output must be consistently ESM: user <script> blocks may contain
 * `import` statements, which webpack treats as an ESM marker. Mixing
 * `module.exports` (CJS) into an ESM module throws
 * "ES Modules may not assign module.exports or exports.*". We therefore
 * re-export via `export default`.
 */
function generateModule(template, styles, scopeId, filePath, script) {
  // Escape template and styles for JS string embedding
  const templateStr = JSON.stringify(template);
  const stylesStr = JSON.stringify(styles);
  const fileStr = JSON.stringify(filePath);

  return `
// DYWO SFC compiled module
// Source: ${filePath}

// ── Inject scoped styles ───────────────────────────────────────────────
var __styles = ${stylesStr};
var __scopeId = ${JSON.stringify(scopeId)};
var __cssText = __styles.filter(Boolean).join('\\n');

if (typeof document !== 'undefined' && __cssText) {
  if (!document.querySelector('style[data-dywo-scope="' + __scopeId + '"]')) {
    var el = document.createElement('style');
    el.setAttribute('data-dywo-scope', __scopeId);
    el.textContent = __cssText;
    document.head.appendChild(el);
  }
}

// ── Component script ─────────────────────────────────────────────────────
${script}

if (typeof __componentOptions === 'undefined') {
  var __componentOptions = {};
}

// ── Attach DYWO metadata ─────────────────────────────────────────────────
__componentOptions.__template = ${templateStr};
__componentOptions.__styles = __styles;
__componentOptions.__scopeId = ${JSON.stringify(scopeId)};
__componentOptions.__file = ${fileStr};

export default __componentOptions;
`;
}
