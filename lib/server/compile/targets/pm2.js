'use strict';

const path = require('path');
const fs = require('fs');

function _generateEcosystemConfig(config) {
  const name = config.name || 'dywo-server';
  const port = config.port || 3000;
  const instances = config.instances || 'max';
  const maxMemory = config.maxMemoryRestart || '512M';
  const dbAdapter = (config.db && config.db.adapter) || 'none';
  const dbName = (config.db && config.db.name) || 'dywo_db';

  const env = {
    NODE_ENV: 'production',
    PORT: port,
    DB_ADAPTER: dbAdapter
  };

  if (dbAdapter !== 'none' && dbAdapter !== 'sqlite') {
    env.DB_HOST = 'localhost';
    env.DB_NAME = dbName;
  }

  const lines = [
    "'use strict';",
    '',
    'module.exports = {',
    '  apps: [',
    '    {',
    `      name: '${name}',`,
    "      script: './server.js',",
    `      instances: ${instances === 'max' ? "'max'" : instances},`,
    '      exec_mode: \'cluster\',',
    `      max_memory_restart: '${maxMemory}',`,
    '      autorestart: true,',
    '      watch: false,',
    '      max_restarts: 10,',
    '      restart_delay: 4000,',
    '      kill_timeout: 5000,',
    '      listen_timeout: 8000,',
    '      env: {',
    `        NODE_ENV: 'development',`,
    `        PORT: ${port}`,
    '      },',
    '      env_production: {'
  ];

  for (const [key, val] of Object.entries(env)) {
    const v = typeof val === 'number' ? val : `'${val}'`;
    lines.push(`        ${key}: ${v},`);
  }

  lines.push('      },');
  lines.push('      error_file: `./logs/${name}-error.log`,');
  lines.push('      out_file: `./logs/${name}-out.log`,');
  lines.push("      merge_logs: true,");
  lines.push("      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',");
  lines.push('      min_uptime: \'10s\',');
  lines.push('      exp_backoff_restart_delay: 100');
  lines.push('    }');
  lines.push('  ]');
  lines.push('};');
  lines.push('');

  return lines.join('\n');
}

function _generateStartScript(config) {
  const name = config.name || 'dywo-server';

  return `#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "\${SCRIPT_DIR}"

mkdir -p logs

if ! command -v pm2 &>/dev/null; then
  echo "[DYWO] Installing PM2..."
  npm install -g pm2
fi

echo "[DYWO] Starting ${name} with PM2..."
pm2 start ecosystem.config.js --env production
pm2 save

echo "[DYWO] Server started"
pm2 status
`;
}

function _generateStopScript(config) {
  const name = config.name || 'dywo-server';

  return `#!/usr/bin/env bash
set -euo pipefail

echo "[DYWO] Stopping ${name}..."
pm2 stop ${name}
echo "[DYWO] Server stopped"
`;
}

function _generateRestartScript(config) {
  const name = config.name || 'dywo-server';

  return `#!/usr/bin/env bash
set -euo pipefail

echo "[DYWO] Restarting ${name}..."
pm2 restart ${name} --update-env
echo "[DYWO] Server restarted"
pm2 status
`;
}

module.exports = async function compilePM2(projectRoot, config, outputDir) {
  const files = [];

  fs.writeFileSync(path.join(outputDir, 'ecosystem.config.js'), _generateEcosystemConfig(config));
  files.push('ecosystem.config.js');

  const scripts = {
    'start.sh': _generateStartScript(config),
    'stop.sh': _generateStopScript(config),
    'restart.sh': _generateRestartScript(config)
  };

  for (const [name, content] of Object.entries(scripts)) {
    const filePath = path.join(outputDir, name);
    fs.writeFileSync(filePath, content, { mode: 0o755 });
    files.push(name);
  }

  return { target: 'pm2', outputDir, files };
};
