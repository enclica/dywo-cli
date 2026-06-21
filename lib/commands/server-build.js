'use strict';

const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');
const { execSync } = require('child_process');

async function serverBuild(projectRoot, options) {
  const target = options.target || 'single';
  const validTargets = ['single', 'docker', 'shell', 'pm2', 'systemd'];

  if (!validTargets.includes(target)) {
    console.error(chalk.red(`Invalid target: ${target}`));
    console.error(chalk.gray(`Valid targets: ${validTargets.join(', ')}`));
    process.exit(1);
  }

  const config = loadServerConfig(projectRoot);
  const serverDir = path.resolve(projectRoot, config.serverDir || 'server');
  const distDir = path.resolve(projectRoot, config.buildDir || 'server-dist');
  const entryFile = config.entry || 'index.js';

  if (!fs.existsSync(path.join(serverDir, entryFile))) {
    console.error(chalk.red(`Server entry not found: ${serverDir}/${entryFile}`));
    process.exit(1);
  }

  console.log(chalk.blue(`\nDYWO Server Build — target: ${target}\n`));

  const startTime = Date.now();

  await fs.emptyDir(distDir);

  await bundleServerCode(serverDir, distDir, entryFile, projectRoot);

  await generateDeploymentArtifacts(distDir, target, config, projectRoot, entryFile);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(chalk.green(`\nBuild complete in ${elapsed}s`));
  console.log(chalk.gray(`Output: ${path.relative(projectRoot, distDir)}/\n`));
}

async function bundleServerCode(serverDir, distDir, entryFile, projectRoot) {
  console.log(chalk.gray('Bundling server code...'));

  await fs.copy(serverDir, path.join(distDir, 'app'), {
    filter: (src) => {
      const rel = path.relative(serverDir, src);
      return !rel.includes('node_modules') && !rel.startsWith('.');
    }
  });

  const pkgPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = fs.readJsonSync(pkgPath);
    const serverPkg = {
      name: pkg.name || 'dywo-server',
      version: pkg.version || '1.0.0',
      main: `app/${entryFile}`,
      scripts: {
        start: `node app/${entryFile}`
      },
      dependencies: pkg.dependencies || {}
    };
    await fs.writeJson(path.join(distDir, 'package.json'), serverPkg, { spaces: 2 });
  }

  console.log(chalk.green('  ✓ Server code bundled'));
}

async function generateDeploymentArtifacts(distDir, target, config, projectRoot, entryFile) {
  switch (target) {
    case 'single':
      await generateSingle(distDir, entryFile);
      break;
    case 'docker':
      await generateDocker(distDir, config, entryFile);
      break;
    case 'shell':
      await generateShell(distDir, config, entryFile);
      break;
    case 'pm2':
      await generatePM2(distDir, config, entryFile);
      break;
    case 'systemd':
      await generateSystemd(distDir, config, entryFile);
      break;
  }
}

async function generateSingle(distDir, entryFile) {
  const startScript = `#!/usr/bin/env node
process.env.NODE_ENV = 'production';
require('./app/${entryFile}');
`;
  await fs.writeFile(path.join(distDir, 'start.js'), startScript);
  console.log(chalk.green('  ✓ Single-file entry point generated'));
}

async function generateDocker(distDir, config, entryFile) {
  const port = config.port || 3000;

  const dockerfile = `FROM node:18-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY . .
EXPOSE ${port}
ENV NODE_ENV=production
ENV PORT=${port}
CMD ["node", "app/${entryFile}"]
`;

  const dockerignore = `node_modules
npm-debug.log
.git
.env
`;

  await fs.writeFile(path.join(distDir, 'Dockerfile'), dockerfile);
  await fs.writeFile(path.join(distDir, '.dockerignore'), dockerignore);

  console.log(chalk.green('  ✓ Dockerfile generated'));
}

async function generateShell(distDir, config, entryFile) {
  const appName = config.name || 'dywo-server';

  const script = `#!/bin/bash
set -e

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$APP_DIR/${appName}.pid"
LOG_FILE="$APP_DIR/${appName}.log"

export NODE_ENV=production
export PORT=${config.port || 3000}

start() {
  if [ -f "$PID_FILE" ]; then
    echo "${appName} is already running (PID: $(cat $PID_FILE))"
    return 1
  fi
  echo "Starting ${appName}..."
  cd "$APP_DIR"
  nohup node app/${entryFile} >> "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  echo "${appName} started (PID: $(cat $PID_FILE))"
}

stop() {
  if [ ! -f "$PID_FILE" ]; then
    echo "${appName} is not running"
    return 1
  fi
  echo "Stopping ${appName}..."
  kill $(cat "$PID_FILE")
  rm -f "$PID_FILE"
  echo "${appName} stopped"
}

restart() {
  stop
  sleep 1
  start
}

status() {
  if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if kill -0 "$PID" 2>/dev/null; then
      echo "${appName} is running (PID: $PID)"
    else
      echo "${appName} is not running (stale PID file)"
      rm -f "$PID_FILE"
    fi
  else
    echo "${appName} is not running"
  fi
}

case "$1" in
  start)   start ;;
  stop)    stop ;;
  restart) restart ;;
  status)  status ;;
  *)
    echo "Usage: $0 {start|stop|restart|status}"
    exit 1
    ;;
esac
`;

  await fs.writeFile(path.join(distDir, 'manage.sh'), script);
  await fs.chmod(path.join(distDir, 'manage.sh'), '755');

  console.log(chalk.green('  ✓ Shell management script generated'));
}

async function generatePM2(distDir, config, entryFile) {
  const appName = config.name || 'dywo-server';

  const ecosystem = `module.exports = {
  apps: [{
    name: '${appName}',
    script: 'app/${entryFile}',
    instances: '${config.instances || 'max'}',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: ${config.port || 3000}
    },
    max_memory_restart: '${config.maxMemory || '512M'}',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    error_file: './logs/error.log',
    out_file: './logs/output.log',
    merge_logs: true
  }]
};
`;

  await fs.ensureDir(path.join(distDir, 'logs'));
  await fs.writeFile(path.join(distDir, 'ecosystem.config.js'), ecosystem);

  console.log(chalk.green('  ✓ PM2 ecosystem config generated'));
}

async function generateSystemd(distDir, config, entryFile) {
  const appName = config.name || 'dywo-server';
  const user = config.user || 'www-data';

  const service = `[Unit]
Description=${appName} - DYWO Server
After=network.target

[Service]
Type=simple
User=${user}
WorkingDirectory=/opt/${appName}
ExecStart=/usr/bin/node app/${entryFile}
Restart=on-failure
RestartSec=10
StandardOutput=append:/var/log/${appName}.log
StandardError=append:/var/log/${appName}-error.log
Environment=NODE_ENV=production
Environment=PORT=${config.port || 3000}

[Install]
WantedBy=multi-user.target
`;

  await fs.writeFile(path.join(distDir, `${appName}.service`), service);

  console.log(chalk.green('  ✓ Systemd service file generated'));
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

module.exports = serverBuild;
