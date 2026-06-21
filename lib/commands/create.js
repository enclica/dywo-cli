'use strict';

const fs = require('fs-extra');
const nativeFs = require('fs');
const path = require('path');
const inquirer = require('inquirer');
const chalk = require('chalk');
const { execSync } = require('child_process');

const TEMPLATES_DIR = path.join(__dirname, '../templates');

// pkg's snapshot filesystem does not patch async fs.dir ops (opendir/readdir),
// so fs-extra's copy() fails with ENOENT on bundled templates. This sync
// recursive copy uses only methods pkg patches (readdirSync/statSync/
// readFileSync/writeFileSync), reading from the snapshot and writing to disk.
function copyTemplate(src, dest, filter) {
  if (!nativeFs.existsSync(src)) return;
  nativeFs.mkdirSync(dest, { recursive: true });
  for (const entry of nativeFs.readdirSync(src)) {
    const srcPath = path.join(src, entry);
    if (filter && !filter(srcPath)) continue;
    const destPath = path.join(dest, entry);
    const stat = nativeFs.statSync(srcPath);
    if (stat.isDirectory()) {
      copyTemplate(srcPath, destPath, filter);
    } else if (stat.isFile()) {
      nativeFs.writeFileSync(destPath, nativeFs.readFileSync(srcPath));
    }
  }
}

async function create(projectName, options) {
  // Interactive prompts
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Project name:',
      default: projectName || 'my-dywo-app',
      when: !projectName,
      validate: v => /^[a-z0-9-_]+$/i.test(v) || 'Use only letters, numbers, hyphens, underscores'
    },
    {
      type: 'list',
      name: 'template',
      message: 'Template:',
      choices: [
        { name: 'SPA — Single-Page App with routing (recommended)', value: 'spa' },
        { name: 'Multi-Page — Separate HTML pages with shared components', value: 'multi-page' },
        { name: 'Portfolio — Single-page portfolio/landing site', value: 'portfolio' },
        { name: 'Vanilla — Plain HTML/CSS/JS, no .dywo components', value: 'vanilla' }
      ],
      default: options.template || 'spa',
      when: !options.template
    },
    {
      type: 'list',
      name: 'pkg',
      message: 'Package manager:',
      choices: ['npm', 'yarn', 'pnpm'],
      default: options.pkg || 'npm'
    }
  ]);

  const finalName = projectName || answers.name;
  const template = options.template || answers.template || 'spa';
  const pkg = answers.pkg || options.pkg || 'npm';

  const projectPath = path.resolve(process.cwd(), finalName);
  const templatePath = path.join(TEMPLATES_DIR, template);

  // Verify template exists
  if (!fs.existsSync(templatePath)) {
    console.error(chalk.red(`Template "${template}" not found at ${templatePath}`));
    process.exit(1);
  }

  // Verify target doesn't exist
  if (fs.existsSync(projectPath)) {
    console.error(chalk.red(`Directory "${finalName}" already exists`));
    process.exit(1);
  }

  console.log(chalk.blue(`\nCreating ${template} project: ${finalName}\n`));

  // Copy template
  copyTemplate(templatePath, projectPath, src => !src.includes('node_modules'));

  // Replace {{PROJECT_NAME}} in text files
  await replaceInFiles(projectPath, finalName);

  // Write package.json name field
  const pkgJsonPath = path.join(projectPath, 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    const pkgJson = await fs.readJson(pkgJsonPath);
    pkgJson.name = finalName.toLowerCase().replace(/\s+/g, '-');
    await fs.writeJson(pkgJsonPath, pkgJson, { spaces: 2 });
  }

  // Git init
  if (options.git !== false) {
    try {
      execSync('git init', { cwd: projectPath, stdio: 'ignore' });
      execSync('git add -A', { cwd: projectPath, stdio: 'ignore' });
      execSync('git commit -m "Initial DYWO project"', { cwd: projectPath, stdio: 'ignore' });
    } catch (e) {
      // Git not available or failed, skip silently
    }
  }

  // Install dependencies
  if (options.install !== false) {
    console.log(chalk.cyan('Installing dependencies...\n'));
    try {
      const installCmd = pkg === 'yarn' ? 'yarn' : pkg === 'pnpm' ? 'pnpm install' : 'npm install';
      execSync(installCmd, { cwd: projectPath, stdio: 'inherit' });
    } catch (e) {
      console.warn(chalk.yellow('\nDependency installation failed. Run manually:'));
      console.warn(chalk.cyan(`  cd ${finalName} && npm install`));
    }
  }

  // Success message
  console.log(chalk.green(`\n✓ Created ${finalName}!\n`));
  console.log(chalk.gray('Get started:'));
  console.log(chalk.cyan(`  cd ${finalName}`));
  if (options.install === false) console.log(chalk.cyan('  npm install'));
  console.log(chalk.cyan('  dywo dev'));
  console.log(chalk.gray('\nOther commands:'));
  console.log(chalk.cyan('  dywo build      ') + chalk.gray('— production build'));
  console.log(chalk.cyan('  dywo add page   ') + chalk.gray('— add a page'));
  console.log(chalk.cyan('  dywo migrate    ') + chalk.gray('— convert legacy site'));
  console.log('');
}

async function replaceInFiles(dir, projectName) {
  const textExts = ['.js', '.json', '.html', '.css', '.dywo', '.md', '.txt', '.gitignore'];

  const files = [];
  function walk(d) {
    for (const entry of fs.readdirSync(d)) {
      const fullPath = path.join(d, entry);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory() && entry !== 'node_modules') {
        walk(fullPath);
      } else if (stat.isFile()) {
        const ext = path.extname(entry).toLowerCase();
        if (textExts.includes(ext) || entry.startsWith('.git') || !path.extname(entry)) {
          files.push(fullPath);
        }
      }
    }
  }
  walk(dir);

  for (const file of files) {
    try {
      const content = fs.readFileSync(file, 'utf8');
      if (content.includes('{{PROJECT_NAME}}')) {
        fs.writeFileSync(file, content.replace(/\{\{PROJECT_NAME\}\}/g, projectName));
      }
    } catch (e) {
      // Binary file, skip
    }
  }
}

module.exports = create;
