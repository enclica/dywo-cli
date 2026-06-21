'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const distDir = path.join(root, 'dist');

function pickBinary() {
  const platform = os.platform();
  const arch = os.arch();
  if (platform === 'linux' && arch === 'x64') return 'dywo-linux';
  if (platform === 'darwin' && arch === 'x64') return 'dywo-macos';
  if (platform === 'win32' && arch === 'x64') return 'dywo.exe';
  if (platform === 'darwin' && arch === 'arm64') return 'dywo-macos';
  console.error(`Unsupported platform/arch: ${platform}/${arch}`);
  console.error('Only linux-x64, macos-x64/arm64, win-x64 are provided.');
  process.exit(1);
}

function isDirInPath(dir) {
  const PATH = (process.env.PATH || '').split(path.delimiter);
  return PATH.some(p => path.resolve(p) === path.resolve(dir));
}

function ensureExecutable(dest) {
  if (os.platform() === 'win32') return;
  try { fs.chmodSync(dest, 0o755); } catch (_) {}
}

function installTo(destDir, binaryName, src) {
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, binaryName);
  fs.copyFileSync(src, dest);
  ensureExecutable(dest);
  return dest;
}

function main() {
  const bin = pickBinary();
  const src = path.join(distDir, bin);
  if (!fs.existsSync(src)) {
    console.error(`Binary not found: ${src}`);
    console.error('Run `npm run build` (or `npm run build:all`) first.');
    process.exit(1);
  }

  const isWindows = os.platform() === 'win32';
  const installedName = isWindows ? 'dywo.exe' : 'dywo';

  // Candidate install dirs, in priority order.
  const candidates = [
    '/usr/local/bin',
    path.join(os.homedir(), '.local', 'bin')
  ];
  if (isWindows) {
    candidates.unshift(path.join(os.homedir(), 'bin'));
  }

  let installed = null;
  const errors = [];

  for (const dir of candidates) {
    try {
      installed = installTo(dir, installedName, src);
      console.log(`\nInstalled dywo to: ${installed}`);
      break;
    } catch (e) {
      errors.push(`${dir}: ${e.message.split('\n')[0]}`);
    }
  }

  if (!installed) {
    console.error('\nCould not install automatically. Tried:');
    errors.forEach(e => console.error(`  - ${e}`));
    console.error('\nInstall manually by copying the binary to a directory in your PATH:');
    console.error(`  cp "${src}" /usr/local/bin/dywo   (may need sudo)`);
    if (!isWindows) console.error(`  chmod +x /usr/local/bin/dywo`);
    process.exit(1);
  }

  const installDir = path.dirname(installed);
  if (!isDirInPath(installDir)) {
    console.log(`\nNOTE: ${installDir} is not in your PATH.`);
    if (!isWindows) {
      console.log('Add this line to your shell profile (~/.bashrc, ~/.zshrc, ...):');
      console.log(`  export PATH="${installDir}:$PATH"`);
    }
  }

  // Verify
  try {
    const ver = execSync(`"${installed}" --version`, { encoding: 'utf8' }).trim();
    console.log(`Verified: dywo ${ver}`);
  } catch (_) {
    // Non-fatal
  }

  console.log('\nDone. Run `dywo --help` to get started.\n');
}

main();
