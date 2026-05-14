import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger } from './logger';

describe('createLogger', () => {
  let consoleSpy: {
    debug: ReturnType<typeof vi.spyOn>;
    log: ReturnType<typeof vi.spyOn>;
    warn: ReturnType<typeof vi.spyOn>;
    error: ReturnType<typeof vi.spyOn>;
  };

  beforeEach(() => {
    consoleSpy = {
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a logger with the given module name', () => {
    const log = createLogger('TestModule');
    expect(log).toBeDefined();
    expect(typeof log.info).toBe('function');
    expect(typeof log.error).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.debug).toBe('function');
  });

  it('info() calls console.log with module prefix', () => {
    const log = createLogger('MyModule');
    log.info('hello');
    expect(consoleSpy.log).toHaveBeenCalledOnce();
    const arg = consoleSpy.log.mock.calls[0][0] as string;
    expect(arg).toContain('[MyModule]');
    expect(arg).toContain('hello');
  });

  it('error() calls console.error with module prefix', () => {
    const log = createLogger('ErrMod');
    log.error('bad things');
    expect(consoleSpy.error).toHaveBeenCalledOnce();
    const arg = consoleSpy.error.mock.calls[0][0] as string;
    expect(arg).toContain('[ErrMod]');
    expect(arg).toContain('bad things');
  });

  it('warn() calls console.warn with module prefix', () => {
    const log = createLogger('WarnMod');
    log.warn('careful');
    expect(consoleSpy.warn).toHaveBeenCalledOnce();
    const arg = consoleSpy.warn.mock.calls[0][0] as string;
    expect(arg).toContain('[WarnMod]');
    expect(arg).toContain('careful');
  });

  it('log messages contain ISO timestamp', () => {
    const log = createLogger('TS');
    log.info('test');
    const arg = consoleSpy.log.mock.calls[0][0] as string;
    // ISO timestamp format: 2026-05-12T...
    expect(arg).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('passes additional arguments to console', () => {
    const log = createLogger('Args');
    log.info('msg', { key: 'value' }, 42);
    expect(consoleSpy.log).toHaveBeenCalledTimes(1);
    const args = consoleSpy.log.mock.calls[0];
    expect(args[1]).toEqual({ key: 'value' });
    expect(args[2]).toBe(42);
  });
});
