const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');
const defaults = require('./defaults');
const schema = require('./schema');

module.exports = {
  /**
   * Load config from projectRoot directory.
   * Returns merged config (user config deep-merged over defaults).
   */
  load(projectRoot) {
    const configPath = path.join(projectRoot, 'dywo.config.js');

    let userConfig = {};
    if (fs.existsSync(configPath)) {
      try {
        // Clear require cache so changes are picked up in watch mode
        delete require.cache[require.resolve(configPath)];
        userConfig = require(configPath);
      } catch (e) {
        console.error(chalk.red('Error loading dywo.config.js:'), e.message);
        process.exit(1);
      }
    }

    const merged = this.merge(defaults, userConfig);

    // Read name/version from package.json if not overridden in user config
    const pkgPath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = fs.readJsonSync(pkgPath);
        if (!userConfig.name) merged.name = pkg.name || merged.name;
        if (!userConfig.version) merged.version = pkg.version || merged.version;
      } catch (e) {
        // Non-fatal: malformed package.json just means we keep the merged defaults
        console.warn(chalk.yellow('dywo config warning: Could not read package.json:'), e.message);
      }
    }

    // Attach resolved internal paths
    merged._projectRoot = projectRoot;
    merged._resolvedOutput = path.resolve(projectRoot, merged.output.dir);
    merged._resolvedSrc = path.resolve(projectRoot, merged.srcDir);
    merged._resolvedPublic = path.resolve(projectRoot, merged.publicDir || './public');

    // Resolve aliases to absolute paths
    Object.keys(merged.alias).forEach(key => {
      merged.alias[key] = path.resolve(projectRoot, merged.alias[key]);
    });

    // Validate merged config
    const { valid, errors, warnings } = schema.validate(merged);
    warnings.forEach(w => console.warn(chalk.yellow('dywo config warning:'), w));
    if (!valid) {
      errors.forEach(e => console.error(chalk.red('dywo config error:'), e));
      process.exit(1);
    }

    return merged;
  },

  /**
   * Deep merge target and source objects (source wins).
   *
   * Rules:
   *   - Arrays  : source replaces target entirely (no concatenation)
   *   - Objects : recursively deep-merged
   *   - null    : source null overrides target value
   *   - Primitives: source wins
   */
  merge(target, source) {
    if (source === null || source === undefined) return target;

    // If source is not a plain object, return source directly
    if (typeof source !== 'object' || Array.isArray(source)) return source;

    // If target is not a plain object, start from an empty object
    const result = (typeof target === 'object' && target !== null && !Array.isArray(target))
      ? Object.assign({}, target)
      : {};

    Object.keys(source).forEach(key => {
      const srcVal = source[key];
      const tgtVal = result[key];

      if (srcVal === null) {
        // Explicit null in source: override regardless of target type
        result[key] = null;
      } else if (Array.isArray(srcVal)) {
        // Arrays: source replaces target
        result[key] = srcVal.slice();
      } else if (typeof srcVal === 'object') {
        // Plain objects: recurse
        result[key] = this.merge(tgtVal, srcVal);
      } else {
        // Primitives (string, number, boolean)
        result[key] = srcVal;
      }
    });

    return result;
  },

  /**
   * Generate a default dywo.config.js file content string.
   * Accepts optional `options` to customise the template (e.g. port, entry).
   */
  generateTemplate(options = {}) {
    const port = (options.devServer && options.devServer.port) || 3000;
    const entry = options.entry || './src/main.dywo';
    const outputDir = (options.output && options.output.dir) || './dist';
    const publicPath = (options.output && options.output.publicPath) || 'auto';
    const open = (options.devServer && options.devServer.open !== undefined)
      ? options.devServer.open
      : true;

    return `module.exports = {
  entry: '${entry}',

  output: {
    dir: '${outputDir}',
    publicPath: '${publicPath}'
  },

  compress: {
    js: { minify: true },
    css: { minify: true, autoprefixer: true },
    html: { minify: true },
    gzip: false
  },

  devServer: {
    port: ${port},
    open: ${open}
  }
};
`;
  }
};
