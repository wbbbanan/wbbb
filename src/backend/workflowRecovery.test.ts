import { describe, it, expect, vi } from 'vitest';

vi.mock('./configManager', () => ({
  getWorkflowConfig: vi.fn(() => ({
    backoffBaseMs: 2_000,
    backoffMaxMs: 60_000,
  })),
}));

vi.mock('./processRunner', () => ({
  ProcessExecutionError: class ProcessExecutionError extends Error {
    command: string;
    exitCode: number | null;
    timedOut: boolean;
    constructor(message: string, data: any) {
      super(message);
      this.name = 'ProcessExecutionError';
      this.command = data.command;
      this.exitCode = data.exitCode;
      this.timedOut = data.timedOut;
    }
  },
}));

import { classifyWorkflowError, createInterruptedRecovery } from './workflowRecovery';
import { ProcessExecutionError } from './processRunner';

describe('classifyWorkflowError', () => {
  it('classifies timeout errors', () => {
    const error = new ProcessExecutionError('timed out', {
      command: 'test',
      stdout: '',
      stderr: '',
      exitCode: null,
      timedOut: true,
    });
    const result = classifyWorkflowError(error, 'execution', 1);
    expect(result.category).toBe('timeout');
    expect(result.autoRetryable).toBe(true);
    expect(result.action).toBe('queued-retry');
  });

  it('classifies OOM errors (exit code 137)', () => {
    const error = new ProcessExecutionError('killed', {
      command: 'test',
      stdout: '',
      stderr: '',
      exitCode: 137,
      timedOut: false,
    });
    const result = classifyWorkflowError(error, 'execution', 1);
    expect(result.category).toBe('transient-infrastructure');
    expect(result.autoRetryable).toBe(true);
    expect(result.summary).toContain('内存不足');
  });

  it('classifies OOM errors (heap keywords)', () => {
    const error = new Error('JavaScript heap out of memory');
    const result = classifyWorkflowError(error, 'execution', 1);
    expect(result.category).toBe('transient-infrastructure');
    expect(result.autoRetryable).toBe(true);
  });

  it('classifies segfault (exit code 139)', () => {
    const error = new ProcessExecutionError('segfault', {
      command: 'test',
      stdout: '',
      stderr: '',
      exitCode: 139,
      timedOut: false,
    });
    const result = classifyWorkflowError(error, 'execution', 1);
    expect(result.category).toBe('unknown');
    expect(result.autoRetryable).toBe(false);
    expect(result.summary).toContain('段错误');
  });

  it('classifies disk space errors', () => {
    const error = new Error('ENOSPC: no space left on device');
    const result = classifyWorkflowError(error, 'execution', 1);
    expect(result.category).toBe('transient-infrastructure');
    expect(result.autoRetryable).toBe(false);
    expect(result.summary).toContain('磁盘空间');
  });

  it('classifies permission errors', () => {
    const error = new Error('EPERM: operation not permitted');
    const result = classifyWorkflowError(error, 'execution', 1);
    expect(result.category).toBe('transient-infrastructure');
    expect(result.autoRetryable).toBe(false);
    expect(result.summary).toContain('权限');
  });

  it('classifies authentication errors', () => {
    const error = new Error('unauthorized: invalid API key');
    const result = classifyWorkflowError(error, 'planning', 1);
    expect(result.category).toBe('authentication');
    expect(result.autoRetryable).toBe(false);
  });

  it('classifies transient infrastructure errors', () => {
    const error = new Error('ECONNREFUSED: connection refused');
    const result = classifyWorkflowError(error, 'execution', 1);
    expect(result.category).toBe('transient-infrastructure');
    expect(result.autoRetryable).toBe(true);
  });

  it('classifies empty output errors', () => {
    const error = new Error('输出为空');
    const result = classifyWorkflowError(error, 'verification', 1);
    expect(result.category).toBe('empty-output');
    expect(result.autoRetryable).toBe(true);
  });

  it('classifies validation errors', () => {
    const error = new Error('schema validation failed');
    const result = classifyWorkflowError(error, 'planning', 1);
    expect(result.category).toBe('validation');
    expect(result.autoRetryable).toBe(false);
  });

  it('falls back to unknown for unrecognized errors', () => {
    const error = new Error('something completely unexpected');
    const result = classifyWorkflowError(error, 'execution', 1);
    expect(result.category).toBe('unknown');
    expect(result.autoRetryable).toBe(false);
  });

  it('handles non-Error values', () => {
    const result = classifyWorkflowError('string error', 'execution', 1);
    expect(result.category).toBe('unknown');
  });
});

describe('createInterruptedRecovery', () => {
  it('creates a recovery descriptor for the given phase', () => {
    const result = createInterruptedRecovery('execution');
    expect(result.category).toBe('interrupted');
    expect(result.action).toBe('resume-from-checkpoint');
    expect(result.autoRetryable).toBe(false);
    expect(result.summary).toContain('execution');
  });

  it('includes classifiedAt timestamp', () => {
    const result = createInterruptedRecovery('planning');
    expect(result.classifiedAt).toBeTruthy();
    expect(new Date(result.classifiedAt).getTime()).not.toBeNaN();
  });
});
