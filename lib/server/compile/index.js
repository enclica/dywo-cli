'use strict';

const path = require('path');
const fs = require('fs');

const singleFile = require('./targets/single-file');
const docker = require('./targets/docker');
const shell = require('./targets/shell');
const pm2 = require('./targets/pm2');
const systemd = require('./targets/systemd');

const TARGETS = {
  single: singleFile,
  docker: docker,
  shell: shell,
  standalone: null,
  pm2: pm2,
  systemd: systemd
};

class ServerCompiler {
  constructor(projectRoot, config) {
    this.projectRoot = projectRoot;
    this.config = config || {};
    this.outputDir = path.resolve(projectRoot, config.output || './server-dist');
  }

  async compile(target) {
    fs.mkdirSync(this.outputDir, { recursive: true });

    if (target === 'standalone') return this._compileStandalone();
    if (target === 'all') return this._compileAll();

    const handler = TARGETS[target];
    if (!handler) throw new Error(`Unknown compilation target: ${target}`);

    return handler(this.projectRoot, this.config, this.outputDir);
  }

  async _compileStandalone() {
    const pkg = {
      name: this.config.name || 'dywo-server',
      version: this.config.version || '1.0.0',
      description: this.config.description || 'DYWO server standalone build',
      main: 'server.js',
      scripts: {
        start: 'node server.js'
      },
      dependencies: this._resolveDependencies(),
      engines: { node: '>=18.0.0' }
    };

    fs.writeFileSync(
      path.join(this.outputDir, 'package.json'),
      JSON.stringify(pkg, null, 2)
    );

    const startScript = [
      '#!/usr/bin/env sh',
      'set -e',
      'echo "[DYWO] Installing dependencies..."',
      'npm install --production',
      'echo "[DYWO] Starting server..."',
      'exec node server.js'
    ].join('\n') + '\n';

    const startPath = path.join(this.outputDir, 'start.sh');
    fs.writeFileSync(startPath, startScript, { mode: 0o755 });

    await singleFile(this.projectRoot, this.config, this.outputDir);

    return { target: 'standalone', outputDir: this.outputDir, files: ['package.json', 'server.js', 'start.sh'] };
  }

  async _compileAll() {
    const results = [];
    for (const name of Object.keys(TARGETS)) {
      if (name === 'standalone') continue;
      const subDir = path.join(this.outputDir, name);
      fs.mkdirSync(subDir, { recursive: true });
      results.push(await TARGETS[name](this.projectRoot, this.config, subDir));
    }
    return results;
  }

  _resolveDependencies() {
    const deps = {};
    const dbAdapter = (this.config.db && this.config.db.adapter) || 'none';
    switch (dbAdapter) {
      case 'postgres':
      case 'postgresql':
        deps.pg = '^8.12.0';
        break;
      case 'mysql':
        deps.mysql2 = '^3.9.0';
        break;
      case 'mongodb':
        deps.mongodb = '^6.3.0';
        break;
      case 'sqlite':
        deps['better-sqlite3'] = '^11.0.0';
        break;
    }
    return deps;
  }
}

module.exports = { ServerCompiler };
