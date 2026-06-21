#!/usr/bin/env node

'use strict';

const { program } = require('commander');
const chalk = require('chalk');
const path = require('path');
const fs = require('fs');

// Version from package.json
const pkg = require('../package.json');

program
  .name('dywo')
  .version(pkg.version)
  .description('DYWO — Dynamic Web Optimization CLI\nBuild modern SPAs and websites with .dywo Single File Components');

// ── create ──────────────────────────────────────────────────────
program
  .command('create [project-name]')
  .description('Create a new DYWO project')
  .option('-t, --template <name>', 'Project template: spa, vanilla, multi-page', 'spa')
  .option('-p, --pkg <manager>', 'Package manager: npm, yarn, pnpm', 'npm')
  .option('--no-install', 'Skip dependency installation')
  .option('--no-git', 'Skip git initialization')
  .action((projectName, options) => {
    require('../lib/commands/create')(projectName, options);
  });

// ── dev ─────────────────────────────────────────────────────────
program
  .command('dev')
  .description('Start development server with hot module replacement')
  .option('-p, --port <number>', 'Port number', '3000')
  .option('--host <host>', 'Host to bind to', 'localhost')
  .option('--no-open', 'Do not open browser')
  .option('-c, --config <path>', 'Path to dywo.config.js')
  .action((options) => {
    require('../lib/commands/dev')(options);
  });

// ── build ────────────────────────────────────────────────────────
program
  .command('build')
  .description('Build the project for production')
  .option('-e, --env <env>', 'Environment: production, development', 'production')
  .option('-w, --watch', 'Watch mode — rebuild on changes', false)
  .option('--no-clean', 'Do not clean output directory before build')
  .option('-c, --config <path>', 'Path to dywo.config.js')
  .option('--legacy', 'Also generate a legacy build via LEGCOMP (IE4/5, Netscape 4)', false)
  .action((options) => {
    require('../lib/commands/build')(options);
  });

// ── serve ────────────────────────────────────────────────────────
program
  .command('serve')
  .description('Serve the production build locally')
  .option('-p, --port <number>', 'Port number', '3000')
  .option('--no-open', 'Do not open browser')
  .action((options) => {
    require('../lib/commands/serve')(options);
  });

// ── migrate ──────────────────────────────────────────────────────
program
  .command('migrate')
  .description('Convert an existing HTML/CSS/JS site to a DYWO project')
  .option('-s, --source <path>', 'Source directory of legacy site', '.')
  .option('-o, --output <path>', 'Output directory for new DYWO project', './dywo-project')
  .option('--spa', 'Convert to single-page app mode', false)
  .option('--multi-page', 'Convert to multi-page mode', false)
  .action((options) => {
    require('../lib/commands/migrate')(options);
  });

// ── add ──────────────────────────────────────────────────────────
program
  .command('add <type> [name]')
  .description('Add a component, page, or route\n  Types: component, page, route')
  .option('-p, --path <dir>', 'Custom directory path')
  .action((type, name, options) => {
    require('../lib/commands/add')(type, name, options);
  });

// ── analyze ──────────────────────────────────────────────────────
program
  .command('analyze')
  .description('Analyze bundle size with interactive visualization')
  .action((options) => {
    require('../lib/commands/analyze')(options);
  });

// ── optimize ─────────────────────────────────────────────────────
program
  .command('optimize')
  .description('Post-build optimization: compress assets, generate gzip/brotli')
  .option('--gzip', 'Generate .gz files', false)
  .option('--brotli', 'Generate .br files', false)
  .option('--images', 'Optimize image files', false)
  .action((options) => {
    require('../lib/commands/optimize')(options);
  });

// ── lint ─────────────────────────────────────────────────────────
program
  .command('lint')
  .description('Lint .dywo and .js files')
  .option('-f, --fix', 'Auto-fix problems', false)
  .action((options) => {
    require('../lib/commands/lint')(options);
  });

// ── format ───────────────────────────────────────────────────────
program
  .command('format')
  .description('Format source files with prettier')
  .option('--check', 'Check only, do not write', false)
  .action((options) => {
    require('../lib/commands/format')(options);
  });

// ── test ─────────────────────────────────────────────────────────
program
  .command('test')
  .description('Run tests')
  .option('-w, --watch', 'Watch mode', false)
  .option('--coverage', 'Collect coverage', false)
  .action((options) => {
    require('../lib/commands/test')(options);
  });

// ── obfuscate ────────────────────────────────────────────────────
program
  .command('obfuscate')
  .description('Obfuscate compiled JavaScript (use after build)')
  .option('-l, --level <level>', 'Obfuscation level: low, medium, high', 'medium')
  .action((options) => {
    require('../lib/commands/obfuscate')(options);
  });

// ── info ─────────────────────────────────────────────────────────
program
  .command('info')
  .description('Show project and environment info')
  .action(() => {
    const projectRoot = process.cwd();
    console.log(chalk.blue('\nDYWO Project Info\n'));

    // Node version
    console.log(chalk.gray('Node:       ') + process.version);
    console.log(chalk.gray('DYWO:       ') + pkg.version);
    console.log(chalk.gray('Platform:   ') + process.platform);
    console.log(chalk.gray('Arch:       ') + process.arch);

    // Project info
    const pkgPath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const projPkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      console.log(chalk.gray('\nProject:    ') + (projPkg.name || 'unknown'));
      console.log(chalk.gray('Version:    ') + (projPkg.version || 'unknown'));
    }

    const configPath = path.join(projectRoot, 'dywo.config.js');
    console.log(chalk.gray('Config:     ') + (fs.existsSync(configPath) ? chalk.green('dywo.config.js found') : chalk.yellow('no dywo.config.js (using defaults)')));

    const srcDir = path.join(projectRoot, 'src');
    if (fs.existsSync(srcDir)) {
      const dywoFiles = fs.readdirSync(srcDir).filter(f => f.endsWith('.dywo'));
      console.log(chalk.gray('Components: ') + dywoFiles.length + ' .dywo files in src/');
    }

    console.log('');
  });

// ── repair ───────────────────────────────────────────────────────
program
  .command('repair')
  .description('Diagnose and repair DYWO project issues')
  .option('-f, --fix', 'Automatically fix issues', false)
  .action((options) => {
    require('../lib/commands/repair')(options);
  });

// ── config ───────────────────────────────────────────────────────
program
  .command('config')
  .description('Interactive TUI wizard for configuring dywo.config.js')
  .option('--show', 'Print the current configuration')
  .option('--reset', 'Reset dywo.config.js to defaults')
  .action((options) => {
    require('../lib/commands/config')(options);
  });

// ── server ───────────────────────────────────────────────────────
program
  .command('server [subcommand]')
  .description('DYWO Server — Build and manage APIs')
  .option('-t, --target <target>', 'Build target: single, docker, shell, pm2, systemd', 'single')
  .option('-p, --port <number>', 'Server port', '3000')
  .option('--host <host>', 'Server host', '0.0.0.0')
  .option('--methods <methods>', 'HTTP methods for API generation (comma-separated)', 'get,post,put,delete')
  .action((subcommand, options) => {
    options.subcommand = subcommand;
    require('../lib/commands/server')(options);
  });

// ── Unknown commands ─────────────────────────────────────────────
program.on('command:*', (operands) => {
  console.error(chalk.red(`Unknown command: ${operands[0]}`));
  console.error(chalk.gray('Run `dywo --help` for available commands'));
  process.exit(1);
});

// Show help if no command given
if (!process.argv.slice(2).length) {
  // Show a nice welcome banner
  console.log(chalk.blue('\n  ██████╗ ██╗   ██╗██╗    ██╗ ██████╗'));
  console.log(chalk.blue('  ██╔══██╗╚██╗ ██╔╝██║    ██║██╔═══██╗'));
  console.log(chalk.blue('  ██║  ██║ ╚████╔╝ ██║ █╗ ██║██║   ██║'));
  console.log(chalk.blue('  ██║  ██║  ╚██╔╝  ██║███╗██║██║   ██║'));
  console.log(chalk.blue('  ██████╔╝   ██║   ╚███╔███╔╝╚██████╔╝'));
  console.log(chalk.blue('  ╚═════╝    ╚═╝    ╚══╝╚══╝  ╚═════╝ '));
  console.log(chalk.gray(`\n  Dynamic Web Optimization v${pkg.version}\n`));
  program.outputHelp();
}

program.parse(process.argv);
