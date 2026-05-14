const { readFileSync, writeFileSync, existsSync } = require('fs');
const { join } = require('path');

const repoRoot = join(__dirname, '..');
const packageJsonPath = join(repoRoot, 'package.json');
const packageLockPath = join(repoRoot, 'package-lock.json');
const changelogPath = join(repoRoot, 'CHANGELOG.md');

const readJson = (filePath) => JSON.parse(readFileSync(filePath, 'utf-8'));

const parseVersion = (value) => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(String(value ?? '').trim());
  if (!match) {
    throw new Error(`[bump-version] Invalid version: ${value}`);
  }

  return match.slice(1).map(Number);
};

const compareVersions = (left, right) => {
  const [leftMajor, leftMinor, leftPatch] = parseVersion(left);
  const [rightMajor, rightMinor, rightPatch] = parseVersion(right);

  if (leftMajor !== rightMajor) return leftMajor - rightMajor;
  if (leftMinor !== rightMinor) return leftMinor - rightMinor;
  return leftPatch - rightPatch;
};

const getLatestChangelogVersion = () => {
  if (!existsSync(changelogPath)) {
    return null;
  }

  const match = readFileSync(changelogPath, 'utf-8').match(/^## v(\d+\.\d+\.\d+)$/mu);
  return match ? match[1] : null;
};

const packageJson = readJson(packageJsonPath);
const packageLock = existsSync(packageLockPath) ? readJson(packageLockPath) : null;

const versionCandidates = [
  packageJson.version,
  packageLock?.version,
  packageLock?.packages?.['']?.version,
  getLatestChangelogVersion(),
].filter(Boolean);

const baselineVersion = versionCandidates.sort(compareVersions).at(-1);
const [major, minor, patch] = parseVersion(baselineVersion);
const newVersion = `${major}.${minor}.${patch + 1}`;

packageJson.version = newVersion;
writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');

if (packageLock) {
  packageLock.version = newVersion;
  if (packageLock.packages?.['']) {
    packageLock.packages[''].version = newVersion;
  }

  writeFileSync(packageLockPath, JSON.stringify(packageLock, null, 2) + '\n');
}

const messageIndex = process.argv.indexOf('--message');
const argMessage = messageIndex >= 0 && process.argv[messageIndex + 1] ? process.argv[messageIndex + 1].trim() : '';
const envMessage = (process.env.BUMP_MESSAGE || '').trim();
const message = argMessage || envMessage;

if (message) {
  const today = new Date().toISOString().slice(0, 10);
  const entry = `## v${newVersion} (${today})\n${message.split('\\n').map((line) => `- ${line.trim()}`).join('\n')}\n`;

  const existing = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf-8') : '';
  const header = '# Changelog\n\n';
  const body = existing.startsWith(header) ? existing.slice(header.length) : existing;
  writeFileSync(changelogPath, header + entry + '\n' + body);
  console.log(`[bump-version] ${baselineVersion} -> ${newVersion} (changelog updated)`);
} else {
  console.log(`[bump-version] ${baselineVersion} -> ${newVersion}`);
}
