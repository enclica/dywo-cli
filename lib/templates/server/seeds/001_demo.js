'use strict';

const crypto = require('crypto');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return { hash, salt };
}

module.exports = {
  name: 'demo_data',

  run(db) {
    const admin = hashPassword('admin123');
    const user = hashPassword('user123');

    const insertUser = db.prepare(
      'INSERT OR IGNORE INTO users (username, password_hash, salt, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    );

    const now = new Date().toISOString();

    insertUser.run('admin', admin.hash, admin.salt, 'admin', now, now);
    insertUser.run('demo', user.hash, user.salt, 'user', now, now);

    const insertItem = db.prepare(
      'INSERT INTO items (title, description, category, priority, status, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );

    const items = [
      ['Set up project', 'Initialize the DYWO server project with config and routes', 'setup', 'high', 'completed', 1, now, now],
      ['Configure database', 'Set up SQLite database with migrations', 'setup', 'high', 'completed', 1, now, now],
      ['Add authentication', 'Implement JWT-based auth middleware', 'feature', 'high', 'active', 1, now, now],
      ['Build REST API', 'Create CRUD endpoints for items', 'feature', 'medium', 'active', 1, now, now],
      ['Write tests', 'Add unit and integration tests', 'testing', 'medium', 'active', 2, now, now],
      ['Deploy to production', 'Set up Docker and CI/CD pipeline', 'devops', 'low', 'active', 2, now, now],
      ['Add rate limiting', 'Protect API from abuse', 'security', 'medium', 'active', 1, now, now],
      ['API documentation', 'Write OpenAPI/Swagger docs', 'docs', 'low', 'active', 2, now, now],
    ];

    const insertMany = db.transaction(() => {
      for (const item of items) {
        insertItem.run(...item);
      }
    });

    insertMany();

    console.log(`[seed] Inserted 2 users and ${items.length} items`);
  }
};
