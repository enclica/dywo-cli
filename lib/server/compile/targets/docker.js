'use strict';

const path = require('path');
const fs = require('fs');

function _generateDockerfile(config) {
  const nodeVersion = config.nodeVersion || '20';
  const port = config.port || 3000;

  return `FROM node:${nodeVersion}-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .

FROM node:${nodeVersion}-alpine
WORKDIR /app
RUN addgroup -g 1001 -S dywo && adduser -S dywo -u 1001
COPY --from=builder --chown=dywo:dywo /app .
USER dywo
EXPOSE ${port}
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \\
  CMD wget --no-verbose --tries=1 --spider http://localhost:${port}/health || exit 1
ENTRYPOINT ["./start.sh"]
`;
}

function _generateDockerCompose(config) {
  const name = config.name || 'dywo-server';
  const port = config.port || 3000;
  const dbAdapter = (config.db && config.db.adapter) || 'none';
  const dbName = (config.db && config.db.name) || 'dywo_db';

  const services = {};

  const serverService = {
    build: '.',
    container_name: name,
    ports: [`\${PORT:-${port}}:${port}`],
    environment: [
      'NODE_ENV=production',
      `PORT=${port}`,
      `DB_ADAPTER=${dbAdapter}`
    ],
    restart: 'unless-stopped'
  };

  if (dbAdapter !== 'none') {
    serverService.depends_on = ['db'];
  }

  services[name] = serverService;

  if (dbAdapter === 'postgres' || dbAdapter === 'postgresql') {
    services.db = {
      image: 'postgres:16-alpine',
      container_name: `${name}-db`,
      environment: [
        'POSTGRES_USER=${DB_USER:-dywo}',
        'POSTGRES_PASSWORD=${DB_PASS:-dywo_secret}',
        `POSTGRES_DB=${dbName}`
      ],
      ports: ['5432:5432'],
      volumes: ['pgdata:/var/lib/postgresql/data'],
      restart: 'unless-stopped',
      healthcheck: {
        test: ['CMD-SHELL', 'pg_isready -U $${POSTGRES_USER}'],
        interval: '10s',
        timeout: '5s',
        retries: 5
      }
    };
    serverService.environment.push(
      'DB_HOST=db',
      'DB_PORT=5432',
      'DB_USER=${DB_USER:-dywo}',
      'DB_PASS=${DB_PASS:-dywo_secret}',
      `DB_NAME=${dbName}`
    );
  } else if (dbAdapter === 'mysql') {
    services.db = {
      image: 'mysql:8',
      container_name: `${name}-db`,
      environment: [
        'MYSQL_ROOT_PASSWORD=${DB_PASS:-dywo_secret}',
        `MYSQL_DATABASE=${dbName}`,
        'MYSQL_USER=${DB_USER:-dywo}',
        'MYSQL_PASSWORD=${DB_PASS:-dywo_secret}'
      ],
      ports: ['3306:3306'],
      volumes: ['mysqldata:/var/lib/mysql'],
      restart: 'unless-stopped',
      healthcheck: {
        test: ['CMD', 'mysqladmin', 'ping', '-h', 'localhost'],
        interval: '10s',
        timeout: '5s',
        retries: 5
      }
    };
    serverService.environment.push(
      'DB_HOST=db',
      'DB_PORT=3306',
      'DB_USER=${DB_USER:-dywo}',
      'DB_PASS=${DB_PASS:-dywo_secret}',
      `DB_NAME=${dbName}`
    );
  } else if (dbAdapter === 'mongodb') {
    services.db = {
      image: 'mongo:7',
      container_name: `${name}-db`,
      environment: [
        'MONGO_INITDB_ROOT_USERNAME=${DB_USER:-dywo}',
        'MONGO_INITDB_ROOT_PASSWORD=${DB_PASS:-dywo_secret}',
        `MONGO_INITDB_DATABASE=${dbName}`
      ],
      ports: ['27017:27017'],
      volumes: ['mongodata:/data/db'],
      restart: 'unless-stopped',
      healthcheck: {
        test: ['CMD', 'mongosh', '--eval', "db.adminCommand('ping')"],
        interval: '10s',
        timeout: '5s',
        retries: 5
      }
    };
    serverService.environment.push(
      'DB_HOST=db',
      'DB_PORT=27017',
      'DB_USER=${DB_USER:-dywo}',
      'DB_PASS=${DB_PASS:-dywo_secret}',
      `DB_NAME=${dbName}`,
      'DATABASE_URL=mongodb://${DB_USER:-dywo}:${DB_PASS:-dywo_secret}@db:27017/${DB_NAME:-' + dbName + '}?authSource=admin'
    );
  } else if (dbAdapter === 'sqlite') {
    serverService.volumes = ['sqlite-data:/app/data'];
    serverService.environment.push('DB_NAME=/app/data/' + dbName + '.db');
  }

  const compose = {
    version: '3.8',
    services,
    volumes: {}
  };

  if (dbAdapter === 'postgres' || dbAdapter === 'postgresql') compose.volumes.pgdata = null;
  else if (dbAdapter === 'mysql') compose.volumes.mysqldata = null;
  else if (dbAdapter === 'mongodb') compose.volumes.mongodata = null;
  else if (dbAdapter === 'sqlite') compose.volumes['sqlite-data'] = null;

  if (Object.keys(compose.volumes).length === 0) delete compose.volumes;

  return _toYaml(compose);
}

function _toYaml(obj, indent) {
  indent = indent || 0;
  const pad = '  '.repeat(indent);
  const lines = [];

  if (obj === null || obj === undefined) {
    return '';
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        const keys = Object.keys(item);
        if (keys.length > 0) {
          lines.push(pad + '- ' + keys[0] + ': ' + _yamlValue(item[keys[0]]));
          for (let i = 1; i < keys.length; i++) {
            lines.push(pad + '  ' + keys[i] + ': ' + _yamlValue(item[keys[i]]));
          }
        } else {
          lines.push(pad + '- {}');
        }
      } else {
        lines.push(pad + '- ' + _yamlValue(item));
      }
    }
    return lines.join('\n');
  }

  if (typeof obj === 'object') {
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (val === null || val === undefined) {
        lines.push(pad + key + ':');
      } else if (Array.isArray(val)) {
        lines.push(pad + key + ':');
        lines.push(_toYaml(val, indent + 1));
      } else if (typeof val === 'object') {
        lines.push(pad + key + ':');
        lines.push(_toYaml(val, indent + 1));
      } else {
        lines.push(pad + key + ': ' + _yamlValue(val));
      }
    }
    return lines.join('\n');
  }

  return pad + _yamlValue(obj);
}

function _yamlValue(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'number') return String(val);
  const s = String(val);
  if (/[:{}\[\],&*?|>!%#@`'"]/.test(s) || s === '' || s === 'true' || s === 'false' || s === 'null') {
    return "'" + s.replace(/'/g, "''") + "'";
  }
  return s;
}

function _generateDockerignore() {
  return [
    'node_modules',
    '.git',
    '.github',
    '.env',
    '.env.*',
    'npm-debug.log',
    'server-dist',
    'dist',
    '.dywo-cache',
    'coverage',
    '.nyc_output',
    '*.md',
    '.DS_Store',
    'Thumbs.db',
    '.vscode',
    '.idea',
    'test',
    'tests',
    '__tests__'
  ].join('\n') + '\n';
}

function _generateStartScript(config) {
  const dbAdapter = (config.db && config.db.adapter) || 'none';

  const lines = [
    '#!/usr/bin/env sh',
    'set -e',
    '',
    'echo "[DYWO] Starting server..."'
  ];

  if (dbAdapter === 'postgres' || dbAdapter === 'postgresql') {
    lines.push('');
    lines.push('echo "[DYWO] Waiting for PostgreSQL..."');
    lines.push('RETRIES=30');
    lines.push('until pg_isready -h "${DB_HOST:-db}" -p "${DB_PORT:-5432}" 2>/dev/null || [ $RETRIES -eq 0 ]; do');
    lines.push('  RETRIES=$((RETRIES - 1))');
    lines.push('  echo "Waiting for database... ($RETRIES retries left)"');
    lines.push('  sleep 1');
    lines.push('done');
  } else if (dbAdapter === 'mysql') {
    lines.push('');
    lines.push('echo "[DYWO] Waiting for MySQL..."');
    lines.push('RETRIES=30');
    lines.push('until mysqladmin ping -h "${DB_HOST:-db}" --silent 2>/dev/null || [ $RETRIES -eq 0 ]; do');
    lines.push('  RETRIES=$((RETRIES - 1))');
    lines.push('  echo "Waiting for database... ($RETRIES retries left)"');
    lines.push('  sleep 1');
    lines.push('done');
  } else if (dbAdapter === 'mongodb') {
    lines.push('');
    lines.push('echo "[DYWO] Waiting for MongoDB..."');
    lines.push('RETRIES=30');
    lines.push('until mongosh --host "${DB_HOST:-db}" --eval "db.adminCommand(\'ping\')" >/dev/null 2>&1 || [ $RETRIES -eq 0 ]; do');
    lines.push('  RETRIES=$((RETRIES - 1))');
    lines.push('  echo "Waiting for database... ($RETRIES retries left)"');
    lines.push('  sleep 1');
    lines.push('done');
  }

  lines.push('');
  lines.push('exec node server.js');
  lines.push('');

  return lines.join('\n');
}

module.exports = async function compileDocker(projectRoot, config, outputDir) {
  const files = [];

  fs.writeFileSync(path.join(outputDir, 'Dockerfile'), _generateDockerfile(config));
  files.push('Dockerfile');

  fs.writeFileSync(path.join(outputDir, 'docker-compose.yml'), _generateDockerCompose(config));
  files.push('docker-compose.yml');

  fs.writeFileSync(path.join(outputDir, '.dockerignore'), _generateDockerignore());
  files.push('.dockerignore');

  const startPath = path.join(outputDir, 'start.sh');
  fs.writeFileSync(startPath, _generateStartScript(config), { mode: 0o755 });
  files.push('start.sh');

  return { target: 'docker', outputDir, files };
};
