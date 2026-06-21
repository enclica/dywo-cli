async function build(options) {
  const projectRoot = process.cwd();
  const chalk = require('chalk');
  const path = require('path');
  const fs = require('fs-extra');
  const configLoader = require('../config/config-loader');
  const DywoCompiler = require('../compiler/index');

  const verbose = !!options.verbose;

  const SUGGESTIONS = {
    'Module not found': 'Check that the file exists and the path is correct in your imports',
    'SyntaxError': 'Check for syntax errors — missing brackets, semicolons, or malformed code',
    'Unexpected token': 'Check for unexpected characters — you may need a loader for this file type',
    'Cannot resolve': 'Verify the module is installed (npm install) and the import path is correct',
    'Entry module not found': 'Check that your entry file exists at the configured path',
    'ENOENT': 'A required file or directory does not exist — verify the path',
    'Module build failed': 'A loader failed to process this file — check loader configuration',
    'Export not found': 'The named export does not exist in the target module — check the export name',
    'ChunkLoadError': 'A dynamic import chunk failed to load — check network or publicPath config'
  };

  function suggestFor(message) {
    const msg = message || '';
    for (const [key, hint] of Object.entries(SUGGESTIONS)) {
      if (msg.includes(key)) return hint;
    }
    return null;
  }

  function formatWebpackErrors(errors, config) {
    const lines = [];
    lines.push(chalk.red.bold('\n✖ Build failed with ' + errors.length + ' error(s)\n'));

    errors.forEach((err, i) => {
      const msg = err.message || String(err);
      const file = err.moduleName || err.file || null;
      const loc = err.loc || null;
      const suggestion = suggestFor(msg);

      lines.push(chalk.red(`  Error ${i + 1}:`) + ' ' + msg.split('\n')[0]);

      if (file) {
        const rel = path.relative(projectRoot, file);
        lines.push(chalk.gray('    File: ') + chalk.gray(rel) + (loc ? chalk.gray(':' + loc) : ''));
      }

      if (msg.includes('\n')) {
        const detail = msg.split('\n').slice(1).join('\n').trim();
        if (detail) lines.push(chalk.gray('    ' + detail.split('\n').slice(0, 3).join('\n    ')));
      }

      if (suggestion) {
        lines.push(chalk.cyan('    → ' + suggestion));
      }

      lines.push('');
    });

    if (config) {
      lines.push(chalk.gray('  Relevant config:'));
      if (config.entry) lines.push(chalk.gray('    entry: ') + chalk.white(config.entry));
      if (config._resolvedSrc) lines.push(chalk.gray('    srcDir: ') + chalk.white(config._resolvedSrc));
      if (config.alias && Object.keys(config.alias).length > 0) {
        lines.push(chalk.gray('    aliases: ') + chalk.white(JSON.stringify(config.alias)));
      }
      if (config.resolve && config.resolve.alias) {
        lines.push(chalk.gray('    resolve.alias: ') + chalk.white(JSON.stringify(config.resolve.alias)));
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  function formatWarnings(warnings) {
    if (!warnings || warnings.length === 0) return '';
    const lines = [];
    lines.push(chalk.yellow.bold('\n⚠ ' + warnings.length + ' warning(s)\n'));
    warnings.forEach((w, i) => {
      const msg = typeof w === 'string' ? w : (w.message || String(w));
      const file = (typeof w === 'object' && w.moduleName) ? w.moduleName : null;
      lines.push(chalk.yellow(`  ${i + 1}. `) + msg.split('\n')[0]);
      if (file) lines.push(chalk.gray('     ' + path.relative(projectRoot, file)));
    });
    lines.push('');
    return lines.join('\n');
  }

  // Load config (handles missing file gracefully)
  const config = configLoader.load(projectRoot);

  // Override config with CLI options
  const env = options.env || 'production';
  if (options.analyze) config._analyze = true;
  if (options.legacy) {
    config.legcomp = config.legcomp || {};
    config.legcomp.enabled = true;
  }

  console.log(chalk.blue(`\nDYWO Build — ${env} mode\n`));

  // Clean output directory if configured
  if (config.output.clean && env === 'production') {
    await fs.emptyDir(config._resolvedOutput);
    console.log(chalk.gray('Cleaned output directory'));
  }

  // Create compiler
  const compiler = new DywoCompiler(config, projectRoot, env);

  try {
    const startTime = Date.now();

    if (options.watch) {
      console.log(chalk.cyan('Watch mode enabled. Watching for changes...\n'));
      await compiler.watch();
    } else {
      const stats = await compiler.compile();
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

      console.log(chalk.green(`\nBuild complete in ${elapsed}s`));

      if (stats && stats.warnings && stats.warnings.length > 0) {
        console.log(formatWarnings(stats.warnings));
      }

      // Print output files
      if (stats && stats.assets) {
        console.log(chalk.gray('\nOutput files:'));
        stats.assets.forEach(asset => {
          const size = (asset.size / 1024).toFixed(1);
          const gzipSize = asset.gzipSize ? ` (gzip: ${(asset.gzipSize / 1024).toFixed(1)}kb)` : '';
          console.log(chalk.gray(`  ${asset.name}: `) + chalk.white(`${size}kb${gzipSize}`));
        });
      }

      // Run compression if configured
      if (config.compress.gzip || config.compress.brotli) {
        console.log(chalk.blue('\nCompressing output...'));
        const Optimizer = require('../compiler/optimizer');
        await Optimizer.compressDir(config._resolvedOutput, {
          gzip: config.compress.gzip,
          brotli: config.compress.brotli
        });
        console.log(chalk.green('Compression complete'));
      }

      // Copy public/static files
      const publicDir = path.resolve(projectRoot, config.publicDir || './public');
      if (fs.existsSync(publicDir)) {
        await fs.copy(publicDir, config._resolvedOutput, {
          filter: (src) => !src.endsWith('index.html')  // don't overwrite built HTML
        });
      }

      // Run LEGCOMP — legacy compatibility compiler
      if (config.legcomp && config.legcomp.enabled) {
        console.log(chalk.blue('\nLEGCOMP — Generating legacy build...'));
        try {
          const legcomp = require('../compiler/legcomp');
          const legResult = await legcomp.compile(projectRoot, config);
          console.log(chalk.green(`  ✓ Legacy build written to ${path.relative(projectRoot, legResult.outputDir)}/`));
          if (legResult.warnings.length > 0 && config.legcomp.warnings !== false) {
            console.log(chalk.yellow(`\n  Compatibility warnings (${legResult.warnings.length}):`));
            legResult.warnings.forEach(function (w) {
              console.log(chalk.yellow('    ' + w));
            });
          }
        } catch (e) {
          console.error(chalk.red('  LEGCOMP failed:'), e.message);
          if (env === 'development') console.error(e.stack);
        }
      }

      console.log(chalk.green(`\nOutput: ${path.relative(projectRoot, config._resolvedOutput)}/\n`));
    }
  } catch (err) {
    if (err.message && err.message.toLowerCase().includes('not implemented')) {
      console.error(chalk.yellow('\nCompiler feature not yet implemented:'), err.message);
      console.error(chalk.gray('The DywoCompiler is still being built. Check lib/compiler/index.js for progress.'));
    } else if (err.webpackErrors) {
      console.error(formatWebpackErrors(err.webpackErrors, config));
      if (verbose && err.rawStats) {
        console.error(chalk.gray('\n── Full webpack stats ──'));
        console.error(chalk.gray(JSON.stringify(err.rawStats, null, 2)));
      }
    } else {
      console.error(chalk.red('\nBuild failed:'), err.message);
      if (env === 'development' || verbose) console.error(err.stack);
    }
    process.exit(1);
  }
}

module.exports = build;
