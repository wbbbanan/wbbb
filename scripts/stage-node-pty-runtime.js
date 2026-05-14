const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const sourceRoot = path.join(projectRoot, 'node_modules', 'node-pty');
const sourceLibDir = path.join(sourceRoot, 'lib');
const sourceReleaseDir = path.join(sourceRoot, 'build', 'Release');
const sourcePrebuildsDir = path.join(sourceRoot, 'prebuilds');
const targetRoot = path.join(projectRoot, 'build-resources', 'node-pty-runtime');
const targetLibDir = path.join(targetRoot, 'lib');
const targetReleaseDir = path.join(targetRoot, 'build', 'Release');
const targetPrebuildsDir = path.join(targetRoot, 'prebuilds');
const nativeRuntimeExtensions = new Set(['.dll', '.exe', '.node', '.pdb']);

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

const shouldStageNativeRuntimeEntry = (sourcePath) => {
  const stats = fs.statSync(sourcePath);

  if (stats.isDirectory()) {
    return true;
  }

  return nativeRuntimeExtensions.has(path.extname(sourcePath).toLowerCase());
};

if (
  !fs.existsSync(sourceLibDir) ||
  (!fs.existsSync(sourceReleaseDir) && !fs.existsSync(sourcePrebuildsDir))
) {
  throw new Error('node-pty runtime files are missing. Reinstall dependencies before packaging.');
}

fs.rmSync(targetRoot, { recursive: true, force: true });
fs.mkdirSync(targetLibDir, { recursive: true });
fs.mkdirSync(targetReleaseDir, { recursive: true });
fs.mkdirSync(targetPrebuildsDir, { recursive: true });
fs.cpSync(sourceLibDir, targetLibDir, { recursive: true, filter: shouldStageRuntimeLibEntry });

if (fs.existsSync(sourceReleaseDir)) {
  fs.cpSync(sourceReleaseDir, targetReleaseDir, {
    recursive: true,
    filter: shouldStageNativeRuntimeEntry,
  });
}

if (fs.existsSync(sourcePrebuildsDir)) {
  fs.cpSync(sourcePrebuildsDir, targetPrebuildsDir, {
    recursive: true,
    filter: shouldStageNativeRuntimeEntry,
  });
}

console.log(`[stage-node-pty-runtime] Staged node-pty runtime at ${path.relative(projectRoot, targetRoot)}`);