'use strict';

const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');

async function serverDb(projectRoot, options) {
  const args = options._ || [];
  const action = args[1] || options.action;

  if (!action) {
    console.log(chalk.blue('\nDYWO Server — Database Commands:\n'));
    console.log(chalk.cyan('  dywo server db migrate') + chalk.gray('  — Run pending migrations'));
    console.log(chalk.cyan('  dywo server db seed') + chalk.gray('     — Run seed files'));
    console.log(chalk.cyan('  dywo server db reset') + chalk.gray('    — Drop and recreate database'));
    console.log(chalk.cyan('  dywo server db status') + chalk.gray('   — Show migration status'));
    console.log(chalk.cyan('  dywo server db create') + chalk.gray('   — Create a new migration file'));
    console.log('');
    return;
  }

  const config = loadServerConfig(projectRoot);
  const migrationsDir = path.resolve(projectRoot, config.migrationsDir || 'server/migrations');
  const seedsDir = path.resolve(projectRoot, config.seedsDir || 'server/seeds');

  switch (action) {
    case 'migrate': return runMigrations(projectRoot, migrationsDir, config);
    case 'seed': return runSeeds(projectRoot, seedsDir, config);
    case 'reset': return resetDatabase(projectRoot, migrationsDir, seedsDir, config);
    case 'status': return showStatus(projectRoot, migrationsDir, config);
    case 'create': return createMigration(projectRoot, migrationsDir, options);
    default:
      console.error(chalk.red(`Unknown db action: ${action}`));
      console.error(chalk.gray('Valid actions: migrate, seed, reset, status, create'));
      process.exit(1);
  }
}

async function runMigrations(projectRoot, migrationsDir, config) {
  console.log(chalk.blue('\nDYWO Server — Running Migrations\n'));

  if (!fs.existsSync(migrationsDir)) {
    await fs.ensureDir(migrationsDir);
    console.log(chalk.yellow('No migrations directory found. Created: ' + path.relative(projectRoot, migrationsDir)));
    return;
  }

  const files = (await fs.readdir(migrationsDir))
    .filter(f => f.endsWith('.js'))
    .sort();

  if (files.length === 0) {
    console.log(chalk.yellow('No migration files found'));
    return;
  }

  const stateFile = path.join(migrationsDir, '.migration-state.json');
  let applied = [];
  if (fs.existsSync(stateFile)) {
    applied = (await fs.readJson(stateFile)).applied || [];
  }

  const pending = files.filter(f => !applied.includes(f));

  if (pending.length === 0) {
    console.log(chalk.green('All migrations are up to date'));
    return;
  }

  console.log(chalk.gray(`Found ${pending.length} pending migration(s)\n`));

  for (const file of pending) {
    const filePath = path.join(migrationsDir, file);
    console.log(chalk.cyan(`  Running: ${file}`));

    try {
      delete require.cache[require.resolve(filePath)];
      const migration = require(filePath);

      if (typeof migration.up === 'function') {
        await migration.up();
      } else if (typeof migration === 'function') {
        await migration();
      }

      applied.push(file);
      console.log(chalk.green(`  ✓ ${file}`));
    } catch (err) {
      console.error(chalk.red(`  ✗ ${file}: ${err.message}`));
      await fs.writeJson(stateFile, { applied }, { spaces: 2 });
      process.exit(1);
    }
  }

  await fs.writeJson(stateFile, { applied }, { spaces: 2 });
  console.log(chalk.green(`\n${pending.length} migration(s) applied successfully\n`));
}

async function runSeeds(projectRoot, seedsDir, config) {
  console.log(chalk.blue('\nDYWO Server — Running Seeds\n'));

  if (!fs.existsSync(seedsDir)) {
    await fs.ensureDir(seedsDir);
    console.log(chalk.yellow('No seeds directory found. Created: ' + path.relative(projectRoot, seedsDir)));
    return;
  }

  const files = (await fs.readdir(seedsDir))
    .filter(f => f.endsWith('.js'))
    .sort();

  if (files.length === 0) {
    console.log(chalk.yellow('No seed files found'));
    return;
  }

  console.log(chalk.gray(`Found ${files.length} seed file(s)\n`));

  for (const file of files) {
    const filePath = path.join(seedsDir, file);
    console.log(chalk.cyan(`  Seeding: ${file}`));

    try {
      delete require.cache[require.resolve(filePath)];
      const seed = require(filePath);

      if (typeof seed.run === 'function') {
        await seed.run();
      } else if (typeof seed === 'function') {
        await seed();
      }

      console.log(chalk.green(`  ✓ ${file}`));
    } catch (err) {
      console.error(chalk.red(`  ✗ ${file}: ${err.message}`));
      process.exit(1);
    }
  }

  console.log(chalk.green(`\n${files.length} seed file(s) executed successfully\n`));
}

async function resetDatabase(projectRoot, migrationsDir, seedsDir, config) {
  console.log(chalk.blue('\nDYWO Server — Database Reset\n'));
  console.log(chalk.yellow('This will drop and recreate all data.'));

  const stateFile = path.join(migrationsDir, '.migration-state.json');
  if (fs.existsSync(stateFile)) {
    await fs.remove(stateFile);
    console.log(chalk.gray('  Cleared migration state'));
  }

  if (fs.existsSync(migrationsDir)) {
    await runMigrations(projectRoot, migrationsDir, config);
  }

  if (fs.existsSync(seedsDir)) {
    await runSeeds(projectRoot, seedsDir, config);
  }

  console.log(chalk.green('Database reset complete\n'));
}

async function showStatus(projectRoot, migrationsDir, config) {
  console.log(chalk.blue('\nDYWO Server — Migration Status\n'));

  if (!fs.existsSync(migrationsDir)) {
    console.log(chalk.yellow('No migrations directory found'));
    return;
  }

  const files = (await fs.readdir(migrationsDir))
    .filter(f => f.endsWith('.js'))
    .sort();

  if (files.length === 0) {
    console.log(chalk.yellow('No migration files found'));
    return;
  }

  const stateFile = path.join(migrationsDir, '.migration-state.json');
  let applied = [];
  if (fs.existsSync(stateFile)) {
    applied = (await fs.readJson(stateFile)).applied || [];
  }

  console.log(chalk.gray('  Migration                          Status'));
  console.log(chalk.gray('  ─────────────────────────────────  ────────'));

  for (const file of files) {
    const isApplied = applied.includes(file);
    const status = isApplied ? chalk.green('applied') : chalk.yellow('pending');
    const padded = file.padEnd(34);
    console.log(`  ${padded} ${status}`);
  }

  const pendingCount = files.length - applied.length;
  console.log('');
  console.log(chalk.gray(`  Total: ${files.length} | Applied: ${applied.length} | Pending: ${pendingCount}`));
  console.log('');
}

async function createMigration(projectRoot, migrationsDir, options) {
  const args = options._ || [];
  const name = args[2] || options.name;

  if (!name) {
    console.error(chalk.red('Missing migration name'));
    console.error(chalk.gray('Usage: dywo server db create <name>'));
    process.exit(1);
  }

  await fs.ensureDir(migrationsDir);

  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const fileName = `${timestamp}_${name.toLowerCase().replace(/\s+/g, '_')}.js`;
  const filePath = path.join(migrationsDir, fileName);

  const content = `'use strict';

async function up() {
  // Run migration forward
}

async function down() {
  // Rollback migration
}

module.exports = { up, down };
`;

  await fs.writeFile(filePath, content);
  console.log(chalk.green(`\nCreated migration: ${path.relative(projectRoot, filePath)}\n`));
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

module.exports = serverDb;
