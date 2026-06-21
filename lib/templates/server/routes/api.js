'use strict';

module.exports = function registerApiRoutes(app) {
  const db = app.db;

  app.group('/api/items', (group) => {

    // GET /api/items — list with filtering, sorting, pagination
    group.get('', (req, res) => {
      const {
        page = 1,
        limit = 20,
        sort = 'created_at',
        order = 'desc',
        status,
        category
      } = req.query;

      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
      const conditions = [];
      const params = [];

      if (status) {
        conditions.push('status = ?');
        params.push(status);
      }
      if (category) {
        conditions.push('category = ?');
        params.push(category);
      }

      const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
      const allowedSorts = ['created_at', 'updated_at', 'title', 'priority'];
      const sortCol = allowedSorts.includes(sort) ? sort : 'created_at';
      const sortOrder = order === 'asc' ? 'ASC' : 'DESC';

      const total = db.prepare(`SELECT COUNT(*) as count FROM items ${where}`).get(...params).count;
      const items = db.prepare(
        `SELECT * FROM items ${where} ORDER BY ${sortCol} ${sortOrder} LIMIT ? OFFSET ?`
      ).all(...params, parseInt(limit), offset);

      res.json({
        data: items,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      });
    });

    // GET /api/items/search?q=query — search/filter
    group.get('/search', (req, res) => {
      const { q, page = 1, limit = 20 } = req.query;

      if (!q || q.trim().length === 0) {
        return res.status(400).json({ error: 'Search query parameter "q" is required' });
      }

      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
      const searchTerm = `%${q}%`;

      const total = db.prepare(
        'SELECT COUNT(*) as count FROM items WHERE title LIKE ? OR description LIKE ?'
      ).get(searchTerm, searchTerm).count;

      const items = db.prepare(
        'SELECT * FROM items WHERE title LIKE ? OR description LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
      ).all(searchTerm, searchTerm, parseInt(limit), offset);

      res.json({
        data: items,
        query: q,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      });
    });

    // GET /api/items/:id — get single item
    group.get('/:id', (req, res) => {
      const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
      if (!item) {
        return res.status(404).json({ error: 'Item not found' });
      }
      res.json({ data: item });
    });

    // POST /api/items — create item
    group.post('', app.authMiddleware, (req, res) => {
      const { title, description, category, priority, status } = req.body;

      if (!title || title.trim().length === 0) {
        return res.status(400).json({ error: 'Title is required' });
      }

      const now = new Date().toISOString();
      const result = db.prepare(
        `INSERT INTO items (title, description, category, priority, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        title.trim(),
        description || null,
        category || null,
        priority || 'medium',
        status || 'active',
        now,
        now
      );

      const item = db.prepare('SELECT * FROM items WHERE id = ?').get(result.lastInsertRowid);
      res.status(201).json({ data: item });
    });

    // PUT /api/items/:id — update item
    group.put('/:id', app.authMiddleware, (req, res) => {
      const existing = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
      if (!existing) {
        return res.status(404).json({ error: 'Item not found' });
      }

      const { title, description, category, priority, status } = req.body;
      const now = new Date().toISOString();

      db.prepare(
        `UPDATE items SET
           title = ?, description = ?, category = ?, priority = ?, status = ?, updated_at = ?
         WHERE id = ?`
      ).run(
        title !== undefined ? title : existing.title,
        description !== undefined ? description : existing.description,
        category !== undefined ? category : existing.category,
        priority !== undefined ? priority : existing.priority,
        status !== undefined ? status : existing.status,
        now,
        req.params.id
      );

      const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
      res.json({ data: item });
    });

    // DELETE /api/items/:id — delete item
    group.delete('/:id', app.authMiddleware, (req, res) => {
      const existing = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
      if (!existing) {
        return res.status(404).json({ error: 'Item not found' });
      }

      db.prepare('DELETE FROM items WHERE id = ?').run(req.params.id);
      res.json({ message: 'Item deleted', id: parseInt(req.params.id) });
    });
  });
};
