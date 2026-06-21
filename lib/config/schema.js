// Known top-level keys — anything outside this list gets a warning
const KNOWN_KEYS = new Set([
  'name', 'version', 'entry', 'pages', 'output', 'template', 'srcDir',
  'publicDir', 'alias', 'compress', 'devServer', 'targets', 'sourceMaps',
  'features', 'webpack', 'postcss', 'babel', 'legcomp',
  // internal resolved fields added by config-loader
  '_projectRoot', '_resolvedOutput', '_resolvedSrc', '_resolvedPublic'
]);

module.exports = {
  validate(config) {
    const errors = [];
    const warnings = [];

    // ---- unknown top-level keys -------------------------------------------
    Object.keys(config).forEach(key => {
      if (!KNOWN_KEYS.has(key)) {
        warnings.push(`Unknown top-level key "${key}" in dywo config.`);
      }
    });

    // ---- entry / pages ----------------------------------------------------
    if (config.pages === null || config.pages === undefined) {
      // Single-entry mode: entry must be a string
      if (typeof config.entry !== 'string') {
        errors.push(`"entry" must be a string when "pages" is not set (got ${typeof config.entry}).`);
      }
    } else {
      // Multi-page mode
      if (typeof config.pages !== 'object' || Array.isArray(config.pages)) {
        errors.push('"pages" must be a plain object mapping page names to page config objects.');
      } else {
        Object.entries(config.pages).forEach(([name, page]) => {
          if (!page || typeof page !== 'object') {
            errors.push(`pages["${name}"] must be an object.`);
          } else if (typeof page.entry !== 'string') {
            errors.push(`pages["${name}"].entry must be a string (got ${typeof page.entry}).`);
          }
        });
      }
    }

    // ---- output -----------------------------------------------------------
    if (config.output) {
      if (typeof config.output.dir !== 'string') {
        errors.push(`"output.dir" must be a string (got ${typeof config.output.dir}).`);
      }

      if (typeof config.output.publicPath !== 'string') {
        errors.push(`"output.publicPath" must be a string (got ${typeof config.output.publicPath}).`);
      } else {
        const pp = config.output.publicPath;
        // Allow: '/', '/path/', 'auto', '', or relative paths like './'
        if (pp !== 'auto' && pp !== '' && !pp.startsWith('/') && !pp.startsWith('./') && !pp.startsWith('../')) {
          errors.push(`"output.publicPath" must be "auto", a relative path (e.g. "./"), or an absolute path starting with "/" (got "${pp}").`);
        }
      }
    } else {
      errors.push('"output" is required.');
    }

    // ---- devServer --------------------------------------------------------
    if (config.devServer) {
      const port = config.devServer.port;
      if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
        errors.push(`"devServer.port" must be an integer between 1 and 65535 (got ${JSON.stringify(port)}).`);
      }
    }

    // ---- compress.js.minify ----------------------------------------------
    if (
      config.compress &&
      config.compress.js &&
      config.compress.js.minify !== undefined &&
      typeof config.compress.js.minify !== 'boolean'
    ) {
      errors.push(`"compress.js.minify" must be a boolean (got ${typeof config.compress.js.minify}).`);
    }

    // ---- webpack ----------------------------------------------------------
    if (config.webpack !== null && config.webpack !== undefined && typeof config.webpack !== 'function') {
      errors.push(`"webpack" must be null or a function (got ${typeof config.webpack}).`);
    }

    // ---- legcomp ----------------------------------------------------------
    if (config.legcomp !== null && config.legcomp !== undefined) {
      const lc = config.legcomp;
      if (typeof lc !== 'object' || Array.isArray(lc)) {
        errors.push(`"legcomp" must be an object (got ${typeof lc}).`);
      } else {
        if (lc.enabled !== undefined && typeof lc.enabled !== 'boolean') {
          errors.push(`"legcomp.enabled" must be a boolean (got ${typeof lc.enabled}).`);
        }
        const validTargets = ['ie4', 'ie5', 'netscape4', 'opera5'];
        if (lc.target !== undefined && validTargets.indexOf(lc.target) === -1) {
          errors.push(`"legcomp.target" must be one of: ${validTargets.join(', ')} (got "${lc.target}").`);
        }
        if (lc.output !== undefined && typeof lc.output !== 'string') {
          errors.push(`"legcomp.output" must be a string (got ${typeof lc.output}).`);
        }
        if (lc.embed !== undefined && typeof lc.embed !== 'boolean') {
          errors.push(`"legcomp.embed" must be a boolean (got ${typeof lc.embed}).`);
        }
        if (lc.warnings !== undefined && typeof lc.warnings !== 'boolean') {
          errors.push(`"legcomp.warnings" must be a boolean (got ${typeof lc.warnings}).`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }
};
