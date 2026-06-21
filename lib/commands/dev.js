const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');
const webpack = require('webpack');
const WebpackDevServer = require('webpack-dev-server');

async function dev(options) {
  const projectRoot = process.cwd();

  // ── 1. Load DYWO config ──────────────────────────────────────────────────
  const configLoader = require('../config/config-loader');
  let config;
  try {
    config = configLoader.load(projectRoot);
  } catch (e) {
    console.error(chalk.red('Config error:'), e.message);
    process.exit(1);
  }

  // CLI port flag overrides config
  if (options.port) config.devServer.port = parseInt(options.port, 10);

  const port = config.devServer.port || 3000;
  const host = config.devServer.host || 'localhost';

  console.log(chalk.blue('\nDYWO Dev Server\n'));

  // ── 2. Legacy fallback: no dywo.config.js but has webpack.config.js ──────
  const dywoConfigPath = path.join(projectRoot, 'dywo.config.js');
  const webpackConfigPath = path.join(projectRoot, 'webpack.config.js');

  let webpackConfig;

  if (!fs.existsSync(dywoConfigPath) && fs.existsSync(webpackConfigPath)) {
    console.log(chalk.yellow('No dywo.config.js found. Using webpack.config.js directly.'));
    try {
      delete require.cache[require.resolve(webpackConfigPath)];
      webpackConfig = require(webpackConfigPath);
      if (typeof webpackConfig === 'function') {
        webpackConfig = webpackConfig({ mode: 'development' }, {});
      }
      // Force development mode in the loaded config
      webpackConfig.mode = 'development';
    } catch (e) {
      console.error(chalk.red('Failed to load webpack.config.js:'), e.message);
      process.exit(1);
    }
  } else {
    // ── 3. Build webpack config via DywoCompiler ───────────────────────────
    const DywoCompiler = require('../compiler/index');
    const compiler = new DywoCompiler(config, projectRoot, 'development');
    try {
      webpackConfig = compiler.getWebpackConfig();
    } catch (e) {
      console.error(chalk.red('Compiler error:'), e.message);
      process.exit(1);
    }
  }

  // ── 4. Merge dev-server settings into webpack config ─────────────────────
  const openOption =
    options.open !== undefined ? options.open : (config.devServer.open || false);

  webpackConfig.devServer = {
    hot: config.devServer.hmr !== false,
    host,
    port,
    open: openOption,
    historyApiFallback: config.devServer.historyApiFallback !== false,
    static: {
      directory: path.resolve(projectRoot, config.publicDir || './public'),
      watch: true
    },
    client: {
      overlay: {
        errors: true,
        warnings: false
      },
      progress: true
    },
    proxy: config.devServer.proxy || {}
  };

  // ── 5. Create webpack compiler ────────────────────────────────────────────
  const webpackCompiler = webpack(webpackConfig);

  webpackCompiler.hooks.invalid.tap('DywoDevServer', () => {
    console.log(chalk.yellow('\nRecompiling...'));
  });

  webpackCompiler.hooks.done.tap('DywoDevServer', (stats) => {
    if (stats.hasErrors()) {
      const info = stats.toJson({ errors: true });
      info.errors.forEach(err => {
        console.error(chalk.red('\nError:'), err.message);
      });
    } else {
      const time = stats.toJson({ timings: true }).time;
      console.log(chalk.green(`\nReady in ${time}ms — http://${host}:${port}\n`));
    }
  });

  // ── 6. Watch .dywo files for changes and trigger rebuild ──────────────────
  _watchDywoFiles(projectRoot, webpackCompiler);

  // ── 7. Start the server ───────────────────────────────────────────────────
  const server = new WebpackDevServer(webpackCompiler, webpackConfig.devServer);

  try {
    if (typeof server.start === 'function') {
      // webpack-dev-server v4+
      await server.start();
    } else {
      // webpack-dev-server v3
      await new Promise((resolve, reject) => {
        server.listen(port, host, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }

    console.log(chalk.green(`DYWO dev server running at http://${host}:${port}`));
    console.log(chalk.gray('Press Ctrl+C to stop\n'));

    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log(chalk.gray('\nStopping dev server...'));
      const done = () => process.exit(0);
      if (typeof server.stop === 'function') {
        server.stop().then(done).catch(done);
      } else if (typeof server.close === 'function') {
        server.close(done);
      } else {
        done();
      }
    });
  } catch (err) {
    console.error(chalk.red('\nFailed to start dev server:'), err.message);
    process.exit(1);
  }
}

/**
 * Watch all .dywo files under the project src directory and force webpack to
 * recompile when any of them change.  webpack-dev-server already watches JS/CSS
 * through its own file watcher; this supplements that for .dywo-specific files.
 *
 * @param {string}  projectRoot
 * @param {object}  webpackCompiler  The webpack `Compiler` instance.
 */
function _watchDywoFiles(projectRoot, webpackCompiler) {
  const srcDir = path.join(projectRoot, 'src');
  if (!fs.existsSync(srcDir)) return;

  try {
    // Node's fs.watch is recursive on Linux only with the `recursive` flag
    // (available since Node 19).  For broader compatibility we watch the
    // directory non-recursively and rely on webpack's built-in watcher for
    // nested paths; this catches top-level .dywo files immediately.
    const watchOptions = { persistent: false };

    const trigger = (eventType, filename) => {
      if (filename && filename.endsWith('.dywo')) {
        console.log(chalk.cyan(`\n.dywo file changed: ${filename} — triggering rebuild`));
        // Touch the webpack entry point to force a rebuild cycle.
        webpackCompiler.watching && webpackCompiler.watching.invalidate();
      }
    };

    // Attempt recursive watch (works on macOS and Windows; partial on Linux).
    try {
      fs.watch(srcDir, { recursive: true, persistent: false }, trigger);
    } catch (_) {
      // Fallback: non-recursive watch on the src root only.
      fs.watch(srcDir, watchOptions, trigger);
    }
  } catch (e) {
    // File watching is best-effort; don't crash the server if it fails.
    console.log(chalk.gray(`(Could not watch .dywo files: ${e.message})`));
  }
}

module.exports = dev;
