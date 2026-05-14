const { existsSync, readdirSync, statSync } = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const shortcutName = 'AI FSM Desktop.lnk';
const shortcutDescription = 'AI FSM Desktop';
const packagedExeRelativePath = path.join('AI FSM Desktop-win32-x64', 'AiFsmDesktop.exe');

const collectForgeOutDirs = () => {
  const seen = new Set();
  const candidates = [];

  const addCandidate = (dir) => {
    if (!dir) {
      return;
    }

    const resolved = path.resolve(projectRoot, dir);

    if (seen.has(resolved)) {
      return;
    }

    seen.add(resolved);
    candidates.push(resolved);
  };

  addCandidate(process.env.AI_FSM_FORGE_OUT_DIR?.trim());
  addCandidate('forge-out');

  for (const entry of readdirSync(projectRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && /^forge-out(?:$|-)/u.test(entry.name)) {
      addCandidate(entry.name);
    }
  }

  return candidates;
};

const resolvePackagedExe = () => {
  const candidates = collectForgeOutDirs()
    .map((dir) => path.join(dir, packagedExeRelativePath))
    .filter((candidate) => existsSync(candidate))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);

  return candidates[0] ?? null;
};

const forgeExe = resolvePackagedExe();

if (process.platform !== 'win32') {
  console.log('[sync-shortcuts] Skipped: Windows only');
  process.exit(0);
}

if (!forgeExe) {
  console.error('[sync-shortcuts] No packaged exe found under forge-out outputs.');
  console.error(`[sync-shortcuts] Searched: ${collectForgeOutDirs().join(', ')}`);
  console.error('[sync-shortcuts] Run: npx electron-forge package');
  process.exit(1);
}

const desktopDir = process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'Desktop') : null;
const startMenuDir = process.env.APPDATA
  ? path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  : null;

const shortcutTargets = [
  { dir: desktopDir, createIfMissing: true },
  { dir: startMenuDir, createIfMissing: true },
]
  .filter((entry) => entry.dir)
  .map((entry) => ({
    shortcutPath: path.join(entry.dir, shortcutName),
    createIfMissing: entry.createIfMissing,
  }));

const escapePowerShell = (value) => `'${String(value).replace(/'/g, "''")}'`;

for (const { shortcutPath, createIfMissing } of shortcutTargets) {
  if (!createIfMissing && !existsSync(shortcutPath)) continue;

  const script = [
    '$WshShell = New-Object -ComObject WScript.Shell',
    `$Shortcut = $WshShell.CreateShortcut(${escapePowerShell(shortcutPath)})`,
    `$Shortcut.TargetPath = ${escapePowerShell(forgeExe)}`,
    `$Shortcut.WorkingDirectory = ${escapePowerShell(path.dirname(forgeExe))}`,
    `$Shortcut.Description = ${escapePowerShell(shortcutDescription)}`,
    `$Shortcut.IconLocation = ${escapePowerShell(`${forgeExe},0`)}`,
    '$Shortcut.Save()',
  ].join('; ');

  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    stdio: 'inherit',
  });

  console.log(`[sync-shortcuts] Updated: ${shortcutPath} -> ${forgeExe}`);
}