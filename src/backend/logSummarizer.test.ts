import { describe, it, expect, vi } from 'vitest';

vi.mock('./processRunner', () => ({
  runCommandWithStdin: vi.fn(),
}));

import { runCommandWithStdin } from './processRunner';
import { summarizeSubAgentOutput } from './logSummarizer';

const mockedRunCommandWithStdin = vi.mocked(runCommandWithStdin);

describe('summarizeSubAgentOutput', () => {
  it('returns local summary for short output without calling LLM', async () => {
    const shortOutput = 'Short execution result.';
    const result = await summarizeSubAgentOutput(shortOutput, 'test task', 'tester');

    expect(result.summary).toContain('Short execution result.');
    expect(result.modifiedFiles).toEqual([]);
    expect(mockedRunCommandWithStdin).not.toHaveBeenCalled();
  });

  it('returns LLM parsed result when LLM responds with valid JSON', async () => {
    mockedRunCommandWithStdin.mockResolvedValueOnce({
      stdout: JSON.stringify({
        summary: 'Fixed the bug in auth.ts',
        keyFindings: ['auth.ts had a null pointer'],
        errorPatterns: [],
        modifiedFiles: ['src/auth.ts'],
      }),
      stderr: '',
      exitCode: 0,
      durationMs: 100,
      command: 'claude ...',
    });

    const longOutput = 'a'.repeat(10_000);
    const result = await summarizeSubAgentOutput(longOutput, 'fix auth', 'coder');

    expect(result.summary).toBe('Fixed the bug in auth.ts');
    expect(result.keyFindings).toContain('auth.ts had a null pointer');
    expect(result.modifiedFiles).toContain('src/auth.ts');
  });

  it('falls back to local truncation when LLM fails', async () => {
    mockedRunCommandWithStdin.mockRejectedValueOnce(new Error('LLM timeout'));

    const longOutput = 'Error: something went wrong\n' + 'b'.repeat(10_000) + '\nsrc/main.ts';
    const result = await summarizeSubAgentOutput(longOutput, 'fix bug', 'coder');

    expect(result.summary.startsWith('[本地摘要]')).toBe(true);
    expect(result.modifiedFiles).toContain('src/main.ts');
  });

  it('extracts file paths from raw output in fallback mode', async () => {
    mockedRunCommandWithStdin.mockRejectedValueOnce(new Error('timeout'));

    const raw = 'Modified src/app.ts and src/components/Button.tsx. Also updated package.json.';
    const result = await summarizeSubAgentOutput(raw, 'update UI', 'frontend');

    expect(result.modifiedFiles).toContain('src/app.ts');
    expect(result.modifiedFiles).toContain('src/components/Button.tsx');
    expect(result.modifiedFiles).toContain('package.json');
  });
});
