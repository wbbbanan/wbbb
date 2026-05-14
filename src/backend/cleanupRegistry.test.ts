import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerCleanup, unregisterCleanup, runAllCleanups, getCleanupCount } from './cleanupRegistry';

describe('cleanupRegistry', () => {
  beforeEach(() => {
    // Reset state by unregistering all
    for (let i = 0; i < getCleanupCount(); i++) {
      unregisterCleanup(`test-${i}`);
    }
    unregisterCleanup('a');
    unregisterCleanup('b');
    unregisterCleanup('once');
  });

  it('registers and counts cleanups', () => {
    registerCleanup('a', () => {});
    registerCleanup('b', () => {});
    expect(getCleanupCount()).toBeGreaterThanOrEqual(2);
  });

  it('runs all registered cleanups', async () => {
    const fnA = vi.fn();
    const fnB = vi.fn();
    registerCleanup('test-0', fnA);
    registerCleanup('test-1', fnB);
    await runAllCleanups();
    expect(fnA).toHaveBeenCalledOnce();
    expect(fnB).toHaveBeenCalledOnce();
  });

  it('removes once cleanups after execution', async () => {
    const fn = vi.fn();
    registerCleanup('once', fn, { once: true });
    await runAllCleanups();
    expect(fn).toHaveBeenCalledOnce();
  });

  it('unregisters a specific cleanup', () => {
    registerCleanup('a', () => {});
    unregisterCleanup('a');
  });

  it('handles async cleanup functions', async () => {
    const order: number[] = [];
    registerCleanup('test-0', async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push(1);
    });
    registerCleanup('test-1', () => {
      order.push(2);
    });
    await runAllCleanups();
    expect(order).toEqual([1, 2]);
  });

  it('continues if a cleanup throws', async () => {
    const fnB = vi.fn();
    registerCleanup('test-0', () => {
      throw new Error('boom');
    });
    registerCleanup('test-1', fnB);
    await runAllCleanups();
    expect(fnB).toHaveBeenCalledOnce();
  });
});
