module.exports = {
  // Server settings
  port: process.env.PORT || 3000,
  host: process.env.HOST || '0.0.0.0',
  
  // Database
  database: {
    adapter: 'sqlite',  // sqlite, postgres, mysql, mongo
    path: './data/app.db',
    // For PostgreSQL/MySQL:
    // host: 'localhost',
    // port: 5432,
    // database: 'myapp',
    // username: 'user',
    // password: 'pass'
  },

  // Middleware
  middleware: {
    cors: { origin: '*' },
    rateLimit: { windowMs: 60000, max: 100 },
    auth: { type: 'jwt', secret: process.env.JWT_SECRET || 'change-me' },
    logger: true,
    compression: true,
    security: true
  },

  // Build target
  build: {
    target: 'single',  // single, docker, shell, pm2, systemd
    output: './server-dist'
  }
};
