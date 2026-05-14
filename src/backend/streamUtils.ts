/**
 * Shared utilities for parsing NDJSON stream output from Claude CLI and OpenCode.
 */

/** Truncate a string with ellipsis when it exceeds maxLength. */
export const truncate = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
};

/** Convert an unknown value into an Error instance. */
export const toError = (value: unknown): Error => {
  if (value instanceof Error) return value;
  return new Error(typeof value === 'string' ? value : JSON.stringify(value));
};

/** Strip BOM, null bytes, ANSI OSC sequences, and CSI escape codes from terminal output. */
export const sanitizeTerminalOutput = (value: string): string =>
  value
    .replace(/\ufeff/gu, '')
    .replace(/\u0000/gu, '')
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/gu, '')
    .replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|[@-Z\\-_])/gu, '')
    .trim();

/** Split raw NDJSON output into parsed objects, skipping unparseable lines. */
export const parseNdjsonLines = <T = unknown>(raw: string): T[] => {
  const results: T[] = [];

  for (const line of raw.split(/\r?\n/gu)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      results.push(JSON.parse(trimmed) as T);
    } catch {
      // Skip non-JSON lines
    }
  }

  return results;
};

/** Extract all text parts from NDJSON stream events (assistant text, result events). */
export const extractTextFromNdjson = (raw: string): string[] => {
  const parts: string[] = [];

  for (const line of raw.split(/\r?\n/gu)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const event = JSON.parse(trimmed) as {
        type?: string;
        result?: string;
        part?: { type?: string; text?: string };
        message?: { content?: Array<{ type?: string; text?: string }> };
      };

      if (typeof event.result === 'string' && event.result.trim()) {
        parts.push(event.result.trim());
      }

      if ((event.type === 'text' || event.part?.type === 'text') && typeof event.part?.text === 'string') {
        parts.push(event.part.text);
      }

      if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
        for (const content of event.message.content) {
          if (content.type === 'text' && typeof content.text === 'string' && content.text.trim()) {
            parts.push(content.text.trim());
          }
        }
      }
    } catch {
      // Skip non-JSON lines
    }
  }

  return parts;
};

/** Collect all balanced `{...}` substrings from a raw string. */
export const collectBalancedJsonObjectCandidates = (raw: string): string[] => {
  const candidates: string[] = [];

  for (let start = 0; start < raw.length; start += 1) {
    if (raw[start] !== '{') {
      continue;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < raw.length; index += 1) {
      const character = raw[index];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }

        if (character === '\\') {
          escaped = true;
          continue;
        }

        if (character === '"') {
          inString = false;
        }

        continue;
      }

      if (character === '"') {
        inString = true;
        continue;
      }

      if (character === '{') {
        depth += 1;
      } else if (character === '}') {
        depth -= 1;
      }

      if (depth === 0) {
        candidates.push(raw.slice(start, index + 1));
        break;
      }
    }
  }

  return candidates;
};

/** Extract a valid JSON object from raw model output that may contain surrounding text. */
export const parseJsonObject = (raw: string): unknown => {
  const trimmed = raw.trim();
  const candidates = [trimmed];
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  candidates.push(...collectBalancedJsonObjectCandidates(trimmed));

  for (const candidate of new Set(candidates.map((c) => c.trim()).filter(Boolean))) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error('Unable to extract a valid JSON object from model output.');
};
