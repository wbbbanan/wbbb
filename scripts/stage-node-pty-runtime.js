const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const sourceRoot = path.join(projectRoot, 'node_modules', 'node-pty');
const sourceLibDir = path.join(sourceRoot, 'lib');
const sourceReleaseDir = path.join(sourceRoot, 'build', 'Release');
const targetRoot = path.join(projectRoot, 'build-resources', 'node-pty-runtime');
const targetLibDir = path.join(targetRoot, 'lib');
const targetReleaseDir = path.join(targetRoot, 'build', 'Release');
const runtimeFiles = ['conpty.node', 'conpty_console_list.node', 'pty.node', 'winpty-agent.exe', 'winpty.dll'];

const shouldStageRuntimeLibEntry = (sourcePath) => {
  const relativePath = path.relative(sourceLibDir, sourcePath);

  if (!relativePath) {
    return true;
  }

  const stats = fs.statSync(sourcePath);

  if (stats.isDirectory()) {
    return true;
  }

  return relativePath.endsWith('.js') && !relativePath.endsWith('.test.js');
};

if (!fs.existsSync(sourceLibDir) || !fs.existsSync(sourceReleaseDir)) {
  throw new Error('node-pty runtime files are missing. Reinstall dependencies before packaging.');
}

fs.rmSync(targetRoot, { recursive: true, force: true });
fs.mkdirSync(targetLibDir, { recursive: true });
fs.mkdirSync(targetReleaseDir, { recursive: true });
fs.cpSync(sourceLibDir, targetLibDir, { recursive: true, filter: shouldStageRuntimeLibEntry });

for (const runtimeFile of runtimeFiles) {
  const sourceFile = path.join(sourceReleaseDir, runtimeFile);

  if (!fs.existsSync(sourceFile)) {
    throw new Error(`Missing node-pty runtime file: ${runtimeFile}`);
  }

  fs.copyFileSync(sourceFile, path.join(targetReleaseDir, runtimeFile));
}

console.log(`[stage-node-pty-runtime] Staged node-pty runtime at ${path.relative(projectRoot, targetRoot)}`);