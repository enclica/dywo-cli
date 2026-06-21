'use strict';

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const inquirer = require('inquirer');
const configLoader = require('../config/config-loader');
const defaults = require('../config/defaults');

async function config(options) {
  const projectRoot = process.cwd();
  const configPath = path.join(projectRoot, 'dywo.config.js');

  if (options.show) {
    return showConfig(projectRoot, configPath);
  }

  if (options.reset) {
    return resetConfig(projectRoot, configPath);
  }

  printBanner();

  let currentConfig;
  try {
    currentConfig = configLoader.load(projectRoot);
  } catch (e) {
    console.warn(chalk.yellow('Existing config has errors, starting from defaults:'), e.message);
    currentConfig = JSON.parse(JSON.stringify(defaults));
  }

  let editing = true;
  while (editing) {
    const { section } = await inquirer.prompt([
      {
        type: 'list',
        name: 'section',
        message: 'Select a section to edit (or save & exit):',
        choices: [
          { name: '📁 Project (entry, src, public dirs)', value: 'project' },
          { name: '📦 Output (dir, publicPath, clean)', value: 'output' },
          { name: '🖥️  Dev Server (port, host, HMR)', value: 'dev' },
          { name: '🗜️  Compression (minify, gzip, brotli)', value: 'compress' },
          { name: '🗺️  Source Maps (dev/prod)', value: 'sourcemap' },
          { name: '🔗 Aliases (@, @components, etc.)', value: 'alias' },
          { name: '🕰️  LEGCOMP (legacy browser support)', value: 'legcomp' },
          new inquirer.Separator(),
          { name: chalk.green('✓ Save and exit'), value: 'save' },
          { name: chalk.red('✗ Cancel without saving'), value: 'cancel' }
        ],
        pageSize: 12
      }
    ]);

    if (section === 'save') {
      editing = false;
      const configContent = generateConfigFile(currentConfig);
      fs.writeFileSync(configPath, configContent, 'utf8');
      console.log(chalk.green('\n  ✓ Configuration written to dywo.config.js\n'));
      console.log(chalk.gray('  Run ') + chalk.cyan('dywo build') + chalk.gray(' to build your project.\n'));
      return;
    }

    if (section === 'cancel') {
      editing = false;
      console.log(chalk.gray('\nCancelled. No changes made.\n'));
      return;
    }

    await editSection(section, currentConfig);
  }
}

async function editSection(section, config) {
  switch (section) {
    case 'project':
      await editProject(config);
      break;
    case 'output':
      await editOutput(config);
      break;
    case 'dev':
      await editDevServer(config);
      break;
    case 'compress':
      await editCompression(config);
      break;
    case 'sourcemap':
      await editSourceMaps(config);
      break;
    case 'alias':
      await editAliases(config);
      break;
    case 'legcomp':
      await editLegcomp(config);
      break;
  }
}

async function editProject(config) {
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'entry',
      message: 'Entry file:',
      default: config.entry || './src/main.dywo',
      validate: v => v.endsWith('.dywo') || 'Entry must be a .dywo file'
    },
    {
      type: 'input',
      name: 'srcDir',
      message: 'Source directory:',
      default: config.srcDir || './src'
    },
    {
      type: 'input',
      name: 'publicDir',
      message: 'Public/static assets directory:',
      default: config.publicDir || './public'
    }
  ]);
  config.entry = answers.entry;
  config.srcDir = answers.srcDir;
  config.publicDir = answers.publicDir;
}

async function editOutput(config) {
  config.output = config.output || {};
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'dir',
      message: 'Output directory:',
      default: config.output.dir || './dist'
    },
    {
      type: 'list',
      name: 'publicPath',
      message: 'Public path (how assets are referenced):',
      choices: [
        { name: 'auto  — relative to HTML page (works in subdirs)', value: 'auto' },
        { name: '/     — absolute from web root', value: '/' },
        { name: './   — relative path', value: './' }
      ],
      default: config.output.publicPath || 'auto'
    },
    {
      type: 'confirm',
      name: 'clean',
      message: 'Clean output directory before each build?',
      default: config.output.clean !== false
    }
  ]);
  config.output.dir = answers.dir;
  config.output.publicPath = answers.publicPath;
  config.output.clean = answers.clean;
}

async function editDevServer(config) {
  config.devServer = config.devServer || {};
  const answers = await inquirer.prompt([
    {
      type: 'number',
      name: 'port',
      message: 'Dev server port:',
      default: config.devServer.port || 3000,
      validate: v => (v >= 1 && v <= 65535) || 'Port must be 1-65535'
    },
    {
      type: 'input',
      name: 'host',
      message: 'Dev server host:',
      default: config.devServer.host || 'localhost'
    },
    {
      type: 'confirm',
      name: 'open',
      message: 'Open browser on dev server start?',
      default: config.devServer.open !== false
    },
    {
      type: 'confirm',
      name: 'hmr',
      message: 'Enable Hot Module Replacement (HMR)?',
      default: config.devServer.hmr !== false
    },
    {
      type: 'confirm',
      name: 'historyApiFallback',
      message: 'Enable history API fallback (SPA routing)?',
      default: config.devServer.historyApiFallback !== false
    }
  ]);
  config.devServer.port = answers.port;
  config.devServer.host = answers.host;
  config.devServer.open = answers.open;
  config.devServer.hmr = answers.hmr;
  config.devServer.historyApiFallback = answers.historyApiFallback;
}

async function editCompression(config) {
  config.compress = config.compress || {};
  config.compress.js = config.compress.js || {};
  config.compress.css = config.compress.css || {};
  config.compress.html = config.compress.html || {};

  const answers = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'jsMinify',
      message: 'Minify JavaScript?',
      default: config.compress.js.minify !== false
    },
    {
      type: 'confirm',
      name: 'cssMinify',
      message: 'Minify CSS?',
      default: config.compress.css.minify !== false
    },
    {
      type: 'confirm',
      name: 'autoprefixer',
      message: 'Enable CSS autoprefixer?',
      default: config.compress.css.autoprefixer !== false
    },
    {
      type: 'confirm',
      name: 'htmlMinify',
      message: 'Minify HTML?',
      default: config.compress.html.minify !== false
    },
    {
      type: 'confirm',
      name: 'gzip',
      message: 'Generate gzip (.gz) files?',
      default: !!config.compress.gzip
    },
    {
      type: 'confirm',
      name: 'brotli',
      message: 'Generate brotli (.br) files?',
      default: !!config.compress.brotli
    }
  ]);
  config.compress.js.minify = answers.jsMinify;
  config.compress.css.minify = answers.cssMinify;
  config.compress.css.autoprefixer = answers.autoprefixer;
  config.compress.html.minify = answers.htmlMinify;
  config.compress.gzip = answers.gzip;
  config.compress.brotli = answers.brotli;
}

async function editSourceMaps(config) {
  config.sourceMaps = config.sourceMaps || {};
  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'dev',
      message: 'Dev source maps:',
      choices: [
        { name: 'eval-source-map  — fast, best for dev', value: 'eval-source-map' },
        { name: 'source-map       — full, slower', value: 'source-map' },
        { name: 'cheap-source-map — faster, less accurate', value: 'cheap-source-map' },
        { name: 'none             — no source maps', value: false }
      ],
      default: config.sourceMaps.dev || 'eval-source-map'
    },
    {
      type: 'list',
      name: 'prod',
      message: 'Production source maps:',
      choices: [
        { name: 'source-map       — full source maps', value: 'source-map' },
        { name: 'hidden-source-map — full, but hidden from browser', value: 'hidden-source-map' },
        { name: 'none             — no source maps (recommended)', value: false }
      ],
      default: config.sourceMaps.prod || false
    }
  ]);
  config.sourceMaps.dev = answers.dev;
  config.sourceMaps.prod = answers.prod;
}

async function editAliases(config) {
  config.alias = config.alias || {};
  const { configure } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'configure',
      message: 'Configure path aliases?',
      default: Object.keys(config.alias).length > 0
    }
  ]);

  if (!configure) {
    config.alias = {};
    return;
  }

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'at',
      message: '@ alias (base source dir):',
      default: config.alias['@'] || './src'
    },
    {
      type: 'input',
      name: 'components',
      message: '@components alias:',
      default: config.alias['@components'] || './src/components'
    },
    {
      type: 'input',
      name: 'pages',
      message: '@pages alias:',
      default: config.alias['@pages'] || './src/pages'
    },
    {
      type: 'input',
      name: 'assets',
      message: '@assets alias:',
      default: config.alias['@assets'] || './src/assets'
    }
  ]);

  config.alias = {};
  if (answers.at) config.alias['@'] = answers.at;
  if (answers.components) config.alias['@components'] = answers.components;
  if (answers.pages) config.alias['@pages'] = answers.pages;
  if (answers.assets) config.alias['@assets'] = answers.assets;
}

async function editLegcomp(config) {
  config.legcomp = config.legcomp || {};
  console.log(chalk.cyan('\n  ── LEGCOMP — Legacy Compatibility ──'));
  console.log(chalk.gray('  Generates a build for IE 4/5, Netscape 3/4 (Windows 95-2000 era).\n'));

  const answers = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'enabled',
      message: 'Enable legacy build (LEGCOMP)?',
      default: !!config.legcomp.enabled
    },
    {
      type: 'list',
      name: 'target',
      message: 'Legacy target browser:',
      choices: [
        { name: 'IE 5       — Windows 98/2000 (most compatible)', value: 'ie5' },
        { name: 'IE 4       — Windows 95/98 (very limited)', value: 'ie4' },
        { name: 'Netscape 4 — Netscape Navigator 4.x', value: 'netscape4' },
        { name: 'Opera 5    — Opera 5.x', value: 'opera5' }
      ],
      default: config.legcomp.target || 'ie5',
      when: a => a.enabled
    },
    {
      type: 'input',
      name: 'output',
      message: 'Legacy output subdirectory:',
      default: config.legcomp.output || 'legacy',
      when: a => a.enabled
    },
    {
      type: 'confirm',
      name: 'embed',
      message: 'Embed all JS/CSS into a single HTML file? (best for legacy)',
      default: config.legcomp.embed !== false,
      when: a => a.enabled
    },
    {
      type: 'confirm',
      name: 'warnings',
      message: 'Show compatibility warnings for modern features?',
      default: config.legcomp.warnings !== false,
      when: a => a.enabled
    }
  ]);

  if (answers.enabled) {
    config.legcomp = {
      enabled: true,
      target: answers.target || 'ie5',
      output: answers.output || 'legacy',
      embed: answers.embed !== false,
      warnings: answers.warnings !== false
    };
  } else {
    config.legcomp = { enabled: false };
  }
}

function printBanner() {
  console.log('');
  console.log(chalk.blue('  ╔════════════════════════════════════════════════╗'));
  console.log(chalk.blue('  ║         DYWO Configuration Wizard              ║'));
  console.log(chalk.blue('  ║         ──────────────────────────              ║'));
  console.log(chalk.blue('  ║         Interactive project setup              ║'));
  console.log(chalk.blue('  ╚════════════════════════════════════════════════╝'));
  console.log('');
  console.log(chalk.gray('  Navigate with arrow keys. Press Enter to select.'));
  console.log(chalk.gray('  Ctrl+C to cancel at any time.\n'));
}

function generateConfigFile(config) {
  let content = 'module.exports = {\n';

  content += `  entry: '${config.entry}',\n\n`;

  content += '  output: {\n';
  content += `    dir: '${config.output.dir}',\n`;
  content += `    publicPath: '${config.output.publicPath}',\n`;
  content += `    clean: ${config.output.clean}\n`;
  content += '  },\n\n';

  content += `  srcDir: '${config.srcDir}',\n`;
  content += `  publicDir: '${config.publicDir}',\n\n`;

  const aliasKeys = Object.keys(config.alias || {});
  if (aliasKeys.length > 0) {
    content += '  alias: {\n';
    aliasKeys.forEach(function (k) {
      content += `    '${k}': '${config.alias[k]}',\n`;
    });
    content += '  },\n\n';
  }

  content += '  compress: {\n';
  content += '    js: { minify: ' + (config.compress.js.minify !== false) + ', dropConsole: false },\n';
  content += '    css: { minify: ' + (config.compress.css.minify !== false) + ', autoprefixer: ' + (config.compress.css.autoprefixer !== false) + ' },\n';
  content += '    html: { minify: ' + (config.compress.html.minify !== false) + ', removeComments: true },\n';
  content += '    gzip: ' + !!config.compress.gzip + ',\n';
  content += '    brotli: ' + !!config.compress.brotli + '\n';
  content += '  },\n\n';

  content += '  devServer: {\n';
  content += '    port: ' + (config.devServer.port || 3000) + ',\n';
  content += `    host: '${config.devServer.host || 'localhost'}',\n`;
  content += '    open: ' + (config.devServer.open !== false) + ',\n';
  content += '    hmr: ' + (config.devServer.hmr !== false) + ',\n';
  content += '    historyApiFallback: ' + (config.devServer.historyApiFallback !== false) + '\n';
  content += '  },\n\n';

  content += '  sourceMaps: {\n';
  content += `    dev: ${config.sourceMaps.dev ? "'" + config.sourceMaps.dev + "'" : false},\n`;
  content += `    prod: ${config.sourceMaps.prod ? "'" + config.sourceMaps.prod + "'" : false}\n`;
  content += '  },\n\n';

  if (config.legcomp && config.legcomp.enabled) {
    content += '  legcomp: {\n';
    content += '    enabled: true,\n';
    content += `    target: '${config.legcomp.target || 'ie5'}',\n`;
    content += `    output: '${config.legcomp.output || 'legacy'}',\n`;
    content += '    embed: ' + (config.legcomp.embed !== false) + ',\n';
    content += '    warnings: ' + (config.legcomp.warnings !== false) + '\n';
    content += '  },\n\n';
  }

  content += '  webpack: null\n';
  content += '};\n';

  return content;
}

function showConfig(projectRoot, configPath) {
  if (!fs.existsSync(configPath)) {
    console.log(chalk.yellow('\nNo dywo.config.js found. Showing defaults:\n'));
    console.log(JSON.stringify(defaults, null, 2));
    return;
  }
  try {
    delete require.cache[require.resolve(configPath)];
    const cfg = require(configPath);
    console.log(chalk.blue('\nCurrent dywo.config.js:\n'));
    console.log(JSON.stringify(cfg, null, 2));
    console.log('');
  } catch (e) {
    console.error(chalk.red('Error reading config:'), e.message);
    process.exit(1);
  }
}

function resetConfig(projectRoot, configPath) {
  const content = 'module.exports = ' + JSON.stringify(defaults, null, 2) + ';\n';
  fs.writeFileSync(configPath, content, 'utf8');
  console.log(chalk.green('\n  ✓ dywo.config.js reset to defaults.\n'));
}

module.exports = config;
