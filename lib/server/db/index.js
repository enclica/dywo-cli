'use strict';

/**
 * DYWO Database Manager
 * Unified interface for multiple database backends.
 * Supports: SQLite, PostgreSQL, MySQL, MongoDB, JSON file storage
 */

class DatabaseManager {
  constructor() {
    this.connections = {};
    this.adapters = {};
  }

  registerAdapter(name, adapter) {
    this.adapters[name] = adapter;
  }

  async connect(name, config) {
    const adapterName = config.adapter || config.type || 'sqlite';
    const adapter = this.adapters[adapterName];
    if (!adapter) throw new Error(`Unknown database adapter: ${adapterName}`);
    this.connections[name] = await adapter.connect(config);
    return this.connections[name];
  }

  get(name) {
    return this.connections[name];
  }

  async close(name) {
    if (this.connections[name]) {
      await this.connections[name].close();
      delete this.connections[name];
    }
  }

  async closeAll() {
    for (const name of Object.keys(this.connections)) {
      await this.close(name);
    }
  }
}

module.exports = { DatabaseManager };
