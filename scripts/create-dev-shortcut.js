const { existsSync, mkdirSync } = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const shortcutName = 'AI FSM Desktop (Dev).lnk';
const shortcutDescription = 'AI FSM Desktop (Development)';

const getNpmCmdPath = () => {
  try {
    const output = execFileSync('where.exe', ['npm.cmd'], { encoding: 'utf8' })
      .split(/\r?\n/gu)
      .map((line) => line.trim())
      .filter(Boolean);

    return output[0] ?? 'npm.cmd';
  } catch {
    return 'npm.cmd';
  }
};

const escapePowerShell = (value) => `'${String(value).replace(/'/g, "''")}'`;

const desktopDir = process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'Desktop') : null;
const startMenuDir = process.env.APPDATA
  ? path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  : null;

const shortcutTargets = [desktopDir, startMenuDir]
  .filter(Boolean)
  .map((dir) => path.join(dir, shortcutName));

if (process.platform !== 'win32') {
  console.log('[create-dev-shortcut] Skipped: Windows only');
  process.exit(0);
}

const powershellExe = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const npmCmd = getNpmCmdPath();
const command = `Set-Location ${escapePowerShell(projectRoot)}; & ${escapePowerShell(npmCmd)} start`;
const iconCandidate = path.join(projectRoot, 'build-resources', 'icon.ico');
const iconLocation = existsSync(iconCandidate) ? iconCandidate : powershellExe;

for (const shortcutPath of shortcutTargets) {
  mkdirSync(path.dirname(shortcutPath), { recursive: true });

  const script = [
    '$WshShell = New-Object -ComObject WScript.Shell',
    `$Shortcut = $WshShell.CreateShortcut(${escapePowerShell(shortcutPath)})`,
    `$Shortcut.TargetPath = ${escapePowerShell(powershellExe)}`,
    `$Shortcut.Arguments = ${escapePowerShell(`-NoProfile -ExecutionPolicy Bypass -Command \"${command}\"`)}`,
    `$Shortcut.WorkingDirectory = ${escapePowerShell(projectRoot)}`,
    `$Shortcut.Description = ${escapePowerShell(shortcutDescription)}`,
    `$Shortcut.IconLocation = ${escapePowerShell(`${iconLocation},0`)}`,
    '$Shortcut.Save()',
  ].join('; ');

  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    stdio: 'inherit',
  });

  console.log(`[create-dev-shortcut] Updated: ${shortcutPath}`);
}

console.log(`[create-dev-shortcut] Project root: ${projectRoot}`);
console.log(`[create-dev-shortcut] npm command: ${npmCmd}`);