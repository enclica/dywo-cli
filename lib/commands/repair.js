const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');
const inquirer = require('inquirer');

const MINIMAL_DYWO_CONFIG = `module.exports = {
  entry: './src/main.dywo',
  output: { dir: './dist' },
  devServer: { port: 3000 }
};
`;

async function repair(options) {
  const projectRoot = process.cwd();

  console.log(chalk.blue('\nDiagnosing DYWO project...\n'));

  const issues = [];

  // ── 1. Node version ────────────────────────────────────────────────────────
  const nodeMajor = parseInt(process.version.slice(1).split('.')[0], 10);
  if (nodeMajor < 18) {
    console.log(chalk.red(`  [FAIL] Node.js >= 18 required (current: ${process.version})`));
  } else {
    console.log(chalk.green(`  [OK]   Node.js ${process.version}`));
  }

  // ── 2. dywo.config.js ──────────────────────────────────────────────────────
  const dywoConfigPath = path.join(projectRoot, 'dywo.config.js');
  const hasDywoConfig = fs.existsSync(dywoConfigPath);
  if (!hasDywoConfig) {
    console.log(chalk.red('  [FAIL] dywo.config.js not found'));
    issues.push({
      type: 'missing-dywo-config',
      message: 'Missing dywo.config.js',
      fix() {
        fs.writeFileSync(dywoConfigPath, MINIMAL_DYWO_CONFIG, 'utf8');
        console.log(chalk.green('  [FIXED] Created minimal dywo.config.js'));
      }
    });
  } else {
    console.log(chalk.green('  [OK]   dywo.config.js found'));
  }

  // ── 3. src/ directory ──────────────────────────────────────────────────────
  const srcDir = path.join(projectRoot, 'src');
  const hasSrc = fs.existsSync(srcDir);
  if (!hasSrc) {
    console.log(chalk.red('  [FAIL] src/ directory missing'));
    issues.push({
      type: 'missing-src',
      message: 'Missing src/ directory',
      fix() {
        fs.ensureDirSync(srcDir);
        console.log(chalk.green('  [FIXED] Created src/ directory'));
      }
    });
  } else {
    console.log(chalk.green('  [OK]   src/ directory found'));
  }

  // ── 4. Entry file ──────────────────────────────────────────────────────────
  // Read config entry — fall back to default if config missing/broken
  let configEntry = './src/main.dywo';
  if (hasDywoConfig) {
    try {
      delete require.cache[require.resolve(dywoConfigPath)];
      const userCfg = require(dywoConfigPath);
      if (userCfg && userCfg.entry) configEntry = userCfg.entry;
    } catch (_) {
      // malformed config — use default
    }
  }
  const entryAbsolute = path.resolve(projectRoot, configEntry);
  if (!fs.existsSync(entryAbsolute)) {
    console.log(chalk.red(`  [FAIL] Entry file not found: ${configEntry}`));
    issues.push({
      type: 'missing-entry',
      message: `Missing entry file: ${configEntry}`,
      fix: null  // can't auto-fix meaningfully without knowing content
    });
  } else {
    console.log(chalk.green(`  [OK]   Entry file found: ${configEntry}`));
  }

  // ── 5. package.json ────────────────────────────────────────────────────────
  const pkgPath = path.join(projectRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    console.log(chalk.red('  [FAIL] package.json not found'));
    issues.push({
      type: 'missing-package-json',
      message: 'Missing package.json',
      fix() {
        const pkg = {
          name: path.basename(projectRoot),
          version: '1.0.0',
          description: 'A DYWO project',
          scripts: {
            dev: 'dywo dev',
            build: 'dywo build',
            start: 'dywo serve'
          },
          dependencies: {},
          devDependencies: {}
        };
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
        console.log(chalk.green('  [FIXED] Created minimal package.json'));
      }
    });
  } else {
    console.log(chalk.green('  [OK]   package.json found'));
  }

  // ── 6. Key dependencies in project node_modules ───────────────────────────
  const nodeModules = path.join(projectRoot, 'node_modules');
  const keyDeps = ['webpack', 'babel-loader', 'css-loader'];
  const missingDeps = keyDeps.filter(dep => !fs.existsSync(path.join(nodeModules, dep)));

  if (missingDeps.length > 0) {
    console.log(chalk.yellow(`  [WARN] Missing in project node_modules: ${missingDeps.join(', ')}`));
    console.log(chalk.gray('         Run `npm install` in your project directory'));
  } else {
    console.log(chalk.green('  [OK]   webpack, babel-loader, css-loader installed'));
  }

  // ── 7. .dywo files in src/ ────────────────────────────────────────────────
  if (hasSrc) {
    let dywoFiles = [];
    try {
      dywoFiles = findDywoFiles(srcDir);
    } catch (_) {
      // src may be empty — that's fine
    }
    if (dywoFiles.length === 0) {
      console.log(chalk.yellow('  [WARN] No .dywo files found in src/'));
      console.log(chalk.gray('         Run `dywo add component MyComponent` to create one'));
    } else {
      console.log(chalk.green(`  [OK]   ${dywoFiles.length} .dywo file(s) found in src/`));
    }
  }

  console.log('');

  // ── Summary and fix ───────────────────────────────────────────────────────
  const fixableIssues = issues.filter(i => typeof i.fix === 'function');
  const unfixableIssues = issues.filter(i => i.fix === null);

  if (issues.length === 0) {
    console.log(chalk.green('All checks passed — project looks healthy.\n'));
    return;
  }

  console.log(chalk.yellow(`Found ${issues.length} issue(s):\n`));
  issues.forEach((issue, i) => {
    const fixLabel = issue.fix ? chalk.gray(' (auto-fixable)') : chalk.red(' (manual fix needed)');
    console.log(chalk.yellow(`  ${i + 1}. ${issue.message}${fixLabel}`));
  });
  console.log('');

  if (unfixableIssues.length > 0) {
    console.log(chalk.red('Issues requiring manual attention:'));
    unfixableIssues.forEach(issue => {
      console.log(chalk.red(`  - ${issue.message}`));
    });
    console.log('');
  }

  if (fixableIssues.length === 0) {
    console.log(chalk.cyan('No issues can be auto-fixed. Please address them manually.\n'));
    return;
  }

  let shouldFix = options.fix;
  if (!shouldFix) {
    const answer = await inquirer.prompt([{
      type: 'confirm',
      name: 'fix',
      message: `Auto-fix ${fixableIssues.length} issue(s)?`,
      default: false
    }]);
    shouldFix = answer.fix;
  }

  if (shouldFix) {
    console.log('');
    fixableIssues.forEach(issue => issue.fix());
    console.log('');
    console.log(chalk.green('Done. Re-run `dywo repair` to verify.\n'));
  } else {
    console.log(chalk.cyan('No changes made. Run `dywo repair --fix` to auto-fix.\n'));
  }
}

/**
 * Recursively find all .dywo files under a directory.
 */
function findDywoFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findDywoFiles(fullPath));
    } else if (entry.name.endsWith('.dywo')) {
      results.push(fullPath);
    }
  }
  return results;
}

module.exports = repair;
