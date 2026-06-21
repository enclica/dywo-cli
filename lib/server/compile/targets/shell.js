'use strict';

const path = require('path');
const fs = require('fs');

function _generateDeployScript(config) {
  const name = config.name || 'dywo-server';
  const port = config.port || 3000;
  const nodeVersion = config.nodeVersion || '20';
  const dbAdapter = (config.db && config.db.adapter) || 'none';

  return `#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${name}"
APP_DIR="/opt/\${APP_NAME}"
NODE_VERSION="${nodeVersion}"
PORT="${port}"

echo "========================================="
echo "  DYWO Server Deployment"
echo "  App: \${APP_NAME}"
echo "========================================="

if [ "$(id -u)" -ne 0 ]; then
  echo "[ERROR] This script must be run as root"
  exit 1
fi

echo "[1/6] Creating application directory..."
mkdir -p "\${APP_DIR}"
useradd --system --no-create-home --shell /usr/sbin/nologin "\${APP_NAME}" 2>/dev/null || true

echo "[2/6] Installing system dependencies..."
bash "$(dirname "$0")/install.sh"

echo "[3/6] Installing Node.js \${NODE_VERSION}..."
if ! command -v node &>/dev/null || ! node -v | grep -q "v\${NODE_VERSION}"; then
  curl -fsSL https://deb.nodesource.com/setup_\${NODE_VERSION}.x | bash -
  apt-get install -y nodejs
fi
echo "Node.js $(node -v) installed"

echo "[4/6] Deploying application files..."
cp -r ./* "\${APP_DIR}/"
chown -R "\${APP_NAME}:\${APP_NAME}" "\${APP_DIR}"

echo "[5/6] Installing Node.js dependencies..."
cd "\${APP_DIR}"
sudo -u "\${APP_NAME}" npm install --production

echo "[6/6] Configuring environment..."
if [ ! -f "\${APP_DIR}/.env" ]; then
  cat > "\${APP_DIR}/.env" <<EOF
NODE_ENV=production
PORT=\${PORT}
DB_ADAPTER=${dbAdapter}
EOF
  chown "\${APP_NAME}:\${APP_NAME}" "\${APP_DIR}/.env"
  chmod 600 "\${APP_DIR}/.env"
  echo "Created .env file — edit \${APP_DIR}/.env to configure database credentials"
fi

echo ""
echo "========================================="
echo "  Deployment complete!"
echo "  App directory: \${APP_DIR}"
echo "  Run: bash start-service.sh to start"
echo "========================================="
`;
}

function _generateInstallScript(config) {
  const dbAdapter = (config.db && config.db.adapter) || 'none';

  const packages = ['curl', 'wget', 'git', 'build-essential'];

  if (dbAdapter === 'postgres' || dbAdapter === 'postgresql') {
    packages.push('postgresql-client');
  } else if (dbAdapter === 'mysql') {
    packages.push('mysql-client');
  } else if (dbAdapter === 'mongodb') {
    packages.push('mongosh');
  }

  return `#!/usr/bin/env bash
set -euo pipefail

echo "[DYWO] Installing system dependencies..."

if command -v apt-get &>/dev/null; then
  apt-get update -qq
  apt-get install -y --no-install-recommends ${packages.join(' ')}
elif command -v yum &>/dev/null; then
  yum install -y ${packages.join(' ')}
elif command -v dnf &>/dev/null; then
  dnf install -y ${packages.join(' ')}
elif command -v apk &>/dev/null; then
  apk add --no-cache curl wget git make g++
else
  echo "[WARN] Unknown package manager — install these manually: ${packages.join(', ')}"
fi

echo "[DYWO] System dependencies installed"
`;
}

function _generateBackupScript(config) {
  const name = config.name || 'dywo-server';
  const dbAdapter = (config.db && config.db.adapter) || 'none';
  const dbName = (config.db && config.db.name) || 'dywo_db';

  const lines = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    `APP_NAME="${name}"`,
    `BACKUP_DIR="/opt/\${APP_NAME}/backups"`,
    `TIMESTAMP=$(date +%Y%m%d_%H%M%S)`,
    '',
    'mkdir -p "${BACKUP_DIR}"',
    ''
  ];

  if (dbAdapter === 'postgres' || dbAdapter === 'postgresql') {
    lines.push(`DB_HOST="\${DB_HOST:-localhost}"`);
    lines.push(`DB_PORT="\${DB_PORT:-5432}"`);
    lines.push(`DB_USER="\${DB_USER:-dywo}"`);
    lines.push(`DB_NAME="${dbName}"`);
    lines.push('');
    lines.push('echo "[DYWO] Backing up PostgreSQL database ${DB_NAME}..."');
    lines.push('PGPASSWORD="${DB_PASS}" pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" -F c \\');
    lines.push('  -f "${BACKUP_DIR}/${DB_NAME}_${TIMESTAMP}.dump"');
    lines.push('echo "[DYWO] Backup saved to ${BACKUP_DIR}/${DB_NAME}_${TIMESTAMP}.dump"');
  } else if (dbAdapter === 'mysql') {
    lines.push(`DB_HOST="\${DB_HOST:-localhost}"`);
    lines.push(`DB_PORT="\${DB_PORT:-3306}"`);
    lines.push(`DB_USER="\${DB_USER:-dywo}"`);
    lines.push(`DB_NAME="${dbName}"`);
    lines.push('');
    lines.push('echo "[DYWO] Backing up MySQL database ${DB_NAME}..."');
    lines.push('mysqldump -h "${DB_HOST}" -P "${DB_PORT}" -u "${DB_USER}" -p"${DB_PASS}" "${DB_NAME}" \\');
    lines.push('  | gzip > "${BACKUP_DIR}/${DB_NAME}_${TIMESTAMP}.sql.gz"');
    lines.push('echo "[DYWO] Backup saved to ${BACKUP_DIR}/${DB_NAME}_${TIMESTAMP}.sql.gz"');
  } else if (dbAdapter === 'mongodb') {
    lines.push(`DB_HOST="\${DB_HOST:-localhost}"`);
    lines.push(`DB_PORT="\${DB_PORT:-27017}"`);
    lines.push(`DB_NAME="${dbName}"`);
    lines.push('');
    lines.push('echo "[DYWO] Backing up MongoDB database ${DB_NAME}..."');
    lines.push('mongodump --host "${DB_HOST}" --port "${DB_PORT}" --db "${DB_NAME}" \\');
    lines.push('  --out "${BACKUP_DIR}/${DB_NAME}_${TIMESTAMP}"');
    lines.push('echo "[DYWO] Backup saved to ${BACKUP_DIR}/${DB_NAME}_${TIMESTAMP}"');
  } else if (dbAdapter === 'sqlite') {
    lines.push(`DB_PATH="\${DB_PATH:-/opt/${name}/data/${dbName}.db}"`);
    lines.push('');
    lines.push('echo "[DYWO] Backing up SQLite database..."');
    lines.push('if [ -f "${DB_PATH}" ]; then');
    lines.push('  sqlite3 "${DB_PATH}" ".backup \'${BACKUP_DIR}/$(basename ${DB_PATH})_${TIMESTAMP}.db\'"');
    lines.push('  echo "[DYWO] Backup saved to ${BACKUP_DIR}/$(basename ${DB_PATH})_${TIMESTAMP}.db"');
    lines.push('else');
    lines.push('  echo "[WARN] Database file not found: ${DB_PATH}"');
    lines.push('fi');
  } else {
    lines.push('echo "[DYWO] No database configured — skipping database backup"');
  }

  lines.push('');
  lines.push('echo "[DYWO] Backing up .env file..."');
  lines.push(`if [ -f "/opt/\${APP_NAME}/.env" ]; then`);
  lines.push(`  cp "/opt/\${APP_NAME}/.env" "\${BACKUP_DIR}/env_\${TIMESTAMP}.bak"`);
  lines.push('fi');
  lines.push('');
  lines.push('echo "[DYWO] Cleaning up old backups (keeping last 7)..."');
  lines.push('ls -t "${BACKUP_DIR}"/* 2>/dev/null | tail -n +8 | xargs -r rm --');
  lines.push('');
  lines.push('echo "[DYWO] Backup complete"');
  lines.push('');

  return lines.join('\n');
}

function _generateUpdateScript(config) {
  const name = config.name || 'dywo-server';

  return `#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${name}"
APP_DIR="/opt/\${APP_NAME}"

echo "[DYWO] Updating \${APP_NAME}..."

if [ "$(id -u)" -ne 0 ]; then
  echo "[ERROR] This script must be run as root"
  exit 1
fi

echo "[1/5] Creating backup..."
bash "$(dirname "$0")/backup.sh"

echo "[2/5] Stopping server..."
if systemctl is-active --quiet "\${APP_NAME}"; then
  systemctl stop "\${APP_NAME}"
elif command -v pm2 &>/dev/null && pm2 describe "\${APP_NAME}" &>/dev/null; then
  pm2 stop "\${APP_NAME}"
fi

echo "[3/5] Updating application files..."
rsync -av --exclude='node_modules' --exclude='.env' --exclude='backups' --exclude='data' \\
  ./ "\${APP_DIR}/"

echo "[4/5] Installing dependencies..."
cd "\${APP_DIR}"
sudo -u "\${APP_NAME}" npm install --production

echo "[5/5] Restarting server..."
if systemctl list-unit-files | grep -q "\${APP_NAME}.service"; then
  systemctl start "\${APP_NAME}"
elif command -v pm2 &>/dev/null; then
  pm2 restart "\${APP_NAME}" || pm2 start ecosystem.config.js
else
  echo "[WARN] No process manager detected — start the server manually"
fi

echo "[DYWO] Update complete"
`;
}

module.exports = async function compileShell(projectRoot, config, outputDir) {
  const files = [];

  const scripts = {
    'deploy.sh': _generateDeployScript(config),
    'install.sh': _generateInstallScript(config),
    'backup.sh': _generateBackupScript(config),
    'update.sh': _generateUpdateScript(config)
  };

  for (const [name, content] of Object.entries(scripts)) {
    const filePath = path.join(outputDir, name);
    fs.writeFileSync(filePath, content, { mode: 0o755 });
    files.push(name);
  }

  return { target: 'shell', outputDir, files };
};
