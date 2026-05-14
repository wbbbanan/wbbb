import { describe, it, expect } from 'vitest';
import { createMemoryBank, upsertMemory, renderMemoryBlock } from './agentMemoryBank';

describe('createMemoryBank', () => {
  it('creates an empty bank with default maxEntries', () => {
    const bank = createMemoryBank();
    expect(bank.entries).toEqual([]);
    expect(bank.maxEntries).toBe(20);
  });

  it('creates a bank with custom maxEntries', () => {
    const bank = createMemoryBank(5);
    expect(bank.maxEntries).toBe(5);
  });
});

describe('upsertMemory', () => {
  it('inserts a new memory entry', () => {
    const bank = createMemoryBank();
    const entry = upsertMemory(bank, {
      key: 'react_version',
      value: 'React 18',
      createdByStepId: 1,
      createdByRole: 'coordinator',
    });

    expect(bank.entries).toHaveLength(1);
    expect(entry.key).toBe('react_version');
    expect(entry.value).toBe('React 18');
    expect(entry.createdAt).toBe(entry.updatedAt);
  });

  it('updates an existing entry and preserves createdAt', () => {
    const bank = createMemoryBank();
    const first = upsertMemory(bank, {
      key: 'react_version',
      value: 'React 18',
      createdByStepId: 1,
      createdByRole: 'coordinator',
    });

    const second = upsertMemory(bank, {
      key: 'react_version',
      value: 'React 18.2',
      createdByStepId: 2,
      createdByRole: 'coordinator',
    });

    expect(bank.entries).toHaveLength(1);
    expect(second.value).toBe('React 18.2');
    expect(second.createdAt).toBe(first.createdAt);
  });

  it('evicts oldest entry when maxEntries exceeded', () => {
    const bank = createMemoryBank(2);

    upsertMemory(bank, { key: 'a', value: '1', createdByStepId: 1, createdByRole: 'r1' });
    upsertMemory(bank, { key: 'b', value: '2', createdByStepId: 1, createdByRole: 'r1' });
    upsertMemory(bank, { key: 'c', value: '3', createdByStepId: 1, createdByRole: 'r1' });

    expect(bank.entries).toHaveLength(2);
    expect(bank.entries.map((e) => e.key)).toContain('b');
    expect(bank.entries.map((e) => e.key)).toContain('c');
    expect(bank.entries.map((e) => e.key)).not.toContain('a');
  });
});

describe('renderMemoryBlock', () => {
  it('returns empty string for empty bank', () => {
    const bank = createMemoryBank();
    expect(renderMemoryBlock(bank)).toBe('');
  });

  it('renders entries as markdown-like list', () => {
    const bank = createMemoryBank();
    upsertMemory(bank, { key: 'k1', value: 'v1', createdByStepId: 1, createdByRole: 'r' });
    upsertMemory(bank, { key: 'k2', value: 'v2', createdByStepId: 1, createdByRole: 'r' });

    const block = renderMemoryBlock(bank);
    expect(block).toContain('k1: v1');
    expect(block).toContain('k2: v2');
  });

  it('truncates to maxChars by dropping oldest entries', () => {
    const bank = createMemoryBank();
    upsertMemory(bank, { key: 'old', value: 'old_value', createdByStepId: 1, createdByRole: 'r' });
    upsertMemory(bank, { key: 'new', value: 'new_value', createdByStepId: 1, createdByRole: 'r' });

    const block = renderMemoryBlock(bank, 30);
    expect(block).toContain('new: new_value');
    expect(block).not.toContain('old: old_value');
  });
});
