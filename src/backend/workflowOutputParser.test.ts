import { describe, it, expect } from 'vitest';
import type { WorkflowActivityItem } from '../shared/ipc';
import {
  extractTouchedFilesFromActivityTrace,
  extractWorkflowChangePreview,
  formatActivityPayload,
  stripMarkdownCodeFence,
  parseStructuredOpencodeOutput,
  extractOpencodeActivityTrace,
  extractOpencodeStreamDetails,
  extractClaudeExecutionDetails,
  buildExecutionSummaryFromTrace,
  limitActivityTrace,
  extractOpencodeEventText,
} from './workflowOutputParser';

describe('workflowOutputParser', () => {
  describe('formatActivityPayload', () => {
    it('returns undefined for undefined', () => {
      expect(formatActivityPayload(undefined)).toBeUndefined();
    });

    it('returns undefined for null', () => {
      expect(formatActivityPayload(null)).toBeUndefined();
    });

    it('returns undefined for empty string', () => {
      expect(formatActivityPayload('')).toBeUndefined();
    });

    it('returns undefined for whitespace-only string', () => {
      expect(formatActivityPayload('   ')).toBeUndefined();
    });

    it('returns trimmed string for non-empty string', () => {
      expect(formatActivityPayload('  hello  ')).toBe('hello');
    });

    it('truncates long strings', () => {
      const long = 'a'.repeat(3000);
      const result = formatActivityPayload(long);
      expect(result).toBeTruthy();
      expect(result!.length).toBeLessThanOrEqual(2000);
    });

    it('serializes objects to JSON with truncation', () => {
      const obj = { key: 'value', nested: { a: 1 } };
      const result = formatActivityPayload(obj);
      expect(result).toContain('"key"');
    });

    it('falls back to String for non-serializable objects', () => {
      const obj = { a: BigInt(1) };
      const result = formatActivityPayload(obj, 100);
      expect(result).toBeDefined();
    });
  });

  describe('stripMarkdownCodeFence', () => {
    it('removes code fence with language', () => {
      expect(stripMarkdownCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
    });

    it('peels nested code fences', () => {
      expect(stripMarkdownCodeFence('```json\n```json\n{"a":1}\n```\n```')).toBe('{"a":1}');
    });

    it('removes code fence without language', () => {
      expect(stripMarkdownCodeFence('```\nhello\n```')).toBe('hello');
    });

    it('handles no code fence', () => {
      expect(stripMarkdownCodeFence('plain text')).toBe('plain text');
    });

    it('trims whitespace', () => {
      expect(stripMarkdownCodeFence('  hello  ')).toBe('hello');
    });
  });

  describe('parseStructuredOpencodeOutput', () => {
    it('parses valid JSON', () => {
      const result = parseStructuredOpencodeOutput('{"status":"approved","score":9}');
      expect(result).toEqual({ status: 'approved', score: 9 });
    });

    it('handles JSON embedded in text', () => {
      const input = 'Here is the result:\n```json\n{"status":"approved"}\n```\nDone.';
      const result = parseStructuredOpencodeOutput(input);
      expect(result).toEqual({ status: 'approved' });
    });

    it('parses result-event JSON wrapped in nested code fences', () => {
      const input = `\ufeff${JSON.stringify({ type: 'result', result: '```json\n```json\n{"status":"approved","score":9}\n```\n```' })}`;
      const result = parseStructuredOpencodeOutput(input);
      expect(result).toEqual({ status: 'approved', score: 9 });
    });

    it('parses JSON split across multiple text events with trailing noise', () => {
      const input = [
        JSON.stringify({ type: 'text', part: { type: 'text', text: '{"status":"approved",' } }),
        JSON.stringify({ type: 'text', part: { type: 'text', text: '"score":9}' } }),
        JSON.stringify({ type: 'text', part: { type: 'text', text: 'done' } }),
      ].join('\n');
      const result = parseStructuredOpencodeOutput(input);
      expect(result).toEqual({ status: 'approved', score: 9 });
    });

    it('throws on invalid JSON', () => {
      expect(() => parseStructuredOpencodeOutput('not json at all')).toThrow();
    });
  });

  describe('extractOpencodeActivityTrace', () => {
    it('parses text event', () => {
      const stream = JSON.stringify({ type: 'text', part: { id: 'p1', type: 'text', text: 'Hello' } });
      const result = extractOpencodeActivityTrace(stream);
      expect(result).toHaveLength(1);
      expect(result[0].kind).toBe('message');
      expect(result[0].text).toBe('Hello');
    });

    it('parses reasoning event', () => {
      const stream = JSON.stringify({ type: 'reasoning', part: { id: 'p2', type: 'reasoning', text: 'Thinking...' } });
      const result = extractOpencodeActivityTrace(stream);
      expect(result).toHaveLength(1);
      expect(result[0].kind).toBe('thinking');
    });

    it('parses tool_use event', () => {
      const stream = JSON.stringify({ type: 'tool_use', part: { id: 'p3', type: 'tool', tool: 'Read', callID: 'c1', state: { status: 'completed', input: 'file.ts', output: 'content', time: { start: 1000, end: 2000 } } } });
      const result = extractOpencodeActivityTrace(stream);
      expect(result).toHaveLength(2);
      expect(result[0].kind).toBe('tool_use');
      expect(result[0].toolName).toBe('Read');
      expect(result[1].kind).toBe('tool_result');
    });

    it('parses step_start and step_finish events', () => {
      const stream = [
        JSON.stringify({ type: 'step_start', part: { id: 's1' } }),
        JSON.stringify({ type: 'step_finish', part: { id: 's2', reason: 'done' } }),
      ].join('\n');
      const result = extractOpencodeActivityTrace(stream);
      expect(result).toHaveLength(2);
      expect(result[0].kind).toBe('step_start');
      expect(result[1].kind).toBe('step_finish');
    });

    it('handles empty input', () => {
      expect(extractOpencodeActivityTrace('')).toEqual([]);
    });

    it('handles malformed JSON lines gracefully', () => {
      const stream = 'not json\n' + JSON.stringify({ type: 'text', part: { id: 'p1', type: 'text', text: 'valid' } });
      const result = extractOpencodeActivityTrace(stream);
      expect(result).toHaveLength(1);
    });

    it('truncates traces with a head-tail strategy once they exceed the higher threshold', () => {
      const lines = Array.from({ length: 150 }, (_, i) =>
        JSON.stringify({ type: 'text', part: { id: `p${i}`, type: 'text', text: `Item ${i}` } })
      );
      const result = extractOpencodeActivityTrace(lines.join('\n'));
      expect(result).toHaveLength(61);
      expect(result[0].id).toBe('p0');
      expect(result[29].id).toBe('p29');
      expect(result[30].kind).toBe('result');
      expect(result[31].id).toBe('p120');
      expect(result[result.length - 1].id).toBe('p149');
    });
  });

  describe('extractOpencodeStreamDetails', () => {
    it('splits activity trace into reasoning and text', () => {
      const trace = [
        { id: '1', source: 'opencode' as const, role: 'assistant' as const, kind: 'thinking' as const, label: 'think', text: 'reason1' },
        { id: '2', source: 'opencode' as const, role: 'assistant' as const, kind: 'message' as const, label: 'msg', text: 'text1' },
        { id: '3', source: 'opencode' as const, role: 'assistant' as const, kind: 'thinking' as const, label: 'think2', text: 'reason2' },
      ];
      const details = extractOpencodeStreamDetails(trace);
      expect(details.reasoning).toEqual(['reason1', 'reason2']);
      expect(details.text).toEqual(['text1']);
    });

    it('returns empty arrays for empty input', () => {
      const details = extractOpencodeStreamDetails([]);
      expect(details.reasoning).toEqual([]);
      expect(details.text).toEqual([]);
    });
  });

  describe('extractClaudeExecutionDetails', () => {
    it('parses assistant message with text', () => {
      const stream = JSON.stringify({
        type: 'assistant',
        message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'Hello world' }] },
      });
      const details = extractClaudeExecutionDetails(stream);
      expect(details.summary).toContain('Hello world');
      expect(details.activityTrace.length).toBeGreaterThan(0);
    });

    it('parses result event with cost and duration', () => {
      const stream = JSON.stringify({
        type: 'result',
        result: 'Task completed',
        duration_ms: 5000,
        total_cost_usd: 0.05,
        num_turns: 2,
      });
      const details = extractClaudeExecutionDetails(stream);
      expect(details.durationMs).toBe(5000);
      expect(details.totalCostUsd).toBe(0.05);
      expect(details.totalTurns).toBe(2);
    });

    it('handles empty input', () => {
      const details = extractClaudeExecutionDetails('');
      expect(details.summary).toBe('');
      expect(details.activityTrace).toEqual([]);
    });

    it('parses tool_use event', () => {
      const stream = JSON.stringify({
        type: 'assistant',
        message: { id: 'm1', role: 'assistant', content: [{ type: 'tool_use', id: 'call1', name: 'Bash', input: { command: 'ls' } }] },
      });
      const details = extractClaudeExecutionDetails(stream);
      expect(details.activityTrace.some(a => a.kind === 'tool_use')).toBe(true);
    });
  });

  describe('buildExecutionSummaryFromTrace', () => {
    it('returns tool names when present', () => {
      const trace = [
        { id: '1', source: 'claude' as const, role: 'assistant' as const, kind: 'tool_use' as const, label: 'claude', toolName: 'Bash' },
        { id: '2', source: 'claude' as const, role: 'assistant' as const, kind: 'tool_use' as const, label: 'claude2', toolName: 'Read' },
      ];
      expect(buildExecutionSummaryFromTrace(trace)).toContain('Bash');
      expect(buildExecutionSummaryFromTrace(trace)).toContain('Read');
    });

    it('returns empty string for no tools', () => {
      expect(buildExecutionSummaryFromTrace([{ id: '1', source: 'claude', role: 'assistant', kind: 'message', label: 'msg' }])).toBe('');
    });
  });

  describe('extractTouchedFilesFromActivityTrace', () => {
    it('collects unique touched files from tool input and diff output', () => {
      const trace: WorkflowActivityItem[] = [
        {
          id: 'call-1',
          source: 'claude',
          role: 'assistant',
          kind: 'tool_use',
          label: 'Claude 调用 Edit',
          toolName: 'Edit',
          input: '{\n  "file_path": "src/app.tsx",\n  "old_str": "old",\n  "new_str": "new"\n}',
        },
        {
          id: 'call-2',
          source: 'opencode',
          role: 'assistant',
          kind: 'tool_use',
          label: 'OpenCode 调用 Read',
          toolName: 'Read',
          input: 'src/lib/format.ts',
        },
        {
          id: 'result-1',
          source: 'claude',
          role: 'user',
          kind: 'tool_result',
          label: 'Claude 工具结果 Bash',
          toolName: 'Bash',
          output: 'diff --git a/src/app.tsx b/src/app.tsx\n--- a/src/app.tsx\n+++ b/src/app.tsx\n@@ -1 +1 @@\n-old\n+new',
        },
      ];

      expect(extractTouchedFilesFromActivityTrace(trace)).toEqual(['src/app.tsx', 'src/lib/format.ts']);
    });
  });

  describe('extractWorkflowChangePreview', () => {
    it('prefers unified diff previews when available', () => {
      const trace: WorkflowActivityItem[] = [
        {
          id: 'result-1',
          source: 'claude',
          role: 'user',
          kind: 'tool_result',
          label: 'Claude 工具结果 Bash',
          toolName: 'Bash',
          output: 'diff --git a/src/features/chat/ChatView.tsx b/src/features/chat/ChatView.tsx\n--- a/src/features/chat/ChatView.tsx\n+++ b/src/features/chat/ChatView.tsx\n@@ -1 +1 @@\n-old\n+new',
        },
      ];

      const preview = extractWorkflowChangePreview({ activityTrace: trace, executionSummary: 'Updated ChatView output tab.' });

      expect(preview.format).toBe('diff');
      expect(preview.preview).toContain('diff --git');
      expect(preview.touchedFiles).toEqual(['src/features/chat/ChatView.tsx']);
    });

    it('falls back to a text preview when no diff is available', () => {
      const trace: WorkflowActivityItem[] = [
        {
          id: 'call-1',
          source: 'claude',
          role: 'assistant',
          kind: 'tool_use',
          label: 'Claude 调用 Write',
          toolName: 'Write',
          input: '{\n  "path": "src/backend/workflowOutputParser.ts"\n}',
        },
      ];

      const preview = extractWorkflowChangePreview({
        activityTrace: trace,
        executionSummary: 'Added a backend helper for extracting touched files and change previews.',
      });

      expect(preview.format).toBe('text');
      expect(preview.preview).toContain('src/backend/workflowOutputParser.ts');
      expect(preview.preview).toContain('Added a backend helper');
    });
  });

  describe('limitActivityTrace', () => {
    it('returns items as-is when within limit', () => {
      const items = Array.from({ length: 10 }, (_, i) => ({ id: `${i}`, source: 'opencode' as const, role: 'assistant' as const, kind: 'message' as const, label: `item${i}` }));
      expect(limitActivityTrace(items, 'opencode')).toHaveLength(10);
    });

    it('keeps head and tail windows with a truncation marker in the middle', () => {
      const items = Array.from({ length: 150 }, (_, i) => ({ id: `${i}`, source: 'opencode' as const, role: 'assistant' as const, kind: 'message' as const, label: `item${i}` }));
      const result = limitActivityTrace(items, 'opencode');
      expect(result).toHaveLength(61);
      expect(result[30].kind).toBe('result');
      expect(result[30].text).toContain('前 30 条');
      expect(result[30].text).toContain('后 30 条');
      expect(result[31].id).toBe('120');
      expect(result[result.length - 1].id).toBe('149');
    });

    it('preserves critical result and tool error entries from the middle section', () => {
      const items: WorkflowActivityItem[] = Array.from({ length: 150 }, (_, i) => ({
        id: `${i}`,
        source: 'claude' as const,
        role: 'assistant' as const,
        kind: 'message' as const,
        label: `item${i}`,
      }));
      items[60] = { id: 'critical-result', source: 'claude', role: 'system', kind: 'result', label: 'critical result' };
      items[90] = {
        id: 'critical-error',
        source: 'claude',
        role: 'user',
        kind: 'tool_result',
        label: 'critical error',
        toolStatus: 'error',
      };

      const result = limitActivityTrace(items, 'claude');

      expect(result.some((item) => item.id === 'critical-result')).toBe(true);
      expect(result.some((item) => item.id === 'critical-error')).toBe(true);
      expect(result[30].text).toContain('关键结果/错误');
    });
  });

  describe('extractOpencodeEventText', () => {
    it('extracts text from NDJSON stream', () => {
      const stream = JSON.stringify({ type: 'text', part: { type: 'text', text: 'Hello world' } });
      const result = extractOpencodeEventText(stream);
      expect(result).toBeTruthy();
    });

    it('extracts result-event text and removes nested code fences', () => {
      const stream = JSON.stringify({ type: 'result', result: '```json\n```json\n{"status":"approved"}\n```\n```' });
      expect(extractOpencodeEventText(stream)).toBe('{"status":"approved"}');
    });

    it('returns null for empty stream', () => {
      expect(extractOpencodeEventText('')).toBeNull();
    });

    it('returns null for non-text events', () => {
      const stream = JSON.stringify({ type: 'tool_use', part: { type: 'tool', tool: 'ls' } });
      expect(extractOpencodeEventText(stream)).toBeNull();
    });
  });
});