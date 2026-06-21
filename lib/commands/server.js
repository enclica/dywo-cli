'use strict';

const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');

async function server(options) {
  const projectRoot = process.cwd();
  const subcommand = options._ ? options._[0] : (options.subcommand || 'start');

  switch (subcommand) {
    case 'start': return require('./server-start')(projectRoot, options);
    case 'build': return require('./server-build')(projectRoot, options);
    case 'api': return require('./server-api')(projectRoot, options);
    case 'db': return require('./server-db')(projectRoot, options);
    default:
      console.log(chalk.blue('\nDYWO Server Commands:\n'));
      console.log(chalk.cyan('  dywo server start') + chalk.gray('     — Start the development server'));
      console.log(chalk.cyan('  dywo server build') + chalk.gray('     — Build for production'));
      console.log(chalk.cyan('  dywo server api <name>') + chalk.gray('  — Generate API routes'));
      console.log(chalk.cyan('  dywo server db <action>') + chalk.gray(' — Database management'));
      console.log('');
  }
}

module.exports = server;
