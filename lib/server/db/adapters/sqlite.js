'use strict';

const path = require('path');
const fs = require('fs');

class SQLiteAdapter {
  async connect(config) {
    const dbPath = config.path || config.database || ':memory:';
    try {
      const Database = require('better-sqlite3');
      const db = new Database(dbPath);
      return new SQLiteConnection(db, 'better-sqlite3');
    } catch (e) {
      return new JSONFileConnection(dbPath);
    }
  }
}

class SQLiteConnection {
  constructor(db, driver) {
    this.db = db;
    this.driver = driver;
  }

  query(sql, params = []) {
    if (this.driver === 'better-sqlite3') {
      const stmt = this.db.prepare(sql);
      if (sql.trim().toUpperCase().startsWith('SELECT')) {
        return stmt.all(...params);
      }
      return stmt.run(...params);
    }
  }

  transaction(fn) {
    if (this.driver === 'better-sqlite3') {
      const txn = this.db.transaction(fn);
      return txn();
    }
  }

  close() {
    this.db.close();
  }
}

class JSONFileConnection {
  constructor(dbPath) {
    this.path = dbPath.endsWith('.json') ? dbPath : dbPath + '.json';
    this.data = {};
    if (fs.existsSync(this.path)) {
      try { this.data = JSON.parse(fs.readFileSync(this.path, 'utf8')); } catch (e) { this.data = {}; }
    }
  }

  query(sql, params = []) {
    const match = sql.match(/^SELECT\s+(.+?)\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER BY\s+(.+?))?(?:\s+LIMIT\s+(\d+))?(?:\s+OFFSET\s+(\d+))?$/i);
    if (match) {
      const [, columns, table, where, orderBy, limit, offset] = match;
      let rows = this.data[table] || [];
      if (where) {
        const whereMatch = where.match(/(\w+)\s*=\s*\?/);
        if (whereMatch && params.length > 0) {
          rows = rows.filter(r => r[whereMatch[1]] == params[0]);
        }
      }
      if (orderBy) {
        const [col, dir] = orderBy.trim().split(/\s+/);
        rows.sort((a, b) => dir === 'DESC' ? (b[col] > a[col] ? 1 : -1) : (a[col] > b[col] ? 1 : -1));
      }
      if (offset) rows = rows.slice(parseInt(offset));
      if (limit) rows = rows.slice(0, parseInt(limit));
      return rows;
    }

    const insertMatch = sql.match(/^INSERT\s+INTO\s+(\w+)\s*\((.+?)\)\s*VALUES\s*\((.+?)\)/i);
    if (insertMatch) {
      const [, table, cols, vals] = insertMatch;
      if (!this.data[table]) this.data[table] = [];
      const columns = cols.split(',').map(c => c.trim());
      const row = {};
      columns.forEach((col, i) => { row[col] = params[i]; });
      row.id = (this.data[table].length || 0) + 1;
      this.data[table].push(row);
      this._save();
      return { changes: 1, lastInsertRowid: row.id };
    }

    return [];
  }

  _save() {
    fs.writeFileSync(this.path, JSON.stringify(this.data, null, 2));
  }

  transaction(fn) {
    return fn(this);
  }

  close() {
    this._save();
  }
}

module.exports = { SQLiteAdapter };
