async function optimize(options) {
  const chalk = require('chalk');
  const configLoader = require('../config/config-loader');
  const Optimizer = require('../compiler/optimizer');
  const path = require('path');

  const projectRoot = process.cwd();
  const config = configLoader.load(projectRoot);
  const distDir = config._resolvedOutput;

  const fs = require('fs-extra');
  if (!fs.existsSync(distDir)) {
    console.error(chalk.red('No dist/ directory found. Run `dywo build` first.'));
    process.exit(1);
  }

  console.log(chalk.blue('\nOptimizing build output...\n'));

  await Optimizer.compressDir(distDir, {
    gzip: options.gzip || false,
    brotli: options.brotli || false
  });

  console.log(chalk.green('Optimization complete.\n'));
}

module.exports = optimize;
