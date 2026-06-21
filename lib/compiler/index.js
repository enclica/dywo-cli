const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const fs = require('fs-extra');
const nativeFs = require('fs');

// Detect pkg's snapshot filesystem. terser-webpack-plugin parallelizes via
// jest-worker, whose threadChild.js entry cannot be resolved from inside the
// pkg snapshot (MODULE_NOT_FOUND on /snapshot/.../jest-worker/.../threadChild.js).
// Force single-threaded minification when bundled by pkg.
const IS_PKG = !!process.pkg
  || (typeof __dirname === 'string' && __dirname.startsWith('/snapshot/'));

// Path to the DYWO client runtime, shipped with the CLI.
const RUNTIME_PATH = path.join(__dirname, '..', 'runtime', 'dywo-runtime.js');

/**
 * DywoCompiler
 *
 * Builds a webpack configuration from a resolved DYWO config object.
 * Used by both `dev` (development mode, with HMR) and `build` (production).
 *
 * Expects config in the shape produced by lib/config/config-loader.js.
 */
class DywoCompiler {
  /**
   * @param {object} config       Resolved DYWO config (from config-loader.load()).
   * @param {string} projectRoot  Absolute path to the project root.
   * @param {string} mode         'development' | 'production'
   */
  constructor(config, projectRoot, mode = 'development') {
    this.config = config;
    this.projectRoot = projectRoot;
    this.mode = mode;
  }

  /**
   * Returns a complete webpack configuration object.
   * @returns {object}
   */
  getWebpackConfig() {
    const { config, projectRoot, mode } = this;
    const isDev = mode === 'development';

    // ── Resolve paths ─────────────────────────────────────────────────────
    // config-loader sets _resolvedSrc / _resolvedOutput when it processes paths;
    // fall back gracefully for callers that pass a plain config object.
    const srcDir = config._resolvedSrc || path.resolve(projectRoot, config.srcDir || './src');
    const outputDir = config._resolvedOutput
      || (config.output && config.output.dir
          ? path.resolve(projectRoot, config.output.dir)
          : path.resolve(projectRoot, './dist'));

    const publicPath = (config.output && config.output.publicPath) || 'auto';

    // Generate the webpack entry module that bundles the DYWO runtime
    // alongside the user's root component and wires them together.
    const userEntry = path.resolve(projectRoot, config.entry || './src/main.dywo');
    const el = (config.el) || '#app';
    const entry = this._generateEntry(userEntry, el);

    // Output filename pattern
    const jsFilename = (config.output && config.output.filename && config.output.filename.js)
      || (isDev ? 'bundle.js' : '[name].[contenthash:8].js');

    const cssFilename = (config.output && config.output.filename && config.output.filename.css)
      || (isDev ? 'bundle.css' : '[name].[contenthash:8].css');

    // Source map strategy
    const devtool = isDev
      ? (config.sourceMaps && config.sourceMaps.dev) || 'eval-source-map'
      : (config.sourceMaps && config.sourceMaps.prod === true)
        ? 'source-map'
        : (config.sourceMaps && config.sourceMaps.prod) || false;

    // Resolve alias map (config-loader already converts to absolute paths)
    const alias = Object.assign({ '@': srcDir }, config.alias || {});

    // HTML template
    const htmlTemplatePath = this._resolveHtmlTemplate(
      config.template ? path.resolve(projectRoot, config.template) : null,
      srcDir,
      projectRoot
    );

    // ── Base webpack config ────────────────────────────────────────────────
    const webpackConfig = {
      mode,
      entry,
      output: {
        path: outputDir,
        filename: jsFilename,
        publicPath,
        clean: !isDev && (config.output && config.output.clean !== false)
      },
      module: {
        rules: [
          // JS / JSX — only run babel-loader when the user has configured
          // custom presets or plugins (e.g. @babel/preset-react for JSX).
          // By default the dywo-loader already outputs ES5-compatible code
          // and webpack 5 handles ESM natively, so babel is unnecessary.
          // This also avoids babel-loader's top-level import("find-cache-dir")
          // which crashes inside pkg's snapshot (no dynamic import support).
          ...(_hasCustomBabel(config) ? [{
            test: /\.(js|jsx)$/,
            exclude: /node_modules/,
            use: {
              loader: require.resolve('babel-loader'),
              options: {
                cacheDirectory: false,
                presets: [
                  [require.resolve('@babel/preset-env'), { targets: config.targets || 'defaults' }],
                  ...((config.babel && config.babel.presets && config.babel.presets.includes('@babel/preset-react'))
                    ? [require.resolve('@babel/preset-react')]
                    : []),
                  ...((config.babel && config.babel.presets)
                    ? config.babel.presets.filter(p => p !== '@babel/preset-react').map(p => {
                        try { return require.resolve(p); } catch (_) { return p; }
                      })
                    : [])
                ],
                plugins: ((config.babel && config.babel.plugins) || []).map(p => {
                  try { return require.resolve(p); } catch (_) { return p; }
                })
              }
            }
          }] : []),
          // CSS — resolve loaders from the CLI's own node_modules.
          // require.resolve works inside pkg's snapshot too.
          {
            test: /\.css$/,
            use: [
              isDev ? require.resolve('style-loader') : MiniCssExtractPlugin.loader,
              require.resolve('css-loader')
            ]
          },
          // Static assets
          {
            test: /\.(png|svg|jpg|jpeg|gif|ico|webp)$/i,
            type: 'asset/resource'
          },
          // Fonts
          {
            test: /\.(woff|woff2|eot|ttf|otf)$/i,
            type: 'asset/resource'
          },
          // .dywo Single File Components
          {
            test: /\.dywo$/,
            use: [
              {
                loader: path.resolve(__dirname, './dywo-loader.js')
              }
            ]
          }
        ]
      },
      plugins: [
        new HtmlWebpackPlugin({
          template: htmlTemplatePath,
          inject: true
        }),
        new webpack.DefinePlugin({
          'process.env.NODE_ENV': JSON.stringify(mode)
        }),
        // Extract CSS to separate file in production
        ...(!isDev ? [new MiniCssExtractPlugin({ filename: cssFilename })] : [])
      ],
      ...(!isDev ? {
        optimization: {
          minimizer: [
            new TerserPlugin({
              parallel: !IS_PKG,
              terserOptions: {
                compress: { drop_console: false },
                output: { comments: false }
              },
              extractComments: false
            })
          ]
        }
      } : {}),
      resolve: {
        extensions: ['.js', '.jsx', '.json', '.dywo'],
        alias
      },
      devtool
    };

    // ── User webpack extension ─────────────────────────────────────────────
    // config.webpack must be a function (validated by schema).
    if (typeof config.webpack === 'function') {
      return config.webpack(webpackConfig, { mode, webpack }) || webpackConfig;
    }

    return webpackConfig;
  }

  /**
   * Run a one-shot webpack build and resolve with a simplified stats object.
   * @returns {Promise<{assets: Array, time: number, warnings: Array}>}
   */
  async compile() {
    const webpackConfig = this.getWebpackConfig();
    const compiler = webpack(webpackConfig);

    return new Promise((resolve, reject) => {
      compiler.run((err, stats) => {
        if (err) { reject(err); return; }

        compiler.close((closeErr) => {
          if (closeErr) console.warn('Warning: compiler.close() error:', closeErr.message);
        });

        if (stats.hasErrors()) {
          const info = stats.toJson({
            errors: true,
            modules: true,
            moduleTrace: true
          });

          const parsedErrors = (info.errors || []).map(e => {
            const parsed = {
              message: e.message || String(e),
              moduleName: e.moduleName || null,
              file: e.file || null,
              loc: e.loc || null
            };

            if (e.moduleName) {
              const locMatch = e.message.match(/\((\d+):(\d+)\)/);
              if (locMatch) parsed.loc = locMatch[1] + ':' + locMatch[2];
            }

            if (e.moduleTrace && e.moduleTrace.length > 0) {
              const origin = e.moduleTrace[e.moduleTrace.length - 1];
              if (!parsed.moduleName && origin.originName) {
                parsed.moduleName = origin.originName;
              }
            }

            return parsed;
          });

          const buildErr = new Error(
            'Webpack compilation failed:\n' +
            parsedErrors.map(e => {
              const parts = [e.message];
              if (e.moduleName) parts.unshift('[' + e.moduleName + ']');
              if (e.loc) parts.push('(at ' + e.loc + ')');
              return parts.join(' ');
            }).join('\n\n')
          );
          buildErr.webpackErrors = parsedErrors;
          buildErr.rawStats = info;
          reject(buildErr);
          return;
        }

        const json = stats.toJson({ assets: true, timings: true, warnings: true });
        resolve({
          assets: (json.assets || []).map(a => ({
            name: a.name,
            size: a.size,
            gzipSize: null
          })),
          time: json.time,
          warnings: (json.warnings || []).map(w =>
            typeof w === 'string' ? w : { message: w.message || String(w), moduleName: w.moduleName || null }
          )
        });
      });
    });
  }

  /**
   * Start a webpack watch session. Returns the webpack Watching instance.
   * @returns {object} webpack Watching instance
   */
  watch() {
    const webpackConfig = this.getWebpackConfig();
    const chalk = require('chalk');
    const compiler = webpack(webpackConfig);

    const watcher = compiler.watch({
      aggregateTimeout: 300,
      poll: false
    }, (err, stats) => {
      if (err) {
        console.error(chalk.red('Watch error:'), err.message);
        return;
      }
      if (stats.hasErrors()) {
        console.error(chalk.red('Compilation error:'));
        const info = stats.toJson({ errors: true });
        info.errors.forEach(e => console.error(chalk.red('  ' + (e.message || e))));
      } else {
        const json = stats.toJson({ timings: true });
        console.log(chalk.green(`Rebuilt in ${json.time}ms`));
      }
    });

    return watcher;
  }

  /**
   * Locate the HTML template to use for HtmlWebpackPlugin.
   * Priority:
   *   1. Explicit template path from config (if the file exists)
   *   2. <srcDir>/index.html
   *   3. <projectRoot>/public/index.html
   *   4. <projectRoot>/index.html
   *   5. Auto-generated fallback written to <srcDir>/index.html
   *
   * @private
   * @param {string|null} configTemplate  Resolved path from config.template, or null.
   * @param {string}      srcDir
   * @param {string}      projectRoot
   * @returns {string}  Absolute path to the template file.
   */
  _resolveHtmlTemplate(configTemplate, srcDir, projectRoot) {
    const candidates = [
      configTemplate,
      path.join(srcDir, 'index.html'),
      path.join(projectRoot, 'public', 'index.html'),
      path.join(projectRoot, 'index.html')
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }

    // Auto-generate a minimal template so the build can proceed.
    const fallbackPath = path.join(srcDir, 'index.html');
    fs.ensureDirSync(srcDir);
    fs.writeFileSync(
      fallbackPath,
      `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="A DYWO app">
  <meta name="theme-color" content="#0070f3">
  <title>DYWO App</title>
  <link rel="icon" href="favicon.ico" type="image/x-icon">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
</head>
<body>
  <div id="app"></div>
</body>
</html>
`
    );
    return fallbackPath;
  }

  /**
   * Generate the webpack entry module that:
   *   1. Imports and executes the DYWO client runtime (template engine,
   *      router, reactivity, component system).
   *   2. Imports the user's root .dywo component.
   *   3. Registers it via window.__DYWO_APP__ so the runtime's auto-init
   *      can mount it to the target element.
   *
   * The runtime source is copied into a .dywo-cache/ directory inside the
   * project so webpack can resolve it with a stable relative path. This
   * works both in normal `node` execution and inside a pkg snapshot.
   *
   * @private
   * @param {string} userEntry  Absolute path to the user's root .dywo file.
   * @param {string} el         CSS selector for the mount target.
   * @returns {string}          Absolute path to the generated entry module.
   */
  _generateEntry(userEntry, el) {
    const cacheDir = path.join(this.projectRoot, '.dywo-cache');
    nativeFs.mkdirSync(cacheDir, { recursive: true });

    // Copy the runtime into the cache so webpack can import it.
    const runtimeSource = nativeFs.readFileSync(RUNTIME_PATH, 'utf8');
    const runtimeDest = path.join(cacheDir, 'dywo-runtime.js');
    nativeFs.writeFileSync(runtimeDest, runtimeSource, 'utf8');

    // Generate the wrapper entry.
    const entryPath = path.join(cacheDir, '__dywo_entry.js');
    const entryCode = `// Auto-generated by DYWO — do not edit
import './dywo-runtime.js';
import App from ${JSON.stringify(userEntry)};

if (typeof window !== 'undefined') {
  window.__DYWO_APP__ = { component: App, el: ${JSON.stringify(el)} };
}
`;
    nativeFs.writeFileSync(entryPath, entryCode, 'utf8');
    return entryPath;
  }
}

/**
 * Check whether the user has configured custom babel presets or plugins.
 * When false, babel-loader is skipped entirely (the dywo-loader outputs
 * ES5 and webpack 5 handles ESM natively).
 *
 * @param {object} config
 * @returns {boolean}
 */
function _hasCustomBabel(config) {
  const presets = config.babel && config.babel.presets;
  const plugins = config.babel && config.babel.plugins;
  return (Array.isArray(presets) && presets.length > 0)
    || (Array.isArray(plugins) && plugins.length > 0);
}

module.exports = DywoCompiler;
