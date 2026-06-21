'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const distDir = path.join(root, 'dist');
fs.mkdirSync(distDir, { recursive: true });

const targets = [
  { id: 'node18-linux-x64', out: 'dywo-linux', label: 'Linux' },
  { id: 'node18-macos-x64', out: 'dywo-macos', label: 'macOS' },
  { id: 'node18-win-x64', out: 'dywo.exe', label: 'Windows' }
];

function runPrepare() {
  try {
    execSync('npm run prebuild', { cwd: root, stdio: 'inherit' });
  } catch (e) {
    console.warn('prebuild step failed, continuing anyway...');
  }
}

function buildOne(target) {
  const outPath = path.join(distDir, target.out);
  console.log(`\n Building for ${target.label} (${target.id}) -> ${target.out} ...`);
  try {
    execSync(`npx pkg . -t ${target.id} -o "${outPath}"`, {
      cwd: root,
      stdio: 'inherit'
    });
    if (!fs.existsSync(outPath)) {
      throw new Error('output file not produced');
    }
    if (process.platform !== 'win32' && target.out !== 'dywo.exe') {
      try { fs.chmodSync(outPath, 0o755); } catch (_) {}
    }
    console.log(`  ✓ ${target.label} build succeeded`);
    return true;
  } catch (e) {
    console.warn(`  ⚠ Skipped ${target.label}: build failed (${e.message.split('\n')[0]})`);
    if (fs.existsSync(outPath)) {
      try { fs.unlinkSync(outPath); } catch (_) {}
    }
    return false;
  }
}

function addWindowsIcon() {
  const exePath = path.join(distDir, 'dywo.exe');
  const iconPath = path.join(root, 'assets', 'dywo-icon.ico');
  if (!fs.existsSync(exePath) || !fs.existsSync(iconPath)) return;
  console.log('\n Adding icon/metadata to dywo.exe ...');
  try {
    execSync(`node scripts/add-icon.js`, { cwd: root, stdio: 'inherit' });
  } catch (e) {
    console.warn('  ⚠ Skipped icon step (rcedit/wine unavailable)');
  }
}

function main() {
  console.log('Dywo multi-platform build');
  console.log('=========================');
  runPrepare();

  let built = 0;
  const builtLabels = [];
  let skipped = 0;
  const skippedLabels = [];

  for (const target of targets) {
    if (buildOne(target)) {
      built++;
      builtLabels.push(target.label);
    } else {
      skipped++;
      skippedLabels.push(target.label);
    }
  }

  if (builtLabels.includes('Windows')) {
    addWindowsIcon();
  }

  console.log('\n=========================');
  console.log(` Built   : ${builtLabels.join(', ') || 'none'}`);
  if (skipped > 0) {
    console.log(` Skipped : ${skippedLabels.join(', ')}`);
  }
  console.log(` Output  : ${path.relative(root, distDir)}/`);
  console.log('');

  if (built === 0) {
    console.error('No targets built successfully.');
    process.exit(1);
  }
}

main();
