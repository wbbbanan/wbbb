import { createLogger } from './logger';

const log = createLogger('cleanupRegistry');

type CleanupFn = () => void | Promise<void>;

interface CleanupEntry {
  id: string;
  fn: CleanupFn;
  once: boolean;
}

const entries = new Map<string, CleanupEntry>();
let shuttingDown = false;

export const registerCleanup = (id: string, fn: CleanupFn, opts?: { once?: boolean }): void => {
  entries.set(id, {
    id,
    fn,
    once: opts?.once ?? true,
  });
};

export const unregisterCleanup = (id: string): void => {
  entries.delete(id);
};

export const runAllCleanups = async (): Promise<void> => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  const pending = [...entries.values()];

  for (const entry of pending) {
    try {
      await entry.fn();
    } catch (error) {
      log.warn(`Cleanup "${entry.id}" failed:`, error);
    }

    if (entry.once) {
      entries.delete(entry.id);
    }
  }

  shuttingDown = false;
};

export const getCleanupCount = (): number => entries.size;
