import { describe, it, expect } from 'vitest';
import { createProcessRegistry, formatCommand, resolveWindowsSpawnTarget, runCommandStreaming } from './processRunner';

describe('processRunner', () => {
  describe('formatCommand', () => {
    it('formats simple command without args', () => {
      expect(formatCommand('node', [])).toBe('node');
    });

    it('formats command with args', () => {
      expect(formatCommand('node', ['script.js', '--flag'])).toBe('node script.js --flag');
    });

    it('quotes args with spaces', () => {
      expect(formatCommand('cmd', ['arg with space'])).toBe('cmd "arg with space"');
    });

    it('quotes args with double quotes', () => {
      expect(formatCommand('cmd', ['say "hello"'])).toBe('cmd "say \\"hello\\""');
    });
  });

  describe('createProcessRegistry', () => {
    it('starts with size 0', () => {
      const registry = createProcessRegistry();
      expect(registry.size).toBe(0);
    });

    it('tracks and untracks PIDs', () => {
      const registry = createProcessRegistry();
      registry.track(1234);
      expect(registry.size).toBe(1);
      expect(registry.snapshot()).toContain(1234);

      registry.untrack(1234);
      expect(registry.size).toBe(0);
      expect(registry.snapshot()).toEqual([]);
    });

    it('ignores undefined PID', () => {
      const registry = createProcessRegistry();
      registry.track(undefined);
      expect(registry.size).toBe(0);
    });

    it('ignores duplicate tracking', () => {
      const registry = createProcessRegistry();
      registry.track(1234);
      registry.track(1234);
      expect(registry.size).toBe(1);
    });

    it('killAll clears the registry', async () => {
      const registry = createProcessRegistry();
      registry.track(1234);
      registry.track(5678);
      await registry.killAll();
      expect(registry.size).toBe(0);
    });
  });

  describe('runCommandStreaming', () => {
    it('streams stdout lines and flushes the final unterminated line after stdin completes', async () => {
      const lines: string[] = [];
      const result = await runCommandStreaming({
        bin: process.execPath,
        args: [
          '-e',
          "process.stdin.setEncoding('utf8');let data='';process.stdin.on('data',chunk=>data+=chunk);process.stdin.on('end',()=>{process.stdout.write('first\\n');process.stdout.write(data.toUpperCase());});",
        ],
        stdinData: 'second',
        onStdoutLine: (line) => lines.push(line),
      });

      expect(lines).toEqual(['first', 'SECOND']);
      expect(result.stdout).toBe('first\nSECOND');
      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
    });
  });
});