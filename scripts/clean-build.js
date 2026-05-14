const { existsSync, readdirSync, rmSync } = require('fs');
const { join } = require('path');

const projectRoot = join(__dirname, '..');
const targets = ['out', '.webpack'];

for (const target of targets) {
  const fullPath = join(projectRoot, target);
  if (existsSync(fullPath)) {
    rmSync(fullPath, { recursive: true, force: true });
    console.log(`[clean] Removed: ${target}`);
  }
}

const entries = readdirSync(projectRoot);
for (const entry of entries) {
  if (entry.startsWith('tmp-')) {
    const fullPath = join(projectRoot, entry);
    rmSync(fullPath, { recursive: true, force: true });
    console.log(`[clean] Removed: ${entry}`);
  }
}

console.log('[clean] Done');
