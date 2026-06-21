'use strict';

const fs = require('fs-extra');
const path = require('path');
const glob = require('glob');

// ---------------------------------------------------------------------------
// Small utility helpers
// ---------------------------------------------------------------------------

/**
 * Capitalise the first letter of a string (used for component names).
 * @param {string} str
 * @returns {string}
 */
function capitalise(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Turn a filename (without extension) into a PascalCase component name.
 * e.g.  "about-us" -> "AboutUs"
 *       "contact_us" -> "ContactUs"
 *       "index" -> "Index"
 * @param {string} name
 * @returns {string}
 */
function toComponentName(name) {
  return name
    .split(/[-_\s]+/)
    .map(capitalise)
    .join('');
}

/**
 * Very simple string-similarity score (Jaccard on bigrams).
 * Returns a value between 0 (no similarity) and 1 (identical).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function similarity(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;

  function bigrams(s) {
    const set = new Set();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  }

  const ba = bigrams(a);
  const bb = bigrams(b);
  let intersection = 0;
  ba.forEach(bg => { if (bb.has(bg)) intersection++; });
  return (2 * intersection) / (ba.size + bb.size);
}

// ---------------------------------------------------------------------------
// HTML string-manipulation helpers (no external parser required)
// ---------------------------------------------------------------------------

/**
 * Extract the text content of the first matching tag.
 * Returns null if the tag isn't found.
 * @param {string} html
 * @param {string} tag  e.g. 'head', 'body', 'title'
 * @returns {string|null}
 */
function extractTag(html, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = html.match(re);
  return m ? m[1] : null;
}

/**
 * Extract all href values from <link rel="stylesheet" href="..."> tags.
 * @param {string} html
 * @returns {string[]}
 */
function extractLinkedCss(html) {
  const re = /<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi;
  const results = [];
  let m;
  while ((m = re.exec(html)) !== null) results.push(m[1]);

  // Also handle href before rel
  const re2 = /<link[^>]+href=["']([^"']+\.css)["'][^>]*>/gi;
  while ((m = re2.exec(html)) !== null) {
    if (!results.includes(m[1])) results.push(m[1]);
  }
  return results;
}

/**
 * Extract all src values from <script src="..."> tags.
 * @param {string} html
 * @returns {string[]}
 */
function extractLinkedJs(html) {
  const re = /<script[^>]+src=["']([^"']+)["'][^>]*/gi;
  const results = [];
  let m;
  while ((m = re.exec(html)) !== null) results.push(m[1]);
  return results;
}

/**
 * Extract the content of <title> from an HTML string.
 * @param {string} html
 * @returns {string}
 */
function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].trim() : '';
}

/**
 * Remove all <link> tags from an HTML string.
 * @param {string} html
 * @returns {string}
 */
function stripLinkTags(html) {
  return html.replace(/<link[^>]*>/gi, '');
}

/**
 * Remove all <script ...> ... </script> blocks from an HTML string.
 * @param {string} html
 * @returns {string}
 */
function stripScriptTags(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, '');
}

/**
 * Remove all <style> ... </style> blocks from an HTML string.
 * @param {string} html
 * @returns {string}
 */
function stripStyleTags(html) {
  return html.replace(/<style[\s\S]*?<\/style>/gi, '');
}

/**
 * Remove the <!DOCTYPE>, <html>, <head> and <body> wrapper tags,
 * keeping only the inner body content.
 * @param {string} html
 * @returns {string}
 */
function extractBodyContent(html) {
  let body = extractTag(html, 'body');
  if (!body) {
    // Fallback: strip head and doctype
    body = html
      .replace(/<!DOCTYPE[^>]*>/gi, '')
      .replace(/<html[^>]*>/gi, '')
      .replace(/<\/html>/gi, '')
      .replace(/<head[\s\S]*?<\/head>/gi, '')
      .replace(/<\/?body[^>]*>/gi, '');
  }
  return body.trim();
}

/**
 * Extract all inline <style> blocks from an HTML string and return them
 * concatenated, or an empty string if none exist.
 * @param {string} html
 * @returns {string}
 */
function extractInlineStyles(html) {
  const re = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  const parts = [];
  let m;
  while ((m = re.exec(html)) !== null) parts.push(m[1].trim());
  return parts.join('\n\n');
}

/**
 * Extract all inline <script> blocks (no src attribute) and return them
 * concatenated, or an empty string if none exist.
 * @param {string} html
 * @returns {string}
 */
function extractInlineScripts(html) {
  const re = /<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/gi;
  const parts = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const content = m[1].trim();
    if (content) parts.push(content);
  }
  return parts.join('\n\n');
}

/**
 * Extract inline event-handler attributes (onclick, onload, etc.) and
 * convert them into equivalent addEventListener calls.
 * Returns an array of JS statement strings.
 * @param {string} html
 * @returns {{ handlers: string[], cleanHtml: string }}
 */
function extractInlineEventHandlers(html) {
  const handlers = [];
  const eventAttrs = ['onclick', 'onload', 'onchange', 'onsubmit', 'onmouseover',
    'onmouseout', 'onfocus', 'onblur', 'onkeydown', 'onkeyup', 'onkeypress',
    'oninput', 'ondblclick', 'oncontextmenu', 'onresize', 'onscroll'];

  let cleanHtml = html;
  eventAttrs.forEach(evt => {
    const domEvent = evt.slice(2); // "onclick" -> "click"
    const re = new RegExp(`${evt}=["']([^"']+)["']`, 'gi');
    let m;
    while ((m = re.exec(html)) !== null) {
      handlers.push(
        `// Migrated inline ${evt} handler\n` +
        `document.querySelectorAll('[${evt}]').forEach(el => {\n` +
        `  el.addEventListener('${domEvent}', function() { ${m[1]} });\n` +
        `});`
      );
    }
    // Strip the attribute from the clean HTML
    cleanHtml = cleanHtml.replace(new RegExp(`\\s*${evt}=["'][^"']*["']`, 'gi'), '');
  });

  return { handlers, cleanHtml };
}

/**
 * Extract the outerHTML of the first occurrence of a given structural tag
 * (<header>, <footer>, <nav>).
 * Returns null when not found.
 * @param {string} html
 * @param {string} tag
 * @returns {string|null}
 */
function extractStructuralBlock(html, tag) {
  const re = new RegExp(`(<${tag}[\\s\\S]*?<\\/${tag}>)`, 'i');
  const m = html.match(re);
  return m ? m[1] : null;
}

/**
 * Remove a structural block (identified by its exact outerHTML) from an
 * HTML string.
 * @param {string} html
 * @param {string} block  — the exact outerHTML to remove
 * @returns {string}
 */
function removeBlock(html, block) {
  return html.replace(block, '').trim();
}

// ---------------------------------------------------------------------------
// Framework detection
// ---------------------------------------------------------------------------

/**
 * Detect common frameworks / libraries referenced in a set of JS file paths
 * and their concatenated source content.
 * @param {string[]} jsPaths
 * @param {string} sourceContent  — concatenated JS source code
 * @returns {{ jquery: boolean, bootstrap: boolean, frameworks: string[] }}
 */
function detectFrameworks(jsPaths, sourceContent) {
  const allSrc = (jsPaths.join(' ') + ' ' + sourceContent).toLowerCase();
  const detected = {
    jquery: /jquery/.test(allSrc),
    bootstrap: /bootstrap/.test(allSrc),
    frameworks: []
  };

  if (/\breact\b/.test(allSrc) || /react-dom/.test(allSrc)) detected.frameworks.push('React');
  if (/\bvue\b/.test(allSrc)) detected.frameworks.push('Vue');
  if (/\bangular\b/.test(allSrc)) detected.frameworks.push('Angular');
  if (detected.jquery) detected.frameworks.push('jQuery');
  if (detected.bootstrap) detected.frameworks.push('Bootstrap');

  return detected;
}

// ---------------------------------------------------------------------------
// Build-system detection
// ---------------------------------------------------------------------------

/**
 * Return the names of any detected build-system config files in a directory.
 * @param {string} sourceDir
 * @returns {string[]}
 */
async function detectBuildSystem(sourceDir) {
  const candidates = [
    'webpack.config.js', 'webpack.config.ts',
    'Gruntfile.js',
    'Gulpfile.js', 'gulpfile.js',
    'rollup.config.js',
    'vite.config.js', 'vite.config.ts',
    'parcel.config.js',
    '.babelrc', 'babel.config.js'
  ];
  const found = [];
  for (const c of candidates) {
    if (await fs.pathExists(path.join(sourceDir, c))) found.push(c);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan a directory for HTML, CSS, JS files and return a site structure
 * description.
 *
 * @param {string} sourceDir  — absolute path to legacy site root
 * @returns {Promise<Object>}  — analysis result object
 */
async function analyze(sourceDir) {
  // Resolve all file types
  const htmlFiles = glob.sync('**/*.html', { cwd: sourceDir, nodir: true });
  const cssFiles  = glob.sync('**/*.css',  { cwd: sourceDir, nodir: true });
  const jsFiles   = glob.sync('**/*.js',   { cwd: sourceDir, nodir: true });

  const assetExtensions = '**/*.{png,jpg,jpeg,gif,svg,ico,webp,woff,woff2,ttf,eot,otf,mp4,mp3,wav,pdf}';
  const assetFiles = glob.sync(assetExtensions, { cwd: sourceDir, nodir: true });

  // ----- Read CSS files -----
  const stylesMap = {};  // relative path -> { file, content, usedBy[] }
  for (const f of cssFiles) {
    const content = await fs.readFile(path.join(sourceDir, f), 'utf8').catch(() => '');
    stylesMap[f] = { file: f, content, usedBy: [] };
  }

  // ----- Read JS files -----
  const scriptsMap = {};  // relative path -> { file, content, usedBy[] }
  for (const f of jsFiles) {
    const content = await fs.readFile(path.join(sourceDir, f), 'utf8').catch(() => '');
    scriptsMap[f] = { file: f, content, usedBy: [] };
  }

  // ----- Process HTML files -----
  const pages = [];
  for (const f of htmlFiles) {
    const content = await fs.readFile(path.join(sourceDir, f), 'utf8').catch(() => '');

    const linkedCss = extractLinkedCss(content);
    const linkedJs  = extractLinkedJs(content);

    // Mark which CSS/JS files are used by this page
    linkedCss.forEach(cssPath => {
      // Normalise: strip leading ./ and query strings
      const normalised = cssPath.replace(/^\.\//, '').split('?')[0];
      if (stylesMap[normalised]) stylesMap[normalised].usedBy.push(f);
    });
    linkedJs.forEach(jsPath => {
      const normalised = jsPath.replace(/^\.\//, '').split('?')[0].split('#')[0];
      if (scriptsMap[normalised]) scriptsMap[normalised].usedBy.push(f);
    });

    const { inlineCss, inlineJs } = extractInlineAssets(content);

    pages.push({
      file: f,
      title: extractTitle(content),
      linkedCss,
      linkedJs,
      inlineCss,
      inlineJs,
      content
    });
  }

  const styles  = Object.values(stylesMap);
  const scripts = Object.values(scriptsMap);

  // Shared = used by every page (or by all pages that reference at least one CSS/JS)
  const pageCount = pages.length;
  const sharedCss = styles
    .filter(s => s.usedBy.length >= pageCount && pageCount > 0)
    .map(s => s.file);
  const sharedJs = scripts
    .filter(s => s.usedBy.length >= pageCount && pageCount > 0)
    .map(s => s.file);

  // Detect frameworks from JS file names + concatenated JS content
  const allJsContent = scripts.map(s => s.content).join('\n');
  const detected = detectFrameworks(jsFiles, allJsContent);

  // Detect existing build systems
  const buildSystems = await detectBuildSystem(sourceDir);

  return {
    pages,
    styles,
    scripts,
    assets: assetFiles,
    sharedCss,
    sharedJs,
    detected,
    buildSystems
  };
}

/**
 * Extract inline <style> and <script> from an HTML string.
 * @param {string} htmlContent
 * @returns {{ inlineCss: string, inlineJs: string }}
 */
function extractInlineAssets(htmlContent) {
  return {
    inlineCss: extractInlineStyles(htmlContent),
    inlineJs:  extractInlineScripts(htmlContent)
  };
}

/**
 * Convert a single HTML file to a .dywo Single-File Component string.
 *
 * @param {string} htmlContent       — raw HTML source
 * @param {string} cssContent        — CSS to embed (from linked + inline)
 * @param {string} jsContent         — JS to embed (from linked + inline)
 * @param {string} componentName     — PascalCase component name
 * @param {Object} [sharedComponents] — map of tag -> component names already extracted
 * @returns {string}  — .dywo file content
 */
function convertHtmlToDywo(htmlContent, cssContent, jsContent, componentName, sharedComponents) {
  sharedComponents = sharedComponents || {};

  // 1. Get body content
  let body = extractBodyContent(htmlContent);

  // 2. Strip link/style/script tags from body
  body = stripLinkTags(body);
  body = stripStyleTags(body);
  body = stripScriptTags(body);

  // 3. Handle shared structural components (header, footer, nav)
  const componentImports = [];
  const componentUsages  = {};

  ['header', 'footer', 'nav'].forEach(tag => {
    if (sharedComponents[tag]) {
      const compName = sharedComponents[tag];
      const block = extractStructuralBlock(body, tag);
      if (block) {
        body = removeBlock(body, block);
        componentImports.push(`import ${compName} from '@components/${compName}.dywo';`);
        componentUsages[tag] = compName;
      }
    }
  });

  // 4. Extract inline event handlers and clean the body
  const { handlers, cleanHtml: cleanBody } = extractInlineEventHandlers(body);

  // 5. Indent body content
  const indentedBody = cleanBody
    .split('\n')
    .map(line => (line.trim() ? '    ' + line : ''))
    .join('\n')
    .trimEnd();

  // 6. Build component tag substitutions for structural elements
  let templateBody = indentedBody;
  Object.entries(componentUsages).forEach(([tag, compName]) => {
    // Already removed from body, insert component tag where it was
    // (we can't know exact position; prepend/append as appropriate)
    if (tag === 'header' || tag === 'nav') {
      templateBody = `    <${compName} />\n` + templateBody;
    } else if (tag === 'footer') {
      templateBody = templateBody + `\n    <${compName} />`;
    }
  });

  // 7. Page wrapper class
  const pageClass = 'page-' + componentName.toLowerCase();

  // 8. Build component registration block
  const registeredComponents = Object.values(componentUsages);
  const componentsBlock = registeredComponents.length > 0
    ? `  components: { ${registeredComponents.join(', ')} },\n`
    : '';

  // 9. Build mounted() hook
  const mountedStatements = [...handlers];
  if (jsContent && jsContent.trim()) {
    mountedStatements.push('// Inline JS from original HTML\n    ' + jsContent.trim().replace(/\n/g, '\n    '));
  }
  const mountedBlock = mountedStatements.length > 0
    ? `  mounted() {\n    ${mountedStatements.join('\n\n    ')}\n  },\n`
    : '';

  // 10. Build imports block
  const importsBlock = componentImports.length > 0
    ? componentImports.join('\n') + '\n\n'
    : '';

  // 11. Assemble .dywo file
  return [
    '<template>',
    `  <!-- Converted from ${componentName.toLowerCase()}.html -->`,
    `  <div class="${pageClass}">`,
    templateBody,
    '  </div>',
    '</template>',
    '',
    '<style>',
    cssContent ? cssContent.trim() : '/* No styles */',
    '</style>',
    '',
    '<script>',
    `${importsBlock}export default {`,
    `  name: '${componentName}',`,
    componentsBlock.trimEnd() ? componentsBlock.trimEnd() : '',
    mountedBlock.trimEnd() ? mountedBlock.trimEnd() : '',
    '};',
    '</script>',
    ''
  ]
    .filter((line, idx, arr) => {
      // Collapse consecutive blank lines
      if (line === '' && arr[idx - 1] === '') return false;
      return true;
    })
    .join('\n');
}

/**
 * Convert a structural element (header/footer/nav) into a standalone .dywo
 * component.
 * @param {string} blockHtml     — outerHTML of the element
 * @param {string} componentName — e.g. 'SiteHeader'
 * @returns {string}
 */
function convertBlockToDywoComponent(blockHtml, componentName) {
  const indented = blockHtml
    .split('\n')
    .map(line => (line.trim() ? '  ' + line : ''))
    .join('\n')
    .trimEnd();

  return [
    '<template>',
    indented,
    '</template>',
    '',
    '<style scoped>',
    '/* Add component-specific styles here */',
    '</style>',
    '',
    '<script>',
    `export default { name: '${componentName}' };`,
    '</script>',
    ''
  ].join('\n');
}

/**
 * Detect shared structural blocks (header / footer / nav) across pages.
 * A block is considered shared when it appears in 2+ pages with similarity
 * >= 70 %.
 *
 * @param {Object[]} pages   — page objects from analyze()
 * @returns {Object}  — map of tag -> { componentName, html }
 */
function detectSharedComponents(pages) {
  const tags = ['header', 'footer', 'nav'];
  const shared = {};

  tags.forEach(tag => {
    const blocks = pages
      .map(p => extractStructuralBlock(extractBodyContent(p.content), tag))
      .filter(Boolean);

    if (blocks.length < 2) return;

    // Check if majority of blocks are sufficiently similar
    const reference = blocks[0];
    const similarCount = blocks.filter(b => similarity(b, reference) >= 0.70).length;

    if (similarCount >= 2) {
      const nameMap = {
        header: 'SiteHeader',
        footer: 'SiteFooter',
        nav:    'SiteNav'
      };
      shared[tag] = { componentName: nameMap[tag], html: reference };
    }
  });

  return shared;
}

/**
 * Convert a full site analysis into a DYWO project written to disk.
 *
 * @param {Object} analysis   — result from analyze()
 * @param {string} outputDir  — absolute path for the new project
 * @param {Object} options
 * @param {boolean} [options.spa]           — generate SPA routing setup
 * @param {Function} [options.onProgress]   — callback(message) for progress
 * @returns {Promise<{ components: string[], pages: string[], assets: number, report: Object }>}
 */
async function convert(analysis, outputDir, options) {
  options = options || {};
  const log = options.onProgress || (() => {});

  // Create output directories
  const srcDir        = path.join(outputDir, 'src');
  const pagesDir      = path.join(srcDir, 'pages');
  const componentsDir = path.join(srcDir, 'components');
  const publicDir     = path.join(outputDir, 'public');

  await fs.ensureDir(pagesDir);
  await fs.ensureDir(componentsDir);
  await fs.ensureDir(publicDir);

  // Build a lookup for CSS and JS content
  const cssContentMap = {};
  analysis.styles.forEach(s => { cssContentMap[s.file] = s.content; });

  const jsContentMap = {};
  analysis.scripts.forEach(s => { jsContentMap[s.file] = s.content; });

  // ----- Detect shared structural components -----
  const sharedBlocks = detectSharedComponents(analysis.pages);
  const sharedComponentNames = {};
  Object.entries(sharedBlocks).forEach(([tag, info]) => {
    sharedComponentNames[tag] = info.componentName;
  });

  // Write shared component files
  const writtenComponents = [];
  for (const [tag, info] of Object.entries(sharedBlocks)) {
    const dywoContent = convertBlockToDywoComponent(info.html, info.componentName);
    const filePath = path.join(componentsDir, `${info.componentName}.dywo`);
    await fs.writeFile(filePath, dywoContent, 'utf8');
    writtenComponents.push(`src/components/${info.componentName}.dywo`);
    log(`  <${tag}>  →  src/components/${info.componentName}.dywo`);
  }

  // ----- Convert each HTML page -----
  const writtenPages = [];
  const inlineEventHandlerPages = [];

  for (const page of analysis.pages) {
    const baseName = path.basename(page.file, '.html');
    const compName = toComponentName(baseName);

    // Gather CSS: linked files + inline
    const cssChunks = [];
    page.linkedCss.forEach(cssPath => {
      const normalised = cssPath.replace(/^\.\//, '').split('?')[0];
      const content = cssContentMap[normalised];
      if (content) {
        cssChunks.push(`/* From ${cssPath} */\n${content}`);
      }
    });
    if (page.inlineCss) {
      cssChunks.push(`/* Inline styles from ${page.file} */\n${page.inlineCss}`);
    }
    const cssContent = cssChunks.join('\n\n');

    // Gather JS: linked files + inline
    const jsChunks = [];
    page.linkedJs.forEach(jsPath => {
      const normalised = jsPath.replace(/^\.\//, '').split('?')[0].split('#')[0];
      const content = jsContentMap[normalised];
      if (content) {
        jsChunks.push(`// From ${jsPath}\n${content}`);
      }
    });
    if (page.inlineJs) {
      jsChunks.push(`// Inline JS from ${page.file}\n${page.inlineJs}`);
    }
    const jsContent = jsChunks.join('\n\n');

    // Check whether there are inline event handlers
    const { handlers } = extractInlineEventHandlers(extractBodyContent(page.content));
    if (handlers.length > 0) inlineEventHandlerPages.push(page.file);

    const dywoContent = convertHtmlToDywo(
      page.content, cssContent, jsContent, compName, sharedComponentNames
    );

    const outFile = path.join(pagesDir, `${compName}.dywo`);
    await fs.writeFile(outFile, dywoContent, 'utf8');
    writtenPages.push(`src/pages/${compName}.dywo`);
    log(`  ${page.file}  →  src/pages/${compName}.dywo`);
  }

  // ----- Copy assets -----
  let copiedAssets = 0;
  for (const asset of analysis.assets) {
    const src  = path.join(/* sourceDir not available here — caller copies */ outputDir, '..', asset);
    const dest = path.join(publicDir, asset);
    // Source dir is not in scope here; actual copy is done in migrate.js
    copiedAssets++;
  }

  // ----- Generate main.dywo (root app component) -----
  const pageImports = analysis.pages.map(p => {
    const baseName = path.basename(p.file, '.html');
    const compName = toComponentName(baseName);
    const routePath = baseName === 'index' ? '/' : `/${baseName}`;
    return { compName, routePath };
  });

  const mainDywo = generateMainDywo(pageImports, writtenComponents, options.spa);
  await fs.writeFile(path.join(srcDir, 'main.dywo'), mainDywo, 'utf8');

  // ----- Generate public/index.html -----
  const shellHtml = generateShellHtml();
  await fs.writeFile(path.join(publicDir, 'index.html'), shellHtml, 'utf8');

  // ----- Generate dywo.config.js -----
  const dywoConfig = generateDywoConfig(options.spa);
  await fs.writeFile(path.join(outputDir, 'dywo.config.js'), dywoConfig, 'utf8');

  // ----- Generate package.json -----
  const pkgJson = generatePackageJson(path.basename(outputDir));
  await fs.writeFile(path.join(outputDir, 'package.json'), JSON.stringify(pkgJson, null, 2), 'utf8');

  // ----- Generate .gitignore -----
  await fs.writeFile(path.join(outputDir, '.gitignore'), generateGitignore(), 'utf8');

  // Build report data for MIGRATION.md (written by migrate.js)
  const report = {
    pageCount:               analysis.pages.length,
    cssCount:                analysis.styles.length,
    jsCount:                 analysis.scripts.length,
    assetCount:              analysis.assets.length,
    writtenPages,
    writtenComponents,
    detected:                analysis.detected,
    buildSystems:            analysis.buildSystems,
    inlineEventHandlerPages,
    sharedComponentsDetected: Object.values(sharedBlocks).map(b => b.componentName)
  };

  return { components: writtenComponents, pages: writtenPages, assets: copiedAssets, report };
}

// ---------------------------------------------------------------------------
// Static file generators
// ---------------------------------------------------------------------------

function generateMainDywo(pageImports, sharedComponentPaths, spa) {
  const importLines = pageImports
    .map(p => `import ${p.compName} from '@pages/${p.compName}.dywo';`)
    .join('\n');

  const routeLines = pageImports
    .map(p => `    { path: '${p.routePath}', component: ${p.compName} }`)
    .join(',\n');

  const componentList = pageImports.map(p => p.compName).join(', ');

  return `<template>
  <div id="app">
    <router-view />
  </div>
</template>

<style>
/* Global styles */
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, -apple-system, sans-serif; }
</style>

<script>
${importLines}

export default {
  name: 'App',
  components: { ${componentList} },
  routes: [
${routeLines},
    { path: '*', redirect: '/' }
  ]
};
</script>
`;
}

function generateShellHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DYWO App</title>
</head>
<body>
  <div id="app"></div>
  <script src="/bundle.js"></script>
</body>
</html>
`;
}

function generateDywoConfig(spa) {
  return `module.exports = {
  // Generated by dywo migrate
  mode: ${spa ? "'spa'" : "'mpa'"},
  src: './src',
  output: './dist',
  public: './public',
  entry: './src/main.dywo',
};
`;
}

function generatePackageJson(name) {
  return {
    name:        name || 'dywo-project',
    version:     '1.0.0',
    description: 'Migrated DYWO project',
    scripts: {
      dev:   'dywo dev',
      build: 'dywo build',
      start: 'dywo serve'
    },
    dependencies: {},
    devDependencies: {
      dywo: 'latest'
    }
  };
}

function generateGitignore() {
  return `/node_modules
/dist
/.dywo-cache
.DS_Store
*.log
`;
}

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------

module.exports = {
  analyze,
  convert,
  convertHtmlToDywo,
  extractInlineAssets
};
