'use strict';

const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');

async function serverApi(projectRoot, options) {
  const args = options._ || [];
  const name = args[1] || options.name;

  if (!name) {
    console.error(chalk.red('Missing API name'));
    console.error(chalk.gray('Usage: dywo server api <name> [--methods get,post,put,delete]'));
    console.error(chalk.gray('Example: dywo server api users'));
    process.exit(1);
  }

  const config = loadServerConfig(projectRoot);
  const routesDir = path.resolve(projectRoot, config.routesDir || 'server/routes');
  const methodsOpt = options.methods || 'get,post,put,delete';
  const methods = methodsOpt.split(',').map(m => m.trim().toLowerCase());
  const validMethods = ['get', 'post', 'put', 'delete', 'patch'];

  for (const m of methods) {
    if (!validMethods.includes(m)) {
      console.error(chalk.red(`Invalid method: ${m}`));
      console.error(chalk.gray(`Valid methods: ${validMethods.join(', ')}`));
      process.exit(1);
    }
  }

  await fs.ensureDir(routesDir);

  const fileName = `${name.toLowerCase()}.js`;
  const filePath = path.join(routesDir, fileName);

  if (fs.existsSync(filePath)) {
    console.error(chalk.red(`Route file already exists: ${path.relative(projectRoot, filePath)}`));
    process.exit(1);
  }

  const content = generateRouteFile(name, methods);
  await fs.writeFile(filePath, content);

  console.log(chalk.green(`\nCreated API route: ${path.relative(projectRoot, filePath)}`));
  console.log(chalk.gray('\nMethods: ') + methods.map(m => m.toUpperCase()).join(', '));
  console.log(chalk.gray('\nRegister in your server entry:'));
  console.log(chalk.cyan(`  const ${name}Routes = require('./routes/${name.toLowerCase()}');`));
  console.log(chalk.cyan(`  app.use('/api/${name.toLowerCase()}', ${name}Routes);`));
  console.log('');

  await ensureMiddleware(projectRoot, config);
}

async function ensureMiddleware(projectRoot, config) {
  const middlewareDir = path.resolve(projectRoot, config.middlewareDir || 'server/middleware');
  await fs.ensureDir(middlewareDir);

  const validatePath = path.join(middlewareDir, 'validate.js');
  if (!fs.existsSync(validatePath)) {
    await fs.writeFile(validatePath, generateValidateMiddleware());
    console.log(chalk.green(`Created middleware: ${path.relative(projectRoot, validatePath)}`));
  }

  const errorHandlerPath = path.join(middlewareDir, 'errorHandler.js');
  if (!fs.existsSync(errorHandlerPath)) {
    await fs.writeFile(errorHandlerPath, generateErrorHandler());
    console.log(chalk.green(`Created middleware: ${path.relative(projectRoot, errorHandlerPath)}`));
  }
}

function generateRouteFile(name, methods) {
  const modelName = name.charAt(0).toUpperCase() + name.slice(1);
  const varName = name.toLowerCase();
  const routeVar = `${varName}Router`;

  const lines = [];
  lines.push(`'use strict';`);
  lines.push('');
  lines.push(`const express = require('express');`);
  lines.push(`const ${routeVar} = express.Router();`);
  lines.push(`const { validate } = require('../middleware/validate');`);
  lines.push('');

  if (methods.includes('get')) {
    lines.push(`${routeVar}.get('/', async (req, res, next) => {`);
    lines.push(`  try {`);
    lines.push(`    const items = await req.db.query('SELECT * FROM ${varName}');`);
    lines.push(`    res.json({ data: items });`);
    lines.push(`  } catch (err) {`);
    lines.push(`    next(err);`);
    lines.push(`  }`);
    lines.push(`});`);
    lines.push('');
    lines.push(`${routeVar}.get('/:id', async (req, res, next) => {`);
    lines.push(`  try {`);
    lines.push(`    const item = await req.db.query('SELECT * FROM ${varName} WHERE id = ?', [req.params.id]);`);
    lines.push(`    if (!item) return res.status(404).json({ error: '${modelName} not found' });`);
    lines.push(`    res.json({ data: item });`);
    lines.push(`  } catch (err) {`);
    lines.push(`    next(err);`);
    lines.push(`  }`);
    lines.push(`});`);
    lines.push('');
  }

  if (methods.includes('post')) {
    lines.push(`${routeVar}.post('/', validate('${varName}'), async (req, res, next) => {`);
    lines.push(`  try {`);
    lines.push(`    const result = await req.db.query('INSERT INTO ${varName} SET ?', [req.body]);`);
    lines.push(`    res.status(201).json({ data: { id: result.insertId, ...req.body } });`);
    lines.push(`  } catch (err) {`);
    lines.push(`    next(err);`);
    lines.push(`  }`);
    lines.push(`});`);
    lines.push('');
  }

  if (methods.includes('put')) {
    lines.push(`${routeVar}.put('/:id', validate('${varName}'), async (req, res, next) => {`);
    lines.push(`  try {`);
    lines.push(`    await req.db.query('UPDATE ${varName} SET ? WHERE id = ?', [req.body, req.params.id]);`);
    lines.push(`    res.json({ data: { id: req.params.id, ...req.body } });`);
    lines.push(`  } catch (err) {`);
    lines.push(`    next(err);`);
    lines.push(`  }`);
    lines.push(`});`);
    lines.push('');
  }

  if (methods.includes('patch')) {
    lines.push(`${routeVar}.patch('/:id', async (req, res, next) => {`);
    lines.push(`  try {`);
    lines.push(`    const fields = Object.keys(req.body).map(k => k + ' = ?').join(', ');`);
    lines.push(`    const values = [...Object.values(req.body), req.params.id];`);
    lines.push(`    await req.db.query('UPDATE ${varName} SET ' + fields + ' WHERE id = ?', values);`);
    lines.push(`    res.json({ data: { id: req.params.id, ...req.body } });`);
    lines.push(`  } catch (err) {`);
    lines.push(`    next(err);`);
    lines.push(`  }`);
    lines.push(`});`);
    lines.push('');
  }

  if (methods.includes('delete')) {
    lines.push(`${routeVar}.delete('/:id', async (req, res, next) => {`);
    lines.push(`  try {`);
    lines.push(`    await req.db.query('DELETE FROM ${varName} WHERE id = ?', [req.params.id]);`);
    lines.push(`    res.json({ message: '${modelName} deleted' });`);
    lines.push(`  } catch (err) {`);
    lines.push(`    next(err);`);
    lines.push(`  }`);
    lines.push(`});`);
    lines.push('');
  }

  lines.push(`module.exports = ${routeVar};`);
  lines.push('');

  return lines.join('\n');
}

function generateValidateMiddleware() {
  return `'use strict';

function validate(schema) {
  return (req, res, next) => {
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({ error: 'Request body is required' });
    }
    next();
  };
}

module.exports = { validate };
`;
}

function generateErrorHandler() {
  return `'use strict';

function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';

  if (process.env.NODE_ENV !== 'production') {
    console.error(err.stack);
  }

  res.status(status).json({
    error: message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
}

module.exports = { errorHandler };
`;
}

function loadServerConfig(projectRoot) {
  const configLoader = require('../config/config-loader');
  let config = {};

  try {
    const dywoConfig = configLoader.load(projectRoot);
    config = dywoConfig.server || {};
  } catch (e) {
    // no dywo.config.js
  }

  const serverConfigPath = path.join(projectRoot, 'dywo.server.js');
  if (fs.existsSync(serverConfigPath)) {
    try {
      delete require.cache[require.resolve(serverConfigPath)];
      const serverConf = require(serverConfigPath);
      config = Object.assign(config, serverConf);
    } catch (e) {
      // ignore
    }
  }

  return config;
}

module.exports = serverApi;
