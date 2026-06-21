const path = require('path');
const fs = require('fs');
const chalk = require('chalk');
const glob = require('glob');

/**
 * Format .dywo and JS/CSS/HTML source files using prettier.
 *
 * prettier is loaded from the project's own node_modules so that the project's
 * own prettier version and config (.prettierrc, prettier.config.js) are used.
 *
 * @param {object} options
 * @param {boolean} [options.write]   Write formatted output back to disk (default: true).
 * @param {boolean} [options.check]   Check-only mode — exit with non-zero if any
 *                                    file would change (useful in CI).
 * @param {string}  [options.src]     Override the source glob root (default: 'src').
 */
async function format(options) {
  const projectRoot = process.cwd();
  options = options || {};

  // Default: write unless --check is set
  const checkOnly = options.check === true;
  const shouldWrite = !checkOnly && options.write !== false;

  // ── Load prettier from the project ────────────────────────────────────────
  let prettier;
  try {
    const prettierPath = require.resolve('prettier', { paths: [projectRoot] });
    prettier = require(prettierPath);
  } catch (e) {
    console.error(
      chalk.red('prettier is not installed in this project.'),
      '\nRun: npm install --save-dev prettier'
    );
    process.exit(1);
  }

  // ── Gather files ──────────────────────────────────────────────────────────
  const srcRoot = options.src || 'src';
  const patterns = [
    `${srcRoot}/**/*.{dywo,js,jsx,ts,tsx,css,scss,html}`
  ];

  const files = patterns.reduce((acc, pattern) => {
    return acc.concat(glob.sync(pattern, { cwd: projectRoot, nodir: true }));
  }, []);

  if (files.length === 0) {
    console.log(chalk.yellow(`No files found matching ${patterns.join(', ')}`));
    return;
  }

  // ── Process each file ─────────────────────────────────────────────────────
  let formatted = 0;
  let unchanged = 0;
  let skipped = 0;
  let wouldChange = 0;

  for (const relFile of files) {
    const filePath = path.join(projectRoot, relFile);
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
      console.log(chalk.yellow(`  skipped (unreadable): ${relFile}`));
      skipped++;
      continue;
    }

    // Determine the parser.
    const parser = _parserFor(relFile);

    // Attempt to resolve a prettier config for this file (respects .prettierrc etc.)
    let prettierOptions = { parser, semi: true, singleQuote: true, trailingComma: 'es5' };
    try {
      // prettier v2: resolveConfig, prettier v3: resolveConfig (async)
      const resolved = typeof prettier.resolveConfig === 'function'
        ? (await prettier.resolveConfig(filePath)) || {}
        : {};
      prettierOptions = Object.assign(prettierOptions, resolved, { parser });
    } catch (_) {
      // Non-fatal — fall back to hardcoded defaults
    }

    let result;
    try {
      // prettier v3: format is async; v2: sync
      if (typeof prettier.format === 'function') {
        result = await Promise.resolve(prettier.format(content, prettierOptions));
      } else {
        result = prettier.format(content, prettierOptions);
      }
    } catch (e) {
      console.log(chalk.yellow(`  skipped (parse error): ${relFile} — ${e.message}`));
      skipped++;
      continue;
    }

    const changed = result !== content;

    if (!changed) {
      unchanged++;
      continue;
    }

    if (checkOnly) {
      console.log(chalk.yellow(`  needs formatting: ${relFile}`));
      wouldChange++;
    } else if (shouldWrite) {
      try {
        fs.writeFileSync(filePath, result, 'utf8');
        console.log(chalk.green(`  formatted: ${relFile}`));
        formatted++;
      } catch (e) {
        console.log(chalk.red(`  error writing: ${relFile} — ${e.message}`));
        skipped++;
      }
    } else {
      // Dry-run (no --write, no --check)
      console.log(chalk.cyan(`  would format: ${relFile}`));
      wouldChange++;
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  if (checkOnly) {
    if (wouldChange > 0) {
      console.log(chalk.red(`\n${wouldChange} file(s) need formatting. Run dywo format to fix them.\n`));
      process.exit(1);
    } else {
      console.log(chalk.green(`\nAll ${unchanged} file(s) are properly formatted.\n`));
    }
  } else if (shouldWrite) {
    console.log(
      chalk.green(`\nFormatted ${formatted} file(s)`) +
      (unchanged > 0 ? chalk.gray(`, ${unchanged} unchanged`) : '') +
      (skipped > 0 ? chalk.yellow(`, ${skipped} skipped`) : '') +
      '\n'
    );
  } else {
    console.log(chalk.cyan(`\n${wouldChange} file(s) would be formatted. Run with --write to apply.\n`));
  }
}

/**
 * Map a file path to a prettier parser name.
 *
 * @param {string} filePath
 * @returns {string}
 */
function _parserFor(filePath) {
  if (filePath.endsWith('.css') || filePath.endsWith('.scss')) return 'css';
  if (filePath.endsWith('.html') || filePath.endsWith('.dywo')) return 'html';
  if (filePath.endsWith('.json')) return 'json';
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) return 'babel-ts';
  // .js, .jsx, .mjs, and anything else default to babel
  return 'babel';
}

module.exports = format;
