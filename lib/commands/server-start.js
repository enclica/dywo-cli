'use strict';

const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');
const { spawn } = require('child_process');

async function serverStart(projectRoot, options) {
  const port = parseInt(options.port, 10) || 3000;
  const host = options.host || '0.0.0.0';

  const config = loadServerConfig(projectRoot);
  const serverDir = path.resolve(projectRoot, config.serverDir || 'server');
  const entryFile = config.entry || 'index.js';
  const entryPath = path.join(serverDir, entryFile);

  if (!fs.existsSync(entryPath)) {
    console.error(chalk.red(`Server entry not found: ${path.relative(projectRoot, entryPath)}`));
    console.error(chalk.gray('Create server/index.js or set server.entry in dywo.config.js'));
    process.exit(1);
  }

  console.log(chalk.blue('\nDYWO Server — Development Mode\n'));
  console.log(chalk.gray('  Entry:  ') + path.relative(projectRoot, entryPath));
  console.log(chalk.gray('  Port:   ') + port);
  console.log(chalk.gray('  Host:   ') + host);
  console.log('');

  let serverProcess = null;
  let restarting = false;

  function startProcess() {
    const env = Object.assign({}, process.env, {
      PORT: String(port),
      HOST: host,
      NODE_ENV: 'development',
      DYWO_SERVER: '1'
    });

    serverProcess = spawn(process.execPath, [entryPath], {
      env,
      stdio: 'inherit',
      cwd: projectRoot
    });

    serverProcess.on('exit', (code, signal) => {
      if (!restarting) {
        if (signal) {
          console.log(chalk.gray(`\nServer killed by signal ${signal}`));
        } else if (code !== 0) {
          console.log(chalk.red(`\nServer exited with code ${code}`));
        } else {
          console.log(chalk.gray('\nServer exited'));
        }
      }
      serverProcess = null;
    });

    serverProcess.on('error', (err) => {
      console.error(chalk.red('\nFailed to start server:'), err.message);
    });
  }

  function restartProcess() {
    restarting = true;
    if (serverProcess) {
      console.log(chalk.yellow('\nRestarting server...'));
      serverProcess.kill('SIGTERM');
      setTimeout(() => {
        if (serverProcess) serverProcess.kill('SIGKILL');
        serverProcess = null;
        restarting = false;
        startProcess();
      }, 300);
    } else {
      restarting = false;
      startProcess();
    }
  }

  startProcess();

  try {
    const chokidar = require('chokidar');
    const watchPaths = [serverDir];
    const watchIgnore = [/node_modules/, /\.git/];

    if (config.watchPaths) {
      config.watchPaths.forEach(p => watchPaths.push(path.resolve(projectRoot, p)));
    }

    const watcher = chokidar.watch(watchPaths, {
      ignored: watchIgnore,
      ignoreInitial: true,
      persistent: true
    });

    let debounceTimer = null;

    watcher.on('all', (event, filePath) => {
      const rel = path.relative(projectRoot, filePath);
      console.log(chalk.cyan(`  ${event}: ${rel}`));

      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => restartProcess(), 200);
    });

    console.log(chalk.green('Watching for file changes...\n'));
    console.log(chalk.gray('Press Ctrl+C to stop\n'));
  } catch (e) {
    console.log(chalk.yellow('chokidar not available — file watching disabled'));
    console.log(chalk.gray('Install with: npm install chokidar\n'));
  }

  process.on('SIGINT', () => {
    console.log(chalk.gray('\nStopping server...'));
    if (serverProcess) serverProcess.kill('SIGTERM');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    if (serverProcess) serverProcess.kill('SIGTERM');
    process.exit(0);
  });
}

function loadServerConfig(projectRoot) {
  const configLoader = require('../config/config-loader');
  let config = {};

  try {
    const dywoConfig = configLoader.load(projectRoot);
    config = dywoConfig.server || {};
  } catch (e) {
    // no dywo.config.js
  }

  const serverConfigPath = path.join(projectRoot, 'dywo.server.js');
  if (fs.existsSync(serverConfigPath)) {
    try {
      delete require.cache[require.resolve(serverConfigPath)];
      const serverConf = require(serverConfigPath);
      config = Object.assign(config, serverConf);
    } catch (e) {
      console.error(chalk.yellow('Warning: failed to load dywo.server.js:'), e.message);
    }
  }

  return config;
}

module.exports = serverStart;
