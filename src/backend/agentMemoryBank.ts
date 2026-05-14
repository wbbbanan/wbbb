import type { AgentMemoryEntry } from '../shared/ipc';

export interface MemoryBank {
  entries: AgentMemoryEntry[];
  maxEntries: number;
}

export function createMemoryBank(maxEntries = 20): MemoryBank {
  return { entries: [], maxEntries };
}

export function upsertMemory(
  bank: MemoryBank,
  partial: Omit<AgentMemoryEntry, 'createdAt' | 'updatedAt'>,
): AgentMemoryEntry {
  const now = new Date().toISOString();
  const existingIndex = bank.entries.findIndex((e) => e.key === partial.key);

  if (existingIndex >= 0) {
    const updated: AgentMemoryEntry = {
      ...bank.entries[existingIndex],
      value: partial.value,
      updatedAt: now,
    };
    bank.entries[existingIndex] = updated;
    return updated;
  }

  const entry: AgentMemoryEntry = {
    ...partial,
    createdAt: now,
    updatedAt: now,
  };

  bank.entries.push(entry);

  if (bank.entries.length > bank.maxEntries) {
    bank.entries.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    bank.entries.shift();
  }

  return entry;
}

export function renderMemoryBlock(bank: MemoryBank, maxChars = 2_000): string {
  if (bank.entries.length === 0) {
    return '';
  }

  const lines = bank.entries.map((e) => `- ${e.key}: ${e.value}`);
  let block = `【跨步骤持久化记忆库】\n${lines.join('\n')}`;

  if (block.length > maxChars) {
    let kept = bank.entries.length;
    while (kept > 0) {
      const subset = bank.entries.slice(-kept);
      const subsetBlock = `【跨步骤持久化记忆库】\n${subset.map((e) => `- ${e.key}: ${e.value}`).join('\n')}`;
      if (subsetBlock.length <= maxChars) {
        block = subsetBlock;
        break;
      }
      kept -= 1;
    }
  }

  return block;
}
