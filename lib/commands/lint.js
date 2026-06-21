const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');
const { spawnSync } = require('child_process');

async function lint(options) {
  const projectRoot = process.cwd();

  // Load DYWO config to find srcDir (optional — we fall back to './src')
  let srcDir = path.join(projectRoot, 'src');
  try {
    const configLoader = require('../config/config-loader');
    const config = configLoader.load(projectRoot);
    srcDir = config._resolvedSrc || srcDir;
  } catch (_) {
    // Config may not exist — proceed with defaults
  }

  if (!fs.existsSync(srcDir)) {
    console.error(chalk.red(`Source directory not found: ${srcDir}`));
    console.error(chalk.gray('Run `dywo repair` to diagnose project issues.'));
    process.exit(1);
  }

  const useESLint = tryESLint(projectRoot);

  if (useESLint) {
    await runESLint(projectRoot, srcDir, options);
  } else {
    console.log(chalk.yellow('ESLint not found in project node_modules — falling back to syntax check.\n'));
    runSyntaxCheck(srcDir);
  }
}

/**
 * Check whether ESLint is available in the project's node_modules.
 * Returns true if it is.
 */
function tryESLint(projectRoot) {
  const eslintBin = path.join(projectRoot, 'node_modules', '.bin', 'eslint');
  return fs.existsSync(eslintBin);
}

/**
 * Run ESLint from the project's local node_modules.
 */
async function runESLint(projectRoot, srcDir, options) {
  // Resolve local ESLint
  const eslintPath = path.join(projectRoot, 'node_modules', 'eslint');
  let ESLintClass;
  try {
    const { ESLint } = require(eslintPath);
    ESLintClass = ESLint;
  } catch (err) {
    console.error(chalk.red('Failed to load project ESLint:'), err.message);
    process.exit(1);
  }

  // Build ESLint options — respect project's .eslintrc if present, else use minimal defaults
  const hasProjectConfig = [
    '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yaml', '.eslintrc.yml', '.eslintrc'
  ].some(f => fs.existsSync(path.join(projectRoot, f)));

  const eslintOptions = {
    fix: Boolean(options.fix),
    cwd: projectRoot
  };

  if (!hasProjectConfig) {
    eslintOptions.useEslintrc = false;
    eslintOptions.baseConfig = {
      extends: ['eslint:recommended'],
      parserOptions: { ecmaVersion: 2021, sourceType: 'module' },
      env: { browser: true, es2021: true, node: true }
    };
  }

  const eslint = new ESLintClass(eslintOptions);

  console.log(chalk.blue(`\nLinting ${path.relative(process.cwd(), srcDir)}/ ...\n`));

  try {
    const results = await eslint.lintFiles([`${srcDir}/**/*.{js,mjs,cjs}`]);

    if (options.fix) {
      await ESLintClass.outputFixes(results);
    }

    const formatter = await eslint.loadFormatter('stylish');
    const output = typeof formatter.format === 'function'
      ? formatter.format(results)
      : await formatter(results);

    if (output) console.log(output);

    const errorCount = results.reduce((n, r) => n + r.errorCount, 0);
    const warningCount = results.reduce((n, r) => n + r.warningCount, 0);

    if (errorCount > 0) {
      console.log(chalk.red(`\n${errorCount} error(s), ${warningCount} warning(s) found.`));
      process.exit(1);
    } else if (warningCount > 0) {
      console.log(chalk.yellow(`\n${warningCount} warning(s) found.`));
    } else {
      console.log(chalk.green('No linting errors or warnings found.'));
    }
  } catch (err) {
    console.error(chalk.red('ESLint error:'), err.message);
    process.exit(1);
  }
}

/**
 * Fallback: use `node --check` to syntax-check all .js files under srcDir.
 */
function runSyntaxCheck(srcDir) {
  console.log(chalk.blue(`\nSyntax checking ${srcDir} ...\n`));

  const jsFiles = collectFiles(srcDir, ['.js', '.mjs', '.cjs']);

  if (jsFiles.length === 0) {
    console.log(chalk.gray('No .js files found to check.'));
    return;
  }

  let errorCount = 0;

  jsFiles.forEach(file => {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) {
      errorCount++;
      const relPath = path.relative(process.cwd(), file);
      console.log(chalk.red(`  [FAIL] ${relPath}`));
      if (result.stderr) {
        result.stderr.split('\n').filter(Boolean).forEach(line => {
          console.log(chalk.gray(`         ${line}`));
        });
      }
    }
  });

  console.log('');
  if (errorCount > 0) {
    console.log(chalk.red(`${errorCount} file(s) have syntax errors.`));
    process.exit(1);
  } else {
    console.log(chalk.green(`All ${jsFiles.length} file(s) passed syntax check.`));
  }
}

/**
 * Recursively collect files with given extensions under a directory.
 */
function collectFiles(dir, extensions) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath, extensions));
    } else if (extensions.includes(path.extname(entry.name))) {
      results.push(fullPath);
    }
  }
  return results;
}

module.exports = lint;
