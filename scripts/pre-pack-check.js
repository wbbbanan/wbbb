const { readFileSync, existsSync } = require('fs');
const { join } = require('path');
const { execSync } = require('child_process');

const repoRoot = join(__dirname, '..');
const packageJsonPath = join(repoRoot, 'package.json');
const changelogPath = join(repoRoot, 'CHANGELOG.md');

let exitCode = 0;

const fail = (message) => {
  console.error(`[pre-pack-check] FAIL: ${message}`);
  exitCode = 1;
};

const pass = (message) => {
  console.log(`[pre-pack-check] OK: ${message}`);
};

// 1. Check package.json exists and has version
if (!existsSync(packageJsonPath)) {
  fail('package.json not found.');
} else {
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  if (!pkg.version) {
    fail('package.json missing version field.');
  } else {
    pass(`package.json version: ${pkg.version}`);
  }

  // 2. Check CHANGELOG.md
  if (!existsSync(changelogPath)) {
    fail('CHANGELOG.md not found.');
  } else {
    const changelog = readFileSync(changelogPath, 'utf-8');
    const expectedHeader = `## v${pkg.version}`;

    if (!changelog.includes(expectedHeader)) {
      fail(`CHANGELOG.md missing entry for ${expectedHeader}.`);
    } else {
      pass(`CHANGELOG.md contains ${expectedHeader}.`);
    }

    // Check version ordering (descending)
    const versionHeaders = changelog.match(/^## v[\d.]+/gm) ?? [];
    const versions = versionHeaders.map((h) => h.replace('## v', ''));

    for (let i = 1; i < versions.length; i++) {
      const prev = versions[i - 1].split('.').map(Number);
      const curr = versions[i].split('.').map(Number);
      const prevVal = prev[0] * 1_000_000 + prev[1] * 1_000 + prev[2];
      const currVal = curr[0] * 1_000_000 + curr[1] * 1_000 + curr[2];

      if (prevVal < currVal) {
        fail(`CHANGELOG.md versions not in descending order: ${versions[i - 1]} before ${versions[i]}.`);
        break;
      }
    }

    if (versions.length > 0) {
      pass(`CHANGELOG.md has ${versions.length} version entries, ordering valid.`);
    }
  }

  // 3. Run lint
  try {
    console.log('[pre-pack-check] Running lint...');
    execSync('npx tsc --noEmit', { cwd: repoRoot, stdio: 'pipe' });
    pass('TypeScript lint passed.');
  } catch (error) {
    fail('TypeScript lint failed.');
  }

  // 4. Run tests
  try {
    console.log('[pre-pack-check] Running tests...');
    execSync('npx vitest run', { cwd: repoRoot, stdio: 'pipe' });
    pass('Tests passed.');
  } catch (error) {
    fail('Tests failed.');
  }
}

if (exitCode === 0) {
  console.log('[pre-pack-check] All checks passed. Safe to package.');
} else {
  console.error('[pre-pack-check] Pre-pack checks failed. Fix issues before packaging.');
}

process.exit(exitCode);
