import { describe, it, expect } from 'vitest';
import {
  truncate,
  toError,
  sanitizeTerminalOutput,
  parseNdjsonLines,
  extractTextFromNdjson,
  collectBalancedJsonObjectCandidates,
  parseJsonObject,
} from './streamUtils';

describe('streamUtils', () => {
  describe('truncate', () => {
    it('returns string as-is when within limit', () => {
      expect(truncate('hello', 10)).toBe('hello');
    });

    it('truncates and adds ellipsis when exceeding limit', () => {
      expect(truncate('hello world', 5)).toBe('hello...');
    });

    it('handles exact length', () => {
      expect(truncate('hello', 5)).toBe('hello');
    });
  });

  describe('toError', () => {
    it('returns Error instances as-is', () => {
      const err = new Error('test');
      expect(toError(err)).toBe(err);
    });

    it('wraps strings in Error', () => {
      expect(toError('fail').message).toBe('fail');
    });

    it('wraps non-string values', () => {
      expect(toError(42).message).toBe('42');
    });
  });

  describe('sanitizeTerminalOutput', () => {
    it('strips UTF-8 BOM markers', () => {
      expect(sanitizeTerminalOutput('\ufeffhello')).toBe('hello');
    });

    it('strips null bytes', () => {
      expect(sanitizeTerminalOutput('hello\x00world')).toBe('helloworld');
    });

    it('strips ANSI OSC sequences', () => {
      expect(sanitizeTerminalOutput('\x1b]0;title\x07content')).toBe('content');
    });

    it('strips CSI escape codes', () => {
      expect(sanitizeTerminalOutput('\x1b[32mhello\x1b[0m')).toBe('hello');
    });

    it('trims whitespace', () => {
      expect(sanitizeTerminalOutput('  hello  ')).toBe('hello');
    });

    it('passes clean strings through', () => {
      expect(sanitizeTerminalOutput('clean')).toBe('clean');
    });
  });

  describe('parseNdjsonLines', () => {
    it('parses valid NDJSON', () => {
      const input = JSON.stringify({ a: 1 }) + '\n' + JSON.stringify({ b: 2 });
      const result = parseNdjsonLines(input);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ a: 1 });
      expect(result[1]).toEqual({ b: 2 });
    });

    it('skips invalid JSON lines', () => {
      const input = 'not json\n' + JSON.stringify({ a: 1 });
      const result = parseNdjsonLines<{ a: number }>(input);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ a: 1 });
    });

    it('skips empty lines', () => {
      const input = '\n\n';
      expect(parseNdjsonLines(input)).toEqual([]);
    });

    it('returns empty for empty string', () => {
      expect(parseNdjsonLines('')).toEqual([]);
    });
  });

  describe('extractTextFromNdjson', () => {
    it('extracts text from assistant messages', () => {
      const input = JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Hello world' }] },
      });
      expect(extractTextFromNdjson(input)).toContain('Hello world');
    });

    it('extracts result text', () => {
      const input = JSON.stringify({ type: 'result', result: 'Task done' });
      expect(extractTextFromNdjson(input)).toContain('Task done');
    });

    it('extracts part text', () => {
      const input = JSON.stringify({ type: 'text', part: { type: 'text', text: 'part content' } });
      expect(extractTextFromNdjson(input)).toContain('part content');
    });

    it('skips empty text', () => {
      const input = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '   ' }] } });
      expect(extractTextFromNdjson(input)).toEqual([]);
    });
  });

  describe('collectBalancedJsonObjectCandidates', () => {
    it('extracts balanced JSON objects', () => {
      const input = 'prefix {"a":1} suffix';
      const candidates = collectBalancedJsonObjectCandidates(input);
      expect(candidates).toContain('{"a":1}');
    });

    it('handles nested objects', () => {
      const input = '{"a":{"b":2},"c":3}';
      const candidates = collectBalancedJsonObjectCandidates(input);
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0]).toBe('{"a":{"b":2},"c":3}');
    });

    it('handles strings with braces inside', () => {
      const input = '{"text":"hello {world}"}';
      const candidates = collectBalancedJsonObjectCandidates(input);
      expect(candidates).toContain('{"text":"hello {world}"}');
    });

    it('returns empty array for no braces', () => {
      expect(collectBalancedJsonObjectCandidates('no json here')).toEqual([]);
    });
  });

  describe('parseJsonObject', () => {
    it('parses clean JSON', () => {
      expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
    });

    it('extracts JSON from surrounding text', () => {
      expect(parseJsonObject('Here is the result: {"status":"approved"} done')).toEqual({ status: 'approved' });
    });

    it('extracts JSON from markdown code fence', () => {
      const input = '```json\n{"score": 9}\n```';
      expect(parseJsonObject(input)).toEqual({ score: 9 });
    });

    it('throws on no valid JSON', () => {
      expect(() => parseJsonObject('no json here at all')).toThrow('Unable to extract');
    });

    it('handles nested objects', () => {
      const input = '{"plan":[{"step_id":1}], "current_step_id": 1}';
      const result = parseJsonObject(input);
      expect(result).toEqual({ plan: [{ step_id: 1 }], current_step_id: 1 });
    });
  });
});