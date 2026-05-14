import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveWindowsSpawnTarget } from './windowsCommandResolver';

describe('windowsCommandResolver', () => {
  it('wraps PowerShell scripts with powershell.exe', () => {
    const scriptPath = 'C:\\tools\\sync.ps1';

    expect(resolveWindowsSpawnTarget(scriptPath, ['-Mode', 'test'])).toEqual({
      bin: 'powershell.exe',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Mode', 'test'],
    });
  });

  it('resolves local node cmd shims to node.exe and script path', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'ai-fsm-win-shim-'));
    const shimPath = path.join(tempDir, 'tool.cmd');
    const nodePath = path.join(tempDir, 'node.exe');
    const scriptRelativePath = `dist${path.sep}cli.js`;

    writeFileSync(shimPath, `@echo off\r\n"%dp0%\\dist\\cli.js" %*\r\n`, 'utf8');
    writeFileSync(nodePath, '', 'utf8');

    expect(resolveWindowsSpawnTarget(shimPath, ['--flag'])).toEqual({
      bin: nodePath,
      args: [path.join(tempDir, scriptRelativePath), '--flag'],
    });
  });
});