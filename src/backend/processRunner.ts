import { spawn } from 'node:child_process';
import kill from 'tree-kill';
import { getWorkflowConfig } from './configManager';
import { resolveWindowsSpawnTarget } from './windowsCommandResolver';

export { resolveWindowsSpawnTarget } from './windowsCommandResolver';

export interface CommandSpec {
  bin: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  command: string;
}

export interface CommandStreamingSpec extends CommandSpec {
  stdinData?: string;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
}

export interface ProcessRegistry {
  readonly size: number;
  track(pid: number | undefined): void;
  untrack(pid: number | undefined): void;
  snapshot(): number[];
  killAll(): Promise<void>;
}

interface ProcessExecutionErrorData {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  cause?: unknown;
}

interface ProcessAbortErrorData {
  command: string;
  stdout: string;
  stderr: string;
  cause?: unknown;
}

export class ProcessExecutionError extends Error {
  readonly command: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  override readonly cause?: unknown;

  constructor(message: string, data: ProcessExecutionErrorData) {
    super(message);
    this.name = 'ProcessExecutionError';
    this.command = data.command;
    this.stdout = data.stdout;
    this.stderr = data.stderr;
    this.exitCode = data.exitCode;
    this.timedOut = data.timedOut;
    this.cause = data.cause;
  }
}

export class ProcessAbortError extends Error {
  readonly command: string;
  readonly stdout: string;
  readonly stderr: string;
  override readonly cause?: unknown;

  constructor(message: string, data: ProcessAbortErrorData) {
    super(message);
    this.name = 'ProcessAbortError';
    this.command = data.command;
    this.stdout = data.stdout;
    this.stderr = data.stderr;
    this.cause = data.cause;
  }
}

export const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const getBackoffDelay = (attemptIndex: number): number =>
  Math.min(getWorkflowConfig().backoffBaseMs * 2 ** attemptIndex, getWorkflowConfig().backoffMaxMs);

export const createProcessRegistry = (): ProcessRegistry => {
  const pids = new Set<number>();

  return {
    get size() {
      return pids.size;
    },
    track(pid) {
      if (typeof pid !== 'number' || !Number.isFinite(pid)) {
        return;
      }

      pids.add(pid);
    },
    untrack(pid) {
      if (typeof pid !== 'number' || !Number.isFinite(pid)) {
        return;
      }

      pids.delete(pid);
    },
    snapshot() {
      return [...pids];
    },
    async killAll() {
      const targets = [...pids];

      await Promise.all(
        targets.map(async (pid) => {
          try {
            await killProcessTree(pid);
          } catch {
            // Best effort cleanup for tracked child processes.
          } finally {
            pids.delete(pid);
          }
        }),
      );
    },
  };
};

const trackedProcesses = createProcessRegistry();

export const killAllTrackedProcesses = (): Promise<void> => trackedProcesses.killAll();

const quoteArgument = (value: string): string => {
  if (!/[\s"]/u.test(value)) {
    return value;
  }

  return `"${value.replace(/"/gu, '\\"')}"`;
};

export const formatCommand = (bin: string, args: string[]): string => [bin, ...args.map(quoteArgument)].join(' ');

const createLineEmitter = (onLine?: (line: string) => void) => {
  let buffer = '';

  return {
    push(chunk: Buffer | string): string {
      const text = chunk.toString();

      if (!onLine) {
        return text;
      }

      buffer += text;
      const parts = buffer.split(/\r?\n/gu);
      buffer = parts.pop() ?? '';

      for (const line of parts) {
        onLine(line);
      }

      return text;
    },
    flush(): void {
      if (!onLine || buffer.length === 0) {
        return;
      }

      onLine(buffer);
      buffer = '';
    },
  };
};

export const killProcessTree = async (pid: number): Promise<void> =>
  new Promise((resolve, reject) => {
    kill(pid, 'SIGKILL', (error) => {
      if (error && !String(error.message).includes('not found')) {
        reject(error);
        return;
      }

      resolve();
    });
  });

export const runCommand = async (spec: CommandSpec): Promise<CommandResult> => {
  const command = formatCommand(spec.bin, spec.args);
  const spawnTarget = process.platform === 'win32' ? resolveWindowsSpawnTarget(spec.bin, spec.args) : { bin: spec.bin, args: spec.args };

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeoutMs = spec.timeoutMs ?? getWorkflowConfig().commandTimeoutMs;
    let abortHandler: (() => void) | null = null;

    const finish = (error?: ProcessExecutionError, exitCode?: number): void => {
      if (settled) {
        return;
      }

      settled = true;
      trackedProcesses.untrack(child.pid);
      clearTimeout(timer);

      if (spec.signal && abortHandler) {
        spec.signal.removeEventListener('abort', abortHandler);
        abortHandler = null;
      }

      if (error) {
        reject(error);
        return;
      }

      resolve({
        stdout,
        stderr,
        exitCode: exitCode ?? 0,
        durationMs: Date.now() - startedAt,
        command,
      });
    };

    const child = spawn(spawnTarget.bin, spawnTarget.args, {
      cwd: spec.cwd,
      env: {
        ...process.env,
        ...spec.env,
      },
      shell: false,
      windowsHide: true,
    });

    trackedProcesses.track(child.pid);

    abortHandler = () => {
      void (async () => {
        try {
          if (child.pid) {
            await killProcessTree(child.pid);
          }
        } catch {
          // Ignore secondary kill errors and surface the abort instead.
        }

        if (settled) {
          return;
        }

        settled = true;
        trackedProcesses.untrack(child.pid);
        clearTimeout(timer);

        if (spec.signal) {
          spec.signal.removeEventListener('abort', abortHandler!);
          abortHandler = null;
        }

        reject(
          new ProcessAbortError('Command cancelled.', {
            command,
            stdout,
            stderr,
          }),
        );
      })();
    };

    if (spec.signal?.aborted) {
      abortHandler();
      return;
    }

    spec.signal?.addEventListener('abort', abortHandler, { once: true });

    const timer = setTimeout(async () => {
      try {
        if (child.pid) {
          await killProcessTree(child.pid);
        }
      } catch {
        // Ignore secondary kill errors and surface the original timeout.
      }

      finish(
        new ProcessExecutionError(`Command timed out after ${timeoutMs}ms.`, {
          command,
          stdout,
          stderr,
          exitCode: null,
          timedOut: true,
        }),
      );
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      finish(
        new ProcessExecutionError(error.message, {
          command,
          stdout,
          stderr,
          exitCode: null,
          timedOut: false,
          cause: error,
        }),
      );
    });

    child.on('close', (exitCode) => {
      if (exitCode && exitCode !== 0) {
        finish(
          new ProcessExecutionError(`Command exited with code ${exitCode}.`, {
            command,
            stdout,
            stderr,
            exitCode,
            timedOut: false,
          }),
        );
        return;
      }

      finish(undefined, exitCode ?? 0);
    });
  });
};

export const runCommandWithStdin = async (spec: CommandSpec, stdinData: string): Promise<CommandResult> => {
  const command = formatCommand(spec.bin, spec.args);
  const spawnTarget = process.platform === 'win32' ? resolveWindowsSpawnTarget(spec.bin, spec.args) : { bin: spec.bin, args: spec.args };

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeoutMs = spec.timeoutMs ?? getWorkflowConfig().commandTimeoutMs;
    let abortHandler: (() => void) | null = null;

    const finish = (error?: ProcessExecutionError, exitCode?: number): void => {
      if (settled) return;
      settled = true;
      trackedProcesses.untrack(child.pid);
      clearTimeout(timer);
      if (spec.signal && abortHandler) {
        spec.signal.removeEventListener('abort', abortHandler);
        abortHandler = null;
      }
      if (error) { reject(error); return; }
      resolve({ stdout, stderr, exitCode: exitCode ?? 0, durationMs: Date.now() - startedAt, command });
    };

    const child = spawn(spawnTarget.bin, spawnTarget.args, {
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env },
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    trackedProcesses.track(child.pid);

    abortHandler = () => {
      void (async () => {
        try { if (child.pid) await killProcessTree(child.pid); } catch {}
        if (settled) return;
        settled = true;
        trackedProcesses.untrack(child.pid);
        clearTimeout(timer);
        if (spec.signal) { spec.signal.removeEventListener('abort', abortHandler!); abortHandler = null; }
        reject(new ProcessAbortError('Command cancelled.', { command, stdout, stderr }));
      })();
    };

    if (spec.signal?.aborted) { abortHandler(); return; }
    spec.signal?.addEventListener('abort', abortHandler, { once: true });

    const timer = setTimeout(async () => {
      try { if (child.pid) await killProcessTree(child.pid); } catch {}
      finish(new ProcessExecutionError(`Command timed out after ${timeoutMs}ms.`, { command, stdout, stderr, exitCode: null, timedOut: true }));
    }, timeoutMs);

    // Write stdin data and close the pipe
    if (child.stdin) {
      child.stdin.write(stdinData, 'utf8');
      child.stdin.end();
    }

    child.stdout?.on('data', (chunk: Buffer | string) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk: Buffer | string) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      finish(new ProcessExecutionError(error.message, { command, stdout, stderr, exitCode: null, timedOut: false, cause: error }));
    });
    child.on('close', (exitCode) => {
      if (exitCode && exitCode !== 0) {
        finish(new ProcessExecutionError(`Command exited with code ${exitCode}.`, { command, stdout, stderr, exitCode, timedOut: false }));
        return;
      }
      finish(undefined, exitCode ?? 0);
    });
  });
};

export const runCommandStreaming = async (spec: CommandStreamingSpec): Promise<CommandResult> => {
  const command = formatCommand(spec.bin, spec.args);
  const spawnTarget = process.platform === 'win32' ? resolveWindowsSpawnTarget(spec.bin, spec.args) : { bin: spec.bin, args: spec.args };

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeoutMs = spec.timeoutMs ?? getWorkflowConfig().commandTimeoutMs;
    let abortHandler: (() => void) | null = null;
    const stdoutEmitter = createLineEmitter(spec.onStdoutLine);
    const stderrEmitter = createLineEmitter(spec.onStderrLine);

    const finish = (error?: ProcessExecutionError, exitCode?: number): void => {
      if (settled) {
        return;
      }

      settled = true;
      trackedProcesses.untrack(child.pid);
      clearTimeout(timer);
      stdoutEmitter.flush();
      stderrEmitter.flush();

      if (spec.signal && abortHandler) {
        spec.signal.removeEventListener('abort', abortHandler);
        abortHandler = null;
      }

      if (error) {
        reject(error);
        return;
      }

      resolve({ stdout, stderr, exitCode: exitCode ?? 0, durationMs: Date.now() - startedAt, command });
    };

    const child = spawn(spawnTarget.bin, spawnTarget.args, {
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env },
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    trackedProcesses.track(child.pid);

    abortHandler = () => {
      void (async () => {
        try {
          if (child.pid) {
            await killProcessTree(child.pid);
          }
        } catch {
          // Ignore secondary kill errors and surface the abort instead.
        }

        if (settled) {
          return;
        }

        settled = true;
        trackedProcesses.untrack(child.pid);
        clearTimeout(timer);

        if (spec.signal) {
          spec.signal.removeEventListener('abort', abortHandler!);
          abortHandler = null;
        }

        reject(new ProcessAbortError('Command cancelled.', { command, stdout, stderr }));
      })();
    };

    if (spec.signal?.aborted) {
      abortHandler();
      return;
    }

    spec.signal?.addEventListener('abort', abortHandler, { once: true });

    const timer = setTimeout(async () => {
      try {
        if (child.pid) {
          await killProcessTree(child.pid);
        }
      } catch {
        // Ignore secondary kill errors and surface the original timeout.
      }

      finish(new ProcessExecutionError(`Command timed out after ${timeoutMs}ms.`, { command, stdout, stderr, exitCode: null, timedOut: true }));
    }, timeoutMs);

    if (child.stdin && typeof spec.stdinData === 'string') {
      child.stdin.write(spec.stdinData, 'utf8');
    }

    child.stdin?.end();

    child.stdout?.on('data', (chunk: Buffer | string) => {
      const text = stdoutEmitter.push(chunk);
      stdout += text;
    });

    child.stderr?.on('data', (chunk: Buffer | string) => {
      const text = stderrEmitter.push(chunk);
      stderr += text;
    });

    child.on('error', (error) => {
      finish(new ProcessExecutionError(error.message, { command, stdout, stderr, exitCode: null, timedOut: false, cause: error }));
    });

    child.on('close', (exitCode) => {
      if (exitCode && exitCode !== 0) {
        finish(new ProcessExecutionError(`Command exited with code ${exitCode}.`, { command, stdout, stderr, exitCode, timedOut: false }));
        return;
      }

      finish(undefined, exitCode ?? 0);
    });
  });
};

export const withExponentialBackoff = async <T>(
  operation: (attempt: number) => Promise<T>,
  maxAttempts = 3,
): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (error instanceof ProcessAbortError) {
        throw error;
      }

      lastError = error;

      if (attempt === maxAttempts) {
        break;
      }

      await delay(getBackoffDelay(attempt - 1));
    }
  }

  throw lastError;
};