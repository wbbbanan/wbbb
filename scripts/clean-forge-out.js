const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

function safeRemove(dirPath) {
  if (fs.existsSync(dirPath)) {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true, maxRetries: 3 });
      console.log(`[clean-forge-out] Removed: ${path.relative(projectRoot, dirPath)}`);
    } catch (error) {
      console.warn(`[clean-forge-out] Failed to remove: ${path.relative(projectRoot, dirPath)} (${error.code})`);
    }
  }
}

function cleanForgeOut() {
  console.log('[clean-forge-out] Cleaning old build artifacts...');

  // NOTE: We do NOT delete forge-out/AI FSM Desktop-win32-x64/
  // because Desktop/Start Menu shortcuts point to the exe inside it.

  // 1. Remove Squirrel artifacts (can be regenerated from zip)
  const squirrelDir = path.join(projectRoot, 'forge-out', 'make', 'squirrel.windows');
  safeRemove(squirrelDir);

  // 3. In zip directory: keep only the latest zip, remove old ones
  const zipDir = path.join(projectRoot, 'forge-out', 'make', 'zip', 'win32', 'x64');
  if (fs.existsSync(zipDir)) {
    const zips = fs
      .readdirSync(zipDir)
      .filter((f) => f.endsWith('.zip'))
      .map((f) => ({
        name: f,
        path: path.join(zipDir, f),
        version: f.match(/-(\d+\.\d+\.\d+)\.zip$/)?.[1] ?? '0.0.0',
        mtime: fs.statSync(path.join(zipDir, f)).mtime,
      }))
      .sort((a, b) => {
        // Sort by version number descending (e.g. 0.1.73 > 0.1.72)
        const va = a.version.split('.').map(Number);
        const vb = b.version.split('.').map(Number);
        for (let i = 0; i < 3; i++) {
          if (va[i] !== vb[i]) return (vb[i] ?? 0) - (va[i] ?? 0);
        }
        return b.mtime - a.mtime;
      });

    if (zips.length > 1) {
      const latest = zips[0];
      console.log(`[clean-forge-out] Keeping latest zip: ${latest.name}`);
      for (let i = 1; i < zips.length; i++) {
        fs.unlinkSync(zips[i].path);
        console.log(`[clean-forge-out] Removed old zip: ${zips[i].name}`);
      }
    } else if (zips.length === 1) {
      console.log(`[clean-forge-out] Only one zip exists: ${zips[0].name}`);
    }
  }

  // 4. Remove old forge-out backup directories (e.g. forge-out-0.1.63)
  const entries = fs.readdirSync(projectRoot);
  for (const entry of entries) {
    if (entry.startsWith('forge-out-')) {
      const backupDir = path.join(projectRoot, entry);
      if (fs.statSync(backupDir).isDirectory()) {
        safeRemove(backupDir);
      }
    }
  }

  console.log('[clean-forge-out] Done.');
}

cleanForgeOut();
