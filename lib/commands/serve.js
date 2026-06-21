async function serve(options) {
  const express = require('express');
  const path = require('path');
  const fs = require('fs-extra');
  const chalk = require('chalk');
  const configLoader = require('../config/config-loader');

  const projectRoot = process.cwd();
  const config = configLoader.load(projectRoot);
  const distDir = config._resolvedOutput;

  if (!fs.existsSync(distDir)) {
    console.error(chalk.red('No build output found. Run `dywo build` first.'));
    process.exit(1);
  }

  const app = express();
  const port = options.port || config.devServer.port || 3000;

  // Serve with gzip/brotli support
  app.use((req, res, next) => {
    // Try brotli first, then gzip
    const acceptEncoding = req.headers['accept-encoding'] || '';
    if (acceptEncoding.includes('br')) {
      const brPath = path.join(distDir, req.path + '.br');
      if (fs.existsSync(brPath)) {
        res.set('Content-Encoding', 'br');
        // set content-type based on original extension
        const ext = path.extname(req.path);
        if (ext === '.js') res.set('Content-Type', 'application/javascript');
        if (ext === '.css') res.set('Content-Type', 'text/css');
        return res.sendFile(brPath);
      }
    }
    if (acceptEncoding.includes('gzip')) {
      const gzPath = path.join(distDir, req.path + '.gz');
      if (fs.existsSync(gzPath)) {
        res.set('Content-Encoding', 'gzip');
        const ext = path.extname(req.path);
        if (ext === '.js') res.set('Content-Type', 'application/javascript');
        if (ext === '.css') res.set('Content-Type', 'text/css');
        return res.sendFile(gzPath);
      }
    }
    next();
  });

  // Static files
  app.use(express.static(distDir));

  // SPA fallback
  app.get('*', (req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });

  app.listen(port, () => {
    console.log(chalk.green(`\nServing ${path.relative(process.cwd(), distDir)}/ at http://localhost:${port}\n`));
  });
}

module.exports = serve;
