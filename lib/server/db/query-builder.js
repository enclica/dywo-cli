'use strict';

class QueryBuilder {
  constructor(connection) {
    this.connection = connection;
    this._reset();
  }

  _reset() {
    this._type = 'select';
    this._columns = ['*'];
    this._table = null;
    this._wheres = [];
    this._joins = [];
    this._groupBy = [];
    this._having = [];
    this._orderBy = [];
    this._limit = null;
    this._offset = null;
    this._insertData = null;
    this._updateData = null;
    this._rawSql = null;
    this._rawParams = [];
    this._aggregates = [];
  }

  select(...columns) {
    this._reset();
    this._type = 'select';
    this._columns = columns.length === 0 ? ['*'] : columns.flat();
    return this;
  }

  from(table) {
    this._table = table;
    return this;
  }

  where(column, operator, value) {
    if (arguments.length === 2) {
      const op = operator.toUpperCase();
      if (op === 'IS NULL' || op === 'IS NOT NULL') {
        value = null;
      } else {
        value = operator;
        operator = '=';
      }
    }
    this._wheres.push({ column, operator, value, boolean: 'AND' });
    return this;
  }

  andWhere(column, operator, value) {
    if (arguments.length === 2) {
      const op = operator.toUpperCase();
      if (op === 'IS NULL' || op === 'IS NOT NULL') {
        value = null;
      } else {
        value = operator;
        operator = '=';
      }
    }
    this._wheres.push({ column, operator, value, boolean: 'AND' });
    return this;
  }

  orWhere(column, operator, value) {
    if (arguments.length === 2) {
      const op = operator.toUpperCase();
      if (op === 'IS NULL' || op === 'IS NOT NULL') {
        value = null;
      } else {
        value = operator;
        operator = '=';
      }
    }
    this._wheres.push({ column, operator, value, boolean: 'OR' });
    return this;
  }

  join(table, on, type = 'INNER') {
    this._joins.push({ table, on, type: type.toUpperCase() });
    return this;
  }

  leftJoin(table, on) {
    return this.join(table, on, 'LEFT');
  }

  rightJoin(table, on) {
    return this.join(table, on, 'RIGHT');
  }

  fullJoin(table, on) {
    return this.join(table, on, 'FULL');
  }

  groupBy(...columns) {
    this._groupBy.push(...columns.flat());
    return this;
  }

  having(column, operator, value) {
    this._having.push({ column, operator, value });
    return this;
  }

  orderBy(column, direction = 'ASC') {
    this._orderBy.push({ column, direction: direction.toUpperCase() });
    return this;
  }

  limit(n) {
    this._limit = n;
    return this;
  }

  offset(n) {
    this._offset = n;
    return this;
  }

  insert(table, data) {
    this._reset();
    this._type = 'insert';
    this._table = table;
    this._insertData = Array.isArray(data) ? data : [data];
    return this;
  }

  update(table, data) {
    this._reset();
    this._type = 'update';
    this._table = table;
    this._updateData = data;
    return this;
  }

  delete(table) {
    this._reset();
    this._type = 'delete';
    this._table = table;
    return this;
  }

  count(column = '*') {
    this._aggregates.push({ fn: 'COUNT', column });
    return this;
  }

  sum(column) {
    this._aggregates.push({ fn: 'SUM', column });
    return this;
  }

  avg(column) {
    this._aggregates.push({ fn: 'AVG', column });
    return this;
  }

  min(column) {
    this._aggregates.push({ fn: 'MIN', column });
    return this;
  }

  max(column) {
    this._aggregates.push({ fn: 'MAX', column });
    return this;
  }

  raw(sql, params = []) {
    this._reset();
    this._type = 'raw';
    this._rawSql = sql;
    this._rawParams = params;
    return this;
  }

  async transaction(fn) {
    if (!this.connection) throw new Error('No database connection');
    return this.connection.transaction(fn);
  }

  _buildWhere() {
    if (this._wheres.length === 0) return { sql: '', params: [] };
    const parts = [];
    const params = [];

    for (let i = 0; i < this._wheres.length; i++) {
      const w = this._wheres[i];
      const op = w.operator.toUpperCase();
      let clause = `${w.column} ${op}`;

      if (op === 'IS NULL' || op === 'IS NOT NULL') {
        // no placeholder
      } else if (op === 'IN' || op === 'NOT IN') {
        const values = Array.isArray(w.value) ? w.value : [w.value];
        const placeholders = values.map(() => '?').join(', ');
        clause += ` (${placeholders})`;
        params.push(...values);
      } else if (op === 'BETWEEN') {
        clause += ' ? AND ?';
        params.push(w.value[0], w.value[1]);
      } else {
        clause += ' ?';
        params.push(w.value);
      }

      if (i === 0) {
        parts.push(clause);
      } else {
        parts.push(`${w.boolean} ${clause}`);
      }
    }

    return { sql: ' WHERE ' + parts.join(' '), params };
  }

  toSQL() {
    if (this._type === 'raw') {
      return { sql: this._rawSql, params: this._rawParams };
    }

    if (this._type === 'insert') {
      return this._buildInsert();
    }

    if (this._type === 'update') {
      return this._buildUpdate();
    }

    if (this._type === 'delete') {
      return this._buildDelete();
    }

    return this._buildSelect();
  }

  _buildSelect() {
    const params = [];
    let cols;

    if (this._aggregates.length > 0) {
      const aggParts = this._aggregates.map(a => `${a.fn}(${a.column})`);
      const otherCols = this._columns.filter(c => c !== '*');
      cols = [...aggParts, ...otherCols].join(', ');
    } else {
      cols = this._columns.join(', ');
    }

    let sql = `SELECT ${cols} FROM ${this._table}`;

    for (const j of this._joins) {
      sql += ` ${j.type} JOIN ${j.table} ON ${j.on}`;
    }

    const where = this._buildWhere();
    sql += where.sql;
    params.push(...where.params);

    if (this._groupBy.length > 0) {
      sql += ` GROUP BY ${this._groupBy.join(', ')}`;
    }

    if (this._having.length > 0) {
      const havingParts = this._having.map(h => `${h.column} ${h.operator} ?`);
      sql += ` HAVING ${havingParts.join(' AND ')}`;
      params.push(...this._having.map(h => h.value));
    }

    if (this._orderBy.length > 0) {
      const orderParts = this._orderBy.map(o => `${o.column} ${o.direction}`);
      sql += ` ORDER BY ${orderParts.join(', ')}`;
    }

    if (this._limit !== null) {
      sql += ` LIMIT ${this._limit}`;
    }

    if (this._offset !== null) {
      sql += ` OFFSET ${this._offset}`;
    }

    return { sql, params };
  }

  _buildInsert() {
    const row = this._insertData[0];
    const columns = Object.keys(row);
    const placeholders = columns.map(() => '?').join(', ');
    const params = columns.map(k => row[k]);
    const sql = `INSERT INTO ${this._table} (${columns.join(', ')}) VALUES (${placeholders})`;
    return { sql, params };
  }

  _buildUpdate() {
    const columns = Object.keys(this._updateData);
    const setClause = columns.map(c => `${c} = ?`).join(', ');
    const params = columns.map(k => this._updateData[k]);
    const where = this._buildWhere();
    const sql = `UPDATE ${this._table} SET ${setClause}${where.sql}`;
    return { sql, params: [...params, ...where.params] };
  }

  _buildDelete() {
    const where = this._buildWhere();
    const sql = `DELETE FROM ${this._table}${where.sql}`;
    return { sql, params: where.params };
  }

  async execute() {
    if (!this.connection) throw new Error('No database connection');
    const { sql, params } = this.toSQL();
    const result = this.connection.query(sql, params);
    this._reset();
    return result;
  }
}

module.exports = { QueryBuilder };
