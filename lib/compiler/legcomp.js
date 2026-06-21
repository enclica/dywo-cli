'use strict';

/**
 * LEGCOMP — Legacy Compatibility Compiler for DYWO
 *
 * Transforms a DYWO project into very basic HTML/CSS/JS that works on
 * browsers from the 1995-2000 era (IE 4/5, Netscape 3/4, Opera 3-5).
 *
 * - Output is ES3 JavaScript (no const/let, arrows, template literals)
 * - CSS is stripped to CSS 1 features (no flexbox, grid, CSS variables)
 * - SPA routing uses hash-based navigation only
 * - DYWOBP polyfill is loaded FIRST, then the legacy runtime, then app
 * - Everything can be embedded in a single HTML file for maximum compat
 * - Emits compatibility warnings for modern features it encounters
 *
 * Usage:
 *   const legcomp = require('./legcomp');
 *   legcomp.compile(projectRoot, config);  // writes dist/legacy/
 */

const path = require('path');
const fs = require('fs');
const nativeFs = require('fs');

const { parseSFC } = require('./parser');

// ─────────────────────────────────────────────────────────────────
// COMPATIBILITY WARNING TRACKING
// ─────────────────────────────────────────────────────────────────

const MODERN_CSS_FEATURES = [
  { re: /display\s*:\s*flex/g, feature: 'flexbox', fallback: 'block/table' },
  { re: /display\s*:\s*grid/g, feature: 'CSS grid', fallback: 'float/table' },
  { re: /display\s*:\s*inline-flex/g, feature: 'inline-flex', fallback: 'inline' },
  { re: /gap\s*:/g, feature: 'gap', fallback: 'margin' },
  { re: /var\(--/g, feature: 'CSS custom properties', fallback: 'hardcoded values' },
  { re: /calc\(/g, feature: 'calc()', fallback: 'fixed values' },
  { re: /clamp\(/g, feature: 'clamp()', fallback: 'fixed values' },
  { re: /min\(/g, feature: 'min()', fallback: 'fixed values' },
  { re: /max\(/g, feature: 'max()', fallback: 'fixed values' },
  { re: /@media\s+\(/g, feature: 'media queries (parenthetical)', fallback: 'basic @media' },
  { re: /transition\s*:/g, feature: 'transitions', fallback: 'none' },
  { re: /animation\s*:/g, feature: 'animations', fallback: 'none' },
  { re: /transform\s*:/g, feature: 'transforms', fallback: 'none' },
  { re: /border-radius\s*:/g, feature: 'border-radius', fallback: 'square corners' },
  { re: /box-shadow\s*:/g, feature: 'box-shadow', fallback: 'borders only' },
  { re: /text-shadow\s*:/g, feature: 'text-shadow', fallback: 'none' },
  { re: /opacity\s*:/g, feature: 'opacity', fallback: 'solid colors only' },
  { re: /rgba?\(/g, feature: 'rgba colors', fallback: 'hex colors (no alpha)' },
  { re: /position\s*:\s*fixed/g, feature: 'position: fixed', fallback: 'position: absolute' },
  { re: /position\s*:\s*sticky/g, feature: 'position: sticky', fallback: 'position: static' },
  { re: /object-fit\s*:/g, feature: 'object-fit', fallback: 'none' },
  { re: /backdrop-filter\s*:/g, feature: 'backdrop-filter', fallback: 'none' },
  { re: /filter\s*:/g, feature: 'filter', fallback: 'none' },
  { re: /grid-template/g, feature: 'grid-template', fallback: 'float/table' },
  { re: /place-items/g, feature: 'place-items', fallback: 'text-align/margin' },
  { re: /justify-content/g, feature: 'justify-content', fallback: 'text-align/margin' },
  { re: /align-items/g, feature: 'align-items', fallback: 'vertical-align' },
  { re: /flex-direction/g, feature: 'flex-direction', fallback: 'display block' },
  { re: /flex-wrap/g, feature: 'flex-wrap', fallback: 'none' },
  { re: /flex-grow/g, feature: 'flex-grow', fallback: 'none' },
  { re: /flex-shrink/g, feature: 'flex-shrink', fallback: 'none' },
  { re: /order\s*:/g, feature: 'order', fallback: 'source order' },
  { re: /@keyframes/g, feature: '@keyframes', fallback: 'none' },
  { re: /@supports/g, feature: '@supports', fallback: 'none' },
  { re: /:nth-child/g, feature: ':nth-child', fallback: 'class-based selection' },
  { re: /::before/g, feature: '::before', fallback: 'extra elements' },
  { re: /::after/g, feature: '::after', fallback: 'extra elements' },
  { re: /placeholder\s*:/g, feature: 'placeholder styles', fallback: 'none' },
  { re: /appearance\s*:/g, feature: 'appearance', fallback: 'default' },
  { re: /user-select\s*:/g, feature: 'user-select', fallback: 'none' },
  { re: /cursor\s*:\s*pointer/g, feature: 'cursor: pointer (use hand for IE5)', fallback: 'cursor: hand' },
  { re: /font-display/g, feature: 'font-display', fallback: 'none' },
  { re: /-webkit-/g, feature: 'vendor prefixes', fallback: 'standard only' },
  { re: /-moz-/g, feature: 'vendor prefixes', fallback: 'standard only' },
  { re: /-ms-/g, feature: 'vendor prefixes', fallback: 'standard only' },
  { re: /-o-/g, feature: 'vendor prefixes', fallback: 'standard only' },
];

const MODERN_JS_FEATURES = [
  { re: /\bconst\s+/g, feature: 'const', transform: 'var' },
  { re: /\blet\s+/g, feature: 'let', transform: 'var' },
  { re: /=>/g, feature: 'arrow functions', transform: 'function' },
  { re: /`/g, feature: 'template literals', transform: 'string concatenation' },
  { re: /\?\?/g, feature: 'nullish coalescing', transform: '||' },
  { re: /\?\./g, feature: 'optional chaining', transform: 'manual checks' },
  { re: /\.\.\./g, feature: 'spread operator', transform: 'concat/apply' },
  { re: /\bclass\s+/g, feature: 'ES6 class', transform: 'constructor function' },
  { re: /\basync\s+/g, feature: 'async/await', transform: 'callbacks' },
  { re: /\bawait\b/g, feature: 'async/await', transform: 'callbacks' },
  { re: /\bPromise\b/g, feature: 'Promise', transform: 'callbacks' },
  { re: /\bSymbol\b/g, feature: 'Symbol', transform: 'strings' },
  { re: /\bMap\b/g, feature: 'Map', transform: 'plain objects' },
  { re: /\bSet\b/g, feature: 'Set', transform: 'arrays' },
  { re: /\bProxy\b/g, feature: 'Proxy', transform: 'manual getters/setters' },
  { re: /\bfor\s*\(\s*.*\s+of\s+/g, feature: 'for...of', transform: 'for loop' },
  { re: /\bimport\s+/g, feature: 'ES module import', transform: 'removed (inlined)' },
  { re: /\bexport\s+/g, feature: 'ES module export', transform: 'removed (inlined)' },
];

// ─────────────────────────────────────────────────────────────────
// MAIN COMPILE FUNCTION
// ─────────────────────────────────────────────────────────────────

/**
 * Compile a DYWO project into legacy-compatible output.
 *
 * @param {string} projectRoot  Absolute path to the project.
 * @param {object} config       Resolved DYWO config (with legcomp settings).
 * @returns {Promise<{warnings: string[], outputDir: string}>}
 */
async function compile(projectRoot, config) {
  const legcompCfg = (config && config.legcomp) || {};
  const target = legcompCfg.target || 'ie5';
  const outputSubdir = legcompCfg.output || 'legacy';
  const embed = legcompCfg.embed !== false;
  const showWarnings = legcompCfg.warnings !== false;

  const warnings = [];
  const srcDir = config._resolvedSrc || path.resolve(projectRoot, config.srcDir || './src');
  const outputDir = config._resolvedOutput
    || path.resolve(projectRoot, (config.output && config.output.dir) || './dist');
  const legacyDir = path.join(outputDir, outputSubdir);

  // Collect all .dywo files
  const dywoFiles = collectDywoFiles(srcDir);

  // Parse all components
  const components = {};
  for (const file of dywoFiles) {
    const content = nativeFs.readFileSync(file, 'utf8');
    const parsed = parseSFC(content, file);
    const relPath = path.relative(srcDir, file);
    const name = componentFromFile(relPath);
    components[name] = {
      name: name,
      file: relPath,
      template: parsed.template ? parsed.template.content : '<div></div>',
      styles: parsed.styles.map(function (s) { return s.content; }).join('\n'),
      script: parsed.script ? parsed.script.content : '',
      data: extractData(parsed.script ? parsed.script.content : ''),
      routes: extractRoutes(parsed.script ? parsed.script.content : '')
    };
  }

  // Find root component (main.dywo or the entry)
  const entryFile = config.entry || './src/main.dywo';
  const entryBasename = componentFromFile(path.relative(srcDir, path.resolve(projectRoot, entryFile)));
  const rootComponent = components[entryBasename] || components['Main'] || components['App'];

  if (!rootComponent) {
    throw new Error('LEGCOMP: could not find root component. Expected main.dywo or App.dywo');
  }

  // Check for compatibility warnings
  if (showWarnings) {
    for (const name in components) {
      const comp = components[name];
      checkCSSWarnings(comp.styles, name, warnings);
      checkJSWarnings(comp.script, name, warnings);
      checkTemplateWarnings(comp.template, name, warnings);
    }
  }

  // Collect all CSS (strip modern features)
  let allCSS = '';
  for (const name in components) {
    allCSS += '/* ' + name + ' */\n' + stripModernCSS(components[name].styles) + '\n';
  }

  // Generate legacy runtime + app code
  const legacyRuntime = generateLegacyRuntime(components, rootComponent, target);
  const dywobpCode = readDYWOBP();

  // Generate HTML
  const html = generateLegacyHTML(rootComponent, allCSS, dywobpCode, legacyRuntime, embed, target);

  // Write output
  nativeFs.mkdirSync(legacyDir, { recursive: true });

  if (embed) {
    // Single file — everything embedded
    nativeFs.writeFileSync(path.join(legacyDir, 'index.html'), html, 'utf8');
  } else {
    // Separate files
    const htmlTemplate = generateLegacyHTML(rootComponent, '', '', '', false, target);
    // Split: HTML references external files
    const htmlSeparate = generateSeparateHTML(rootComponent, target);
    nativeFs.writeFileSync(path.join(legacyDir, 'index.html'), htmlSeparate, 'utf8');
    nativeFs.writeFileSync(path.join(legacyDir, 'dywobp.js'), dywobpCode, 'utf8');
    nativeFs.writeFileSync(path.join(legacyDir, 'dywo-legacy.js'), legacyRuntime, 'utf8');
    nativeFs.writeFileSync(path.join(legacyDir, 'styles.css'), allCSS, 'utf8');
  }

  // Copy public assets if they exist
  const publicDir = config._resolvedPublic || path.resolve(projectRoot, './public');
  if (nativeFs.existsSync(publicDir)) {
    copyDirSync(publicDir, legacyDir, ['index.html']);
  }

  return { warnings: warnings, outputDir: legacyDir };
}

// ─────────────────────────────────────────────────────────────────
// CSS TRANSFORMATION
// ─────────────────────────────────────────────────────────────────

/**
 * Strip modern CSS features and replace with fallbacks where possible.
 */
function stripModernCSS(css) {
  let result = css;

  // Remove CSS custom properties (var(--...)) — replace with fallback values
  // We can't resolve them, so we strip the var() wrapper and use any fallback
  result = result.replace(/var\([^,)]+(?:,\s*([^)]+))?\)/g, function (match, fallback) {
    return fallback || ''; // use fallback if provided, otherwise empty
  });

  // Remove :root blocks (CSS variables)
  result = result.replace(/:root\s*\{[^}]*\}/g, '/* :root stripped — CSS variables not supported */');

  // Replace cursor: pointer with cursor: hand for IE5
  result = result.replace(/cursor\s*:\s*pointer/g, 'cursor: hand');

  // Remove border-radius (not supported)
  result = result.replace(/border-radius\s*:[^;]+;/g, '/* border-radius removed */');

  // Remove box-shadow (not supported)
  result = result.replace(/box-shadow\s*:[^;]+;/g, '/* box-shadow removed */');

  // Remove text-shadow
  result = result.replace(/text-shadow\s*:[^;]+;/g, '/* text-shadow removed */');

  // Remove opacity
  result = result.replace(/opacity\s*:[^;]+;/g, '/* opacity removed */');

  // Remove transitions
  result = result.replace(/transition\s*:[^;]+;/g, '/* transition removed */');

  // Remove animations and @keyframes
  result = result.replace(/@keyframes\s+[^\{]+\{[^@]*?\}/g, '/* @keyframes removed */');
  result = result.replace(/animation\s*:[^;]+;/g, '/* animation removed */');

  // Remove transforms
  result = result.replace(/transform\s*:[^;]+;/g, '/* transform removed */');

  // Remove flexbox — replace with display: block
  result = result.replace(/display\s*:\s*flex\s*;/g, 'display: block;');
  result = result.replace(/display\s*:\s*inline-flex\s*;/g, 'display: inline;');
  result = result.replace(/display\s*:\s*grid\s*;/g, 'display: block;');

  // Remove gap
  result = result.replace(/gap\s*:[^;]+;/g, '/* gap removed */');

  // Remove calc() — can't compute, leave as-is or remove
  result = result.replace(/calc\([^)]+\)/g, '0');

  // Remove vendor prefixes
  result = result.replace(/-webkit-[^;]+;/g, '/* vendor prefix removed */');
  result = result.replace(/-moz-[^;]+;/g, '/* vendor prefix removed */');
  result = result.replace(/-ms-[^;]+;/g, '/* vendor prefix removed */');
  result = result.replace(/-o-[^;]+;/g, '/* vendor prefix removed */');

  // Replace rgba() with rgb() (no alpha support in very old browsers)
  result = result.replace(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+)?\s*\)/g,
    'rgb($1, $2, $3)');

  // Remove position: fixed → position: absolute
  result = result.replace(/position\s*:\s*fixed/g, 'position: absolute');

  // Remove position: sticky → position: static
  result = result.replace(/position\s*:\s*sticky/g, 'position: static');

  // Remove ::before, ::after, ::placeholder pseudo-elements
  result = result.replace(/::?before\s*[,{]/g, '/* ::before removed */');
  result = result.replace(/::?after\s*[,{]/g, '/* ::after removed */');
  result = result.replace(/::placeholder\s*[,{]/g, '/* ::placeholder removed */');

  // Remove :nth-child selectors
  result = result.replace(/:nth-child\([^)]+\)/g, '');

  // Remove @supports blocks
  result = result.replace(/@supports[^{]*\{[^@]*?\}/g, '/* @supports removed */');

  // Clean up multiple empty lines
  result = result.replace(/\n{3,}/g, '\n\n');

  return result;
}

// ─────────────────────────────────────────────────────────────────
// WARNING COLLECTION
// ─────────────────────────────────────────────────────────────────

function checkCSSWarnings(css, componentName, warnings) {
  for (var i = 0; i < MODERN_CSS_FEATURES.length; i++) {
    var feat = MODERN_CSS_FEATURES[i];
    if (feat.re.test(css)) {
      var matches = css.match(feat.re);
      warnings.push('[LEGCOMP] ' + componentName + ': CSS "' + feat.feature +
        '" is not supported in legacy browsers (' + matches.length +
        ' occurrence(s)). Fallback: ' + feat.fallback);
    }
  }
}

function checkJSWarnings(js, componentName, warnings) {
  for (var i = 0; i < MODERN_JS_FEATURES.length; i++) {
    var feat = MODERN_JS_FEATURES[i];
    if (feat.re.test(js)) {
      var matches = js.match(feat.re);
      warnings.push('[LEGCOMP] ' + componentName + ': JS "' + feat.feature +
        '" is not supported in legacy browsers (' + matches.length +
        ' occurrence(s)). Transform: ' + feat.transform);
    }
  }
}

function checkTemplateWarnings(template, componentName, warnings) {
  // Check for custom elements that need transformation
  var customTags = template.match(/<[A-Z][a-zA-Z0-9]*\s*\/?>/g);
  if (customTags) {
    warnings.push('[LEGCOMP] ' + componentName + ': Custom component tags (' +
      customTags.join(', ') + ') will be inlined as HTML');
  }
  if (template.indexOf('router-view') !== -1) {
    warnings.push('[LEGCOMP] ' + componentName + ': <router-view> will be replaced ' +
      'with a hash-based route container');
  }
  if (template.indexOf('{{') !== -1) {
    warnings.push('[LEGCOMP] ' + componentName + ': {{ }} interpolation will be ' +
      'replaced with runtime text replacement (no live reactivity in legacy mode)');
  }
  if (template.indexOf('dywo-for') !== -1) {
    warnings.push('[LEGCOMP] ' + componentName + ': dywo-for will be unrolled at render time');
  }
  if (template.indexOf('dywo-if') !== -1) {
    warnings.push('[LEGCOMP] ' + componentName + ': dywo-if will be evaluated at render time');
  }
}

// ─────────────────────────────────────────────────────────────────
// TEMPLATE PROCESSING
// ─────────────────────────────────────────────────────────────────

/**
 * Process a .dywo template into basic HTML with runtime interpolation markers.
 * Custom component tags are replaced with their templates inline.
 */
function processTemplate(template, components, warnings) {
  var result = template;

  // Replace custom component tags with their templates
  result = result.replace(/<([A-Z][a-zA-Z0-9]*)\s*\/>/g, function (match, tagName) {
    var comp = components[tagName];
    if (comp) {
      return processTemplate(comp.template, components, warnings);
    }
    return '<!-- ' + tagName + ' not found -->';
  });

  // Replace <router-view /> with a container div
  result = result.replace(/<router-view\s*\/?>/g, '<div id="__dywo_route"></div>');
  result = result.replace(/<\/router-view>/g, '');

  // Convert dywo-for to a comment marker (runtime will handle it)
  result = result.replace(/dywo-for="([^"]+)"/g, function (match, expr) {
    return 'data-dywo-for="' + expr.replace(/"/g, '&quot;') + '"';
  });

  // Convert dywo-if to a data attribute
  result = result.replace(/dywo-if="([^"]+)"/g, function (match, expr) {
    return 'data-dywo-if="' + expr.replace(/"/g, '&quot;') + '"';
  });

  // Convert dywo-link to data attribute (and add href)
  result = result.replace(/dywo-link/g, 'data-dywo-link');

  // Convert {{ }} to data markers
  // We keep {{ }} in the HTML — the legacy runtime will replace them

  return result;
}

// ─────────────────────────────────────────────────────────────────
// LEGACY RUNTIME GENERATION
// ─────────────────────────────────────────────────────────────────

/**
 * Generate the legacy runtime JavaScript (ES3 compatible).
 * This includes:
 *   - Simple component system (render to innerHTML)
 *   - Hash-based router
 *   - Text interpolation ({{ }} replacement)
 *   - dywo-if / dywo-for (static render)
 *   - dywo-link click handling
 */
function generateLegacyRuntime(components, rootComponent, target) {
  // Process all component templates
  var processedTemplates = {};
  var warnings = [];
  for (var name in components) {
    processedTemplates[name] = processTemplate(components[name].template, components, warnings);
  }

  // Extract route definitions from root component
  var routes = rootComponent.routes || [];

  // Build component data map
  var componentData = {};
  for (var compName in components) {
    componentData[compName] = components[compName].data || {};
  }

  // Serialize components for the runtime
  var componentsJson = serializeForES3({
    templates: processedTemplates,
    data: componentData,
    routes: routes
  });

  // Generate ES3 runtime code
  var code = '';
  code += '// DYWO Legacy Runtime — generated by LEGCOMP\n';
  code += '// Target: ' + target + ' (ES3, no Proxy, no querySelector native)\n';
  code += '// This runs AFTER dywobp.js which polyfills missing APIs\n';
  code += '(function (global) {\n';
  code += '  "use strict";\n\n';

  // Embed component data
  code += '  var __dywoComponents = ' + componentsJson + ';\n\n';

  // Simple expression evaluator (uses Function constructor, available in IE4+)
  code += '  function evalExpr(expr, ctx) {\n';
  code += '    try {\n';
  code += '      var keys = Object.keys(ctx);\n';
  code += '      var fn = new Function(keys.join(","), "return (" + expr + ");");\n';
  code += '      var vals = [];\n';
  code += '      for (var i = 0; i < keys.length; i++) vals.push(ctx[keys[i]]);\n';
  code += '      return fn.apply(ctx, vals);\n';
  code += '    } catch (e) {\n';
  code += '      return "";\n';
  code += '    }\n';
  code += '  }\n\n';

  // Text interpolation: replace {{ expr }} with evaluated value
  code += '  function interpolate(html, ctx) {\n';
  code += '    return html.replace(/\\{\\{\\s*([^}]+?)\\s*\\}\\}/g, function (match, expr) {\n';
  code += '      var val = evalExpr(expr, ctx);\n';
  code += '      return (val === null || val === undefined) ? "" : String(val);\n';
  code += '    });\n';
  code += '  }\n\n';

  // Process dywo-if: remove elements where condition is false
  code += '  function processIf(html, ctx) {\n';
  code += '    return html.replace(/<([^>]+)\\s+data-dywo-if="([^"]+)"([^>]*)>([\\s\\S]*?)<\\/\\1>/g, function (match, tag, expr, attrs, content) {\n';
  code += '      var show = !!evalExpr(expr, ctx);\n';
  code += '      return show ? "<" + tag + attrs + ">" + content + "</" + tag + ">" : "";\n';
  code += '    });\n';
  code += '  }\n\n';

  // Process dywo-for: unroll loops
  code += '  function processFor(html, ctx) {\n';
  code += '    return html.replace(/<([^>]+)\\s+data-dywo-for="([^"]+)"([^>]*)>([\\s\\S]*?)<\\/\\1>/g, function (match, tag, expr, attrs, content) {\n';
  code += '      var m = expr.match(/^(\\w+)(?:\\s*,\\s*(\\w+))?\\s+in\\s+(.+)$/);\n';
  code += '      if (!m) return "";\n';
  code += '      var itemVar = m[1], indexVar = m[2], listExpr = m[3];\n';
  code += '      var list = evalExpr(listExpr, ctx);\n';
  code += '      if (!list || !list.length) return "";\n';
  code += '      var result = "";\n';
  code += '      for (var i = 0; i < list.length; i++) {\n';
  code += '        var iterCtx = {};\n';
  code += '        for (var k in ctx) iterCtx[k] = ctx[k];\n';
  code += '        iterCtx[itemVar] = list[i];\n';
  code += '        if (indexVar) iterCtx[indexVar] = i;\n';
  code += '        var itemHtml = interpolate(content, iterCtx);\n';
  code += '        result += "<" + tag + attrs + ">" + itemHtml + "</" + tag + ">";\n';
  code += '      }\n';
  code += '      return result;\n';
  code += '    });\n';
  code += '  }\n\n';

  // Render a component
  code += '  function renderComponent(name, ctx) {\n';
  code += '    var comp = __dywoComponents.templates[name];\n';
  code += '    if (!comp) return "<!-- " + name + " not found -->";\n';
  code += '    var data = __dywoComponents.data[name] || {};\n';
  code += '    var fullCtx = {};\n';
  code += '    for (var k in data) fullCtx[k] = data[k];\n';
  code += '    if (ctx) for (var k2 in ctx) fullCtx[k2] = ctx[k2];\n';
  code += '    var html = comp;\n';
  code += '    html = processFor(html, fullCtx);\n';
  code += '    html = processIf(html, fullCtx);\n';
  code += '    html = interpolate(html, fullCtx);\n';
  code += '    return html;\n';
  code += '  }\n\n';

  // Router
  code += '  function getCurrentHash() {\n';
  code += '    var h = global.location.hash;\n';
  code += '    if (!h || h === "#") return "/";\n';
  code += '    return h.substring(1);\n';
  code += '  }\n\n';

  code += '  function matchRoute(pattern, path) {\n';
  code += '    if (pattern === "*") return {};\n';
  code += '    var pp = pattern.split("/");\n';
  code += '    var up = path.split("/");\n';
  code += '    if (pp.length !== up.length) return null;\n';
  code += '    var params = {};\n';
  code += '    for (var i = 0; i < pp.length; i++) {\n';
  code += '      if (pp[i].charAt(0) === ":") params[pp[i].substring(1)] = up[i];\n';
  code += '      else if (pp[i] !== up[i]) return null;\n';
  code += '    }\n';
  code += '    return params;\n';
  code += '  }\n\n';

  code += '  function renderRoute() {\n';
  code += '    var currentPath = getCurrentHash();\n';
  code += '    var routes = __dywoComponents.routes || [];\n';
  code += '    var matched = null, params = {};\n';
  code += '    for (var i = 0; i < routes.length; i++) {\n';
  code += '      var p = matchRoute(routes[i].path, currentPath);\n';
  code += '      if (p !== null) { matched = routes[i]; params = p; break; }\n';
  code += '    }\n';
  code += '    if (!matched) {\n';
  code += '      for (var j = 0; j < routes.length; j++) {\n';
  code += '        if (routes[j].path === "*") { matched = routes[j]; break; }\n';
  code += '      }\n';
  code += '    }\n';
  code += '    var container = document.getElementById("__dywo_route");\n';
  code += '    if (!container) return;\n';
  code += '    if (matched && matched.component) {\n';
  code += '      var ctx = { $route: { path: currentPath, params: params } };\n';
  code += '      container.innerHTML = renderComponent(matched.component, ctx);\n';
  code += '    } else {\n';
  code += '      container.innerHTML = "";\n';
  code += '    }\n';
  code += '  }\n\n';

  // Mount the app
  code += '  function mountApp() {\n';
  code += '    var root = document.getElementById("app") || document.getElementById("root");\n';
  code += '    if (!root) { alert("DYWO: no #app element found"); return; }\n';
  code += '    root.innerHTML = renderComponent("' + rootComponent.name + '", null);\n';
  code += '    renderRoute();\n';
  code += '    if (global.addEventListener) {\n';
  code += '      global.addEventListener("hashchange", renderRoute);\n';
  code += '    } else if (global.attachEvent) {\n';
  code += '      global.attachEvent("onhashchange", renderRoute);\n';
  code += '    }\n';
  code += '    setupLinks();\n';
  code += '  }\n\n';

  // Setup dywo-link click handlers (delegated)
  code += '  function setupLinks() {\n';
  code += '    if (document.addEventListener) {\n';
  code += '      document.addEventListener("click", handleClick);\n';
  code += '    } else if (document.attachEvent) {\n';
  code += '      document.attachEvent("onclick", handleClick);\n';
  code += '    }\n';
  code += '  }\n\n';

  code += '  function handleClick(e) {\n';
  code += '    e = e || global.event;\n';
  code += '    var el = e.target || e.srcElement;\n';
  code += '    while (el && el !== document) {\n';
  code += '      if (el.tagName === "A" && el.getAttribute("data-dywo-link") !== null) {\n';
  code += '        if (e.preventDefault) e.preventDefault();\n';
  code += '        else e.returnValue = false;\n';
  code += '        var href = el.getAttribute("href");\n';
  code += '        if (href) global.location.hash = href;\n';
  code += '        return false;\n';
  code += '      }\n';
  code += '      el = el.parentNode;\n';
  code += '    }\n';
  code += '  }\n\n';

  // Auto-init
  code += '  function init() { mountApp(); }\n';
  code += '  if (document.readyState === "complete" || document.readyState === "interactive") {\n';
  code += '    init();\n';
  code += '  } else if (document.addEventListener) {\n';
  code += '    document.addEventListener("DOMContentLoaded", init);\n';
  code += '  } else {\n';
  code += '    // IE 4/5 fallback: wait for window load\n';
  code += '    global.onload = init;\n';
  code += '  }\n\n';

  code += '})(typeof window !== "undefined" ? window : this);\n';

  return code;
}

// ─────────────────────────────────────────────────────────────────
// HTML GENERATION
// ─────────────────────────────────────────────────────────────────

function generateLegacyHTML(rootComponent, css, dywobpCode, runtimeCode, embed, target) {
  if (embed) {
    // Single file — everything inline
    var html = '';
    html += '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd">\n';
    html += '<html lang="en">\n<head>\n';
    html += '  <meta http-equiv="Content-Type" content="text/html; charset=ISO-8859-1">\n';
    html += '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n';
    html += '  <title>' + escapeHtml(getComponentTitle(rootComponent)) + '</title>\n';
    html += '  <style type="text/css">\n';
    html += '    body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #000; background: #fff; margin: 0; padding: 0; }\n';
    html += '    a { color: #0000EE; }\n';
    html += '    a:visited { color: #551A8B; }\n';
    html += '    a:hover { color: #FF0000; }\n';
    html += css;
    html += '  </style>\n';
    html += '</head>\n<body>\n';
    html += '  <div id="app"></div>\n';
    html += '  <noscript>\n    <p>This page requires JavaScript. Please enable JavaScript in your browser.</p>\n  </noscript>\n';
    html += '  <!-- DYWOBP: loaded first — polyfills for legacy browsers -->\n';
    html += '  <script type="text/javascript">\n';
    html += dywobpCode;
    html += '\n  </script>\n';
    html += '  <!-- DYWO Legacy Runtime -->\n';
    html += '  <script type="text/javascript">\n';
    html += runtimeCode;
    html += '\n  </script>\n';
    html += '</body>\n</html>\n';
    return html;
  }

  // Non-embed version (separate files)
  return generateSeparateHTML(rootComponent, target);
}

function generateSeparateHTML(rootComponent, target) {
  var html = '';
  html += '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd">\n';
  html += '<html lang="en">\n<head>\n';
  html += '  <meta http-equiv="Content-Type" content="text/html; charset=ISO-8859-1">\n';
  html += '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n';
  html += '  <title>' + escapeHtml(getComponentTitle(rootComponent)) + '</title>\n';
  html += '  <link rel="stylesheet" type="text/css" href="styles.css">\n';
  html += '</head>\n<body>\n';
  html += '  <div id="app"></div>\n';
  html += '  <noscript>\n    <p>This page requires JavaScript. Please enable JavaScript in your browser.</p>\n  </noscript>\n';
  html += '  <!-- DYWOBP: loaded first — polyfills for legacy browsers -->\n';
  html += '  <script type="text/javascript" src="dywobp.js"></script>\n';
  html += '  <!-- DYWO Legacy Runtime -->\n';
  html += '  <script type="text/javascript" src="dywo-legacy.js"></script>\n';
  html += '</body>\n</html>\n';
  return html;
}

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────

function collectDywoFiles(dir) {
  var results = [];
  if (!nativeFs.existsSync(dir)) return results;
  var entries = nativeFs.readdirSync(dir);
  for (var i = 0; i < entries.length; i++) {
    var fullPath = path.join(dir, entries[i]);
    var stat = nativeFs.statSync(fullPath);
    if (stat.isDirectory() && entries[i] !== 'node_modules') {
      results = results.concat(collectDywoFiles(fullPath));
    } else if (stat.isFile() && fullPath.endsWith('.dywo')) {
      results.push(fullPath);
    }
  }
  return results;
}

function componentFromFile(relPath) {
  var base = path.basename(relPath, '.dywo');
  // Convert kebab-case / snake_case to PascalCase
  return base.split(/[-_]/).map(function (part) {
    return part.charAt(0).toUpperCase() + part.slice(1);
  }).join('');
}

function extractData(scriptContent) {
  // Try to extract the data() return value from the script
  if (!scriptContent) return {};
  var dataMatch = scriptContent.match(/data\s*\(\s*\)\s*\{[\s\S]*?return\s+([\s\S]*?)\s*;\s*\}/);
  if (!dataMatch) return {};
  // Very simple: try to eval the object (not safe in general, but works for templates)
  try {
    // eslint-disable-next-line no-new-func
    var fn = new Function('return ' + dataMatch[1]);
    return fn();
  } catch (e) {
    return {};
  }
}

function extractRoutes(scriptContent) {
  if (!scriptContent) return [];
  var routesMatch = scriptContent.match(/routes\s*:\s*\[([\s\S]*?)\]/);
  if (!routesMatch) return [];
  // Parse route definitions
  var routes = [];
  var routeRe = /\{\s*path\s*:\s*['"]([^'"]+)['"]\s*,\s*component\s*:\s*(\w+)\s*\}/g;
  var match;
  while ((match = routeRe.exec(routesMatch[1])) !== null) {
    routes.push({ path: match[1], component: match[2] });
  }
  return routes;
}

function readDYWOBP() {
  var bpPath = path.join(__dirname, '..', 'runtime', 'dywobp.js');
  return nativeFs.readFileSync(bpPath, 'utf8');
}

function serializeForES3(obj) {
  // JSON.stringify is fine here — this runs in Node, not the legacy browser.
  // The output will be parsed by the legacy runtime which has DYWOBP's JSON polyfill.
  var json = JSON.stringify(obj);
  // Escape any </script> in the JSON to prevent HTML injection
  json = json.replace(/<\/script>/g, '<\\/script>');
  return json;
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getComponentTitle(comp) {
  if (comp && comp.data && comp.data.title) return comp.data.title;
  return 'DYWO App';
}

function copyDirSync(src, dest, excludeFiles) {
  excludeFiles = excludeFiles || [];
  if (!nativeFs.existsSync(src)) return;
  var entries = nativeFs.readdirSync(src);
  for (var i = 0; i < entries.length; i++) {
    var srcPath = path.join(src, entries[i]);
    var destPath = path.join(dest, entries[i]);
    var stat = nativeFs.statSync(srcPath);
    if (stat.isDirectory()) {
      nativeFs.mkdirSync(destPath, { recursive: true });
      copyDirSync(srcPath, destPath, excludeFiles);
    } else if (stat.isFile() && excludeFiles.indexOf(entries[i]) === -1) {
      nativeFs.writeFileSync(destPath, nativeFs.readFileSync(srcPath));
    }
  }
}

module.exports = {
  compile: compile,
  stripModernCSS: stripModernCSS,
  checkCSSWarnings: checkCSSWarnings,
  checkJSWarnings: checkJSWarnings,
  MODERN_CSS_FEATURES: MODERN_CSS_FEATURES,
  MODERN_JS_FEATURES: MODERN_JS_FEATURES
};
