const fs = require('node:fs');
const path = require('node:path');

const spectreLine = "'SpectreMitigation': 'Spectre'";
const targetFiles = [
  path.resolve(__dirname, '..', 'node_modules', 'node-pty', 'binding.gyp'),
  path.resolve(__dirname, '..', 'node_modules', 'node-pty', 'deps', 'winpty', 'src', 'winpty.gyp'),
];

let patchedCount = 0;

for (const targetFile of targetFiles) {
  if (!fs.existsSync(targetFile)) {
    console.log(`[patch-node-pty] Missing ${path.relative(process.cwd(), targetFile)}, skipping`);
    continue;
  }

  const original = fs.readFileSync(targetFile, 'utf8');

  if (!original.includes(spectreLine)) {
    console.log(`[patch-node-pty] SpectreMitigation already patched in ${path.relative(process.cwd(), targetFile)}`);
    continue;
  }

  const patched = original
    .replace(`                ${spectreLine}\r\n`, '')
    .replace(`                ${spectreLine}\n`, '')
    .replace(`          ${spectreLine}\r\n`, '')
    .replace(`          ${spectreLine}\n`, '');

  fs.writeFileSync(targetFile, patched, 'utf8');
  patchedCount += 1;
  console.log(`[patch-node-pty] Removed SpectreMitigation from ${path.relative(process.cwd(), targetFile)}`);
}

if (patchedCount === 0) {
  console.log('[patch-node-pty] No SpectreMitigation entries needed patching');
}