'use strict';

class PostgresAdapter {
  async connect(config) {
    let pg;
    try {
      pg = require('pg');
    } catch (e) {
      throw new Error(
        'PostgreSQL adapter requires the "pg" package. Install it with: npm install pg'
      );
    }

    const pool = new pg.Pool({
      host: config.host || 'localhost',
      port: config.port || 5432,
      database: config.database,
      user: config.user,
      password: config.password,
      max: config.poolSize || 10,
      ssl: config.ssl || false,
    });

    return new PostgresConnection(pool);
  }
}

class PostgresConnection {
  constructor(pool) {
    this.pool = pool;
  }

  async query(sql, params = []) {
    const result = await this.pool.query(sql, params);
    return result.rows;
  }

  async transaction(fn) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn({
        query: async (sql, params) => {
          const res = await client.query(sql, params);
          return res.rows;
        },
      });
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async close() {
    await this.pool.end();
  }
}

module.exports = { PostgresAdapter };
