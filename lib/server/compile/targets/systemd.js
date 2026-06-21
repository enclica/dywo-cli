'use strict';

const path = require('path');
const fs = require('fs');

function _generateServiceFile(config) {
  const name = config.name || 'dywo-server';
  const description = config.description || 'DYWO Server Application';
  const port = config.port || 3000;
  const appDir = `/opt/${name}`;
  const user = name;

  return `[Unit]
Description=${description}
Documentation=https://github.com/enclica/dywo-cli
After=network.target
${_wantsDb(config)}

[Service]
Type=simple
User=${user}
Group=${user}
WorkingDirectory=${appDir}
ExecStart=/usr/bin/node ${appDir}/server.js
Restart=on-failure
RestartSec=5
KillMode=process
KillSignal=SIGTERM
TimeoutStopSec=10

Environment=NODE_ENV=production
Environment=PORT=${port}
EnvironmentFile=-${appDir}/.env

StandardOutput=journal
StandardError=journal
SyslogIdentifier=${name}

NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${appDir}/data ${appDir}/logs
PrivateTmp=true

[Install]
WantedBy=multi-user.target
`;
}

function _wantsDb(config) {
  const adapter = (config.db && config.db.adapter) || 'none';
  switch (adapter) {
    case 'postgres':
    case 'postgresql':
      return 'After=postgresql.service\nWants=postgresql.service';
    case 'mysql':
      return 'After=mysql.service\nWants=mysql.service';
    case 'mongodb':
      return 'After=mongod.service\nWants=mongod.service';
    default:
      return '';
  }
}

function _generateInstallScript(config) {
  const name = config.name || 'dywo-server';
  const appDir = `/opt/${name}`;

  return `#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${name}"
APP_DIR="${appDir}"
SERVICE_FILE="$(dirname "$0")/\${SERVICE_NAME}.service"

if [ "$(id -u)" -ne 0 ]; then
  echo "[ERROR] This script must be run as root"
  exit 1
fi

echo "[DYWO] Installing systemd service for \${SERVICE_NAME}..."

echo "[1/4] Creating service user..."
useradd --system --no-create-home --shell /usr/sbin/nologin "\${SERVICE_NAME}" 2>/dev/null || true

echo "[2/4] Setting up directories..."
mkdir -p "\${APP_DIR}/logs" "\${APP_DIR}/data"
chown -R "\${SERVICE_NAME}:\${SERVICE_NAME}" "\${APP_DIR}"

echo "[3/4] Installing service file..."
cp "\${SERVICE_FILE}" /etc/systemd/system/\${SERVICE_NAME}.service
chmod 644 /etc/systemd/system/\${SERVICE_NAME}.service

echo "[4/4] Enabling and starting service..."
systemctl daemon-reload
systemctl enable "\${SERVICE_NAME}"
systemctl start "\${SERVICE_NAME}"

echo ""
echo "========================================="
echo "  Service installed and started!"
echo "  Status: systemctl status \${SERVICE_NAME}"
echo "  Logs:   journalctl -u \${SERVICE_NAME} -f"
echo "  Stop:   systemctl stop \${SERVICE_NAME}"
echo "========================================="
`;
}

module.exports = async function compileSystemd(projectRoot, config, outputDir) {
  const name = config.name || 'dywo-server';
  const files = [];

  fs.writeFileSync(path.join(outputDir, `${name}.service`), _generateServiceFile(config));
  files.push(`${name}.service`);

  const installPath = path.join(outputDir, 'install.sh');
  fs.writeFileSync(installPath, _generateInstallScript(config), { mode: 0o755 });
  files.push('install.sh');

  return { target: 'systemd', outputDir, files };
};
