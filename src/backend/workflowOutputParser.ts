import type { WorkflowActivityItem } from '../shared/ipc';
import type {
  ClaudeExecutionDetails,
  ClaudeStreamEvent,
  OpencodeJsonEvent,
  OpencodeStreamDetails,
} from './streamEvents';
import { MAX_ACTIVITY_TRACE_ITEMS } from './workflowHelpers';
import { collectBalancedJsonObjectCandidates, parseJsonObject, sanitizeTerminalOutput, truncate } from './streamUtils';

const MAX_ACTIVITY_TEXT_LENGTH = 2_500;
const MAX_ACTIVITY_PAYLOAD_LENGTH = 1_800;
const ACTIVITY_TRACE_HEAD_ITEMS = 30;
const ACTIVITY_TRACE_TAIL_ITEMS = 30;
const MAX_CHANGE_PREVIEW_LENGTH = 4_000;
const MAX_TOUCHED_FILES = 24;

const FILE_PATH_KEY_REGEX = /"(?:file|filePath|file_path|path|targetPath|target_path|relativePath|relative_path)"\s*:\s*"([^"\n]+)"/gu;
const FILE_PATH_TOKEN_REGEX = /(?:^|[\s("'`])((?:[A-Za-z]:)?(?:[\w.@-]+[\\/])+[\w.@-]+\.[A-Za-z0-9]{1,8}|[\w.@-]+\.(?:[cm]?ts|tsx|jsx?|json|md|css|scss|less|html|ps1|py|ya?ml|txt|sql|sh))(?=$|[\s)"'`,:])/gu;

export const formatActivityPayload = (value: unknown, maxLength = MAX_ACTIVITY_PAYLOAD_LENGTH): string | undefined => {
  if (typeof value === 'undefined' || value === null) {
    return undefined;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? truncate(trimmed, maxLength) : undefined;
  }

  try {
    return truncate(JSON.stringify(value, null, 2), maxLength);
  } catch {
    return truncate(String(value), maxLength);
  }
};

export const toIsoTimestamp = (value?: number): string | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  return new Date(value).toISOString();
};

export const stripMarkdownCodeFence = (value: string): string => {
  let current = value.trim();

  while (current.startsWith('```') && current.endsWith('```')) {
    const next = current.replace(/^```[^\n]*\n?/u, '').replace(/\n?```$/u, '').trim();

    if (next === current) {
      break;
    }

    current = next;
  }

  return current;
};

const collectOpencodeTextParts = (raw: string): string[] => {
  const textParts: string[] = [];

  for (const line of raw.split(/\r?\n/gu)) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    try {
      const event = JSON.parse(trimmed) as OpencodeJsonEvent;

      if (typeof event.result === 'string' && event.result.trim()) {
        textParts.push(stripMarkdownCodeFence(event.result));
      }

      if ((event.type === 'text' || event.part?.type === 'text') && typeof event.part?.text === 'string') {
        textParts.push(stripMarkdownCodeFence(event.part.text));
      }
    } catch {
      // Ignore non-JSON lines and fall back to the legacy parser.
    }
  }

  return textParts.map((part) => sanitizeTerminalOutput(part)).filter(Boolean);
};

const parseBalancedJsonCandidate = (raw: string): unknown | null => {
  const normalized = sanitizeTerminalOutput(raw);

  if (!normalized) {
    return null;
  }

  const candidates = collectBalancedJsonObjectCandidates(normalized)
    .map((candidate) => candidate.trim())
    .filter(Boolean)
    .reverse();

  for (const candidate of new Set(candidates)) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next balanced candidate.
    }
  }

  return null;
};

const isPinnedActivityItem = (item: WorkflowActivityItem): boolean => item.kind === 'result' || (item.kind === 'tool_result' && item.toolStatus === 'error');

const normalizePathCandidate = (raw: string): string | null => {
  const trimmed = raw.trim().replace(/^["'`]+|["'`]+$/gu, '').replace(/[),;:]+$/gu, '');

  if (!trimmed) {
    return null;
  }

  if (/^(?:https?:|[A-Za-z]+:\/\/)/u.test(trimmed)) {
    return null;
  }

  const normalized = trimmed.replace(/\\/gu, '/').replace(/^\.\//u, '').replace(/^(?:a|b)\/(.+)$/u, '$1');

  if (!/[/.]/u.test(normalized) || !/\.[A-Za-z0-9]{1,8}$/u.test(normalized)) {
    return null;
  }

  return normalized;
};

const collectPathsFromText = (value: string): string[] => {
  const matches: string[] = [];
  const seen = new Set<string>();

  const pushMatch = (candidate: string): void => {
    const normalized = normalizePathCandidate(candidate);

    if (!normalized || seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    matches.push(normalized);
  };

  for (const match of value.matchAll(FILE_PATH_KEY_REGEX)) {
    pushMatch(match[1]);
  }

  for (const match of value.matchAll(FILE_PATH_TOKEN_REGEX)) {
    pushMatch(match[1]);
  }

  return matches;
};

const extractDiffPreview = (value: string): string | null => {
  const fencedDiffMatch = value.match(/```diff\s*\n?([\s\S]*?)```/iu);

  if (fencedDiffMatch?.[1]) {
    return truncate(fencedDiffMatch[1].trim(), MAX_CHANGE_PREVIEW_LENGTH);
  }

  const normalized = sanitizeTerminalOutput(stripMarkdownCodeFence(value));

  if (!normalized) {
    return null;
  }

  const hasUnifiedDiffMarkers =
    /^diff --git /mu.test(normalized) ||
    (/^--- [^\n]+$/mu.test(normalized) && /^\+\+\+ [^\n]+$/mu.test(normalized)) ||
    /^@@ /mu.test(normalized);

  if (!hasUnifiedDiffMarkers) {
    return null;
  }

  return truncate(normalized, MAX_CHANGE_PREVIEW_LENGTH);
};

const buildTextChangePreview = (
  touchedFiles: string[],
  executionSummary?: string,
  activityTrace: WorkflowActivityItem[] = [],
): string | null => {
  const lines: string[] = [];
  const normalizedSummary = executionSummary?.trim();
  const recentTools = [...new Set(activityTrace.filter((item) => item.kind === 'tool_use' && item.toolName).map((item) => item.toolName as string))].slice(0, 6);

  if (touchedFiles.length > 0) {
    lines.push('## 触碰文件');
    lines.push(...touchedFiles.map((file) => `- ${file}`));
  }

  if (recentTools.length > 0) {
    if (lines.length > 0) {
      lines.push('');
    }

    lines.push('## 最近工具调用');
    lines.push(...recentTools.map((tool) => `- ${tool}`));
  }

  if (normalizedSummary) {
    if (lines.length > 0) {
      lines.push('');
    }

    lines.push('## 执行摘要');
    lines.push(normalizedSummary);
  }

  if (lines.length === 0) {
    return null;
  }

  return truncate(lines.join('\n'), MAX_CHANGE_PREVIEW_LENGTH);
};

export interface WorkflowChangePreview {
  touchedFiles: string[];
  preview: string | null;
  format: 'diff' | 'text' | null;
}

export const extractTouchedFilesFromActivityTrace = (activityTrace: WorkflowActivityItem[]): string[] => {
  const files: string[] = [];
  const seen = new Set<string>();

  const addMatches = (value?: string): void => {
    if (!value) {
      return;
    }

    for (const candidate of collectPathsFromText(value)) {
      if (seen.has(candidate)) {
        continue;
      }

      seen.add(candidate);
      files.push(candidate);

      if (files.length >= MAX_TOUCHED_FILES) {
        return;
      }
    }
  };

  for (const item of activityTrace) {
    addMatches(item.input);

    if (files.length >= MAX_TOUCHED_FILES) {
      break;
    }

    addMatches(item.output);

    if (files.length >= MAX_TOUCHED_FILES) {
      break;
    }

    if (item.kind === 'message' && item.text) {
      addMatches(item.text);
    }

    if (files.length >= MAX_TOUCHED_FILES) {
      break;
    }
  }

  return files;
};

export const extractWorkflowChangePreview = (input: {
  activityTrace: WorkflowActivityItem[];
  rawOutput?: string;
  executionSummary?: string;
}): WorkflowChangePreview => {
  const touchedFiles = extractTouchedFilesFromActivityTrace(input.activityTrace);
  const textCandidates = input.activityTrace.flatMap((item) => [item.output, item.text, item.input]).filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  if (typeof input.rawOutput === 'string' && input.rawOutput.trim()) {
    textCandidates.push(input.rawOutput);
  }

  for (const candidate of textCandidates) {
    const preview = extractDiffPreview(candidate);

    if (preview) {
      return {
        touchedFiles,
        preview,
        format: 'diff',
      };
    }
  }

  const preview = buildTextChangePreview(touchedFiles, input.executionSummary, input.activityTrace);

  return {
    touchedFiles,
    preview,
    format: preview ? 'text' : null,
  };
};

export const parseStructuredOpencodeOutput = (raw: string): unknown => {
  const sanitizedRaw = sanitizeTerminalOutput(raw);
  const eventText = extractOpencodeEventText(sanitizedRaw);
  const normalizedTextParts = collectOpencodeTextParts(sanitizedRaw);

  if (eventText) {
    try {
      return parseJsonObject(eventText);
    } catch {
      // Fall through to the full stream so parseJsonObject can inspect any balanced JSON candidates there.
    }
  }

  if (normalizedTextParts.length > 0) {
    const combinedText = sanitizeTerminalOutput(normalizedTextParts.join('\n'));
    const balancedTextCandidate = parseBalancedJsonCandidate(combinedText);

    if (balancedTextCandidate !== null) {
      return balancedTextCandidate;
    }
  }

  const balancedStreamCandidate = parseBalancedJsonCandidate(sanitizedRaw);

  if (balancedStreamCandidate !== null) {
    return balancedStreamCandidate;
  }

  try {
    return JSON.parse(sanitizedRaw);
  } catch {
    // Fall back to the broader extractor below.
  }

  return parseJsonObject(sanitizedRaw);
};

export const extractOpencodeActivityTrace = (raw: string): WorkflowActivityItem[] => {
  const items: WorkflowActivityItem[] = [];

  for (const line of raw.split(/\r?\n/gu)) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    try {
      const event = JSON.parse(trimmed) as OpencodeJsonEvent;
      const timestamp = toIsoTimestamp(event.timestamp);

      if (event.type === 'step_start') {
        items.push({
          id: event.part?.id ?? `opencode-step-start-${items.length + 1}`,
          source: 'opencode',
          role: 'system',
          kind: 'step_start',
          label: 'OpenCode 步骤开始',
          text: '开始处理当前阶段。',
          timestamp,
        });
        continue;
      }

      if (event.type === 'reasoning') {
        const text = typeof event.part?.text === 'string' ? stripMarkdownCodeFence(event.part.text) : '';

        if (text) {
          items.push({
            id: event.part?.id ?? `opencode-thinking-${items.length + 1}`,
            source: 'opencode',
            role: 'assistant',
            kind: 'thinking',
            label: 'OpenCode 思考',
            text: truncate(text, MAX_ACTIVITY_TEXT_LENGTH),
            timestamp,
          });
        }

        continue;
      }

      if (event.type === 'text') {
        const text = typeof event.part?.text === 'string' ? stripMarkdownCodeFence(event.part.text) : '';

        if (text) {
          items.push({
            id: event.part?.id ?? `opencode-message-${items.length + 1}`,
            source: 'opencode',
            role: 'assistant',
            kind: 'message',
            label: 'OpenCode 输出',
            text: truncate(text, MAX_ACTIVITY_TEXT_LENGTH),
            timestamp,
          });
        }

        continue;
      }

      if (event.type === 'tool_use' && event.part?.type === 'tool') {
        const toolCallId = event.part.callID ?? event.part.id ?? `opencode-tool-${items.length + 1}`;
        const input = formatActivityPayload(event.part.state?.input);
        const output = formatActivityPayload(event.part.state?.output);
        const startedAt = event.part.state?.time?.start;
        const endedAt = event.part.state?.time?.end;

        items.push({
          id: `${toolCallId}:call`,
          source: 'opencode',
          role: 'assistant',
          kind: 'tool_use',
          label: `OpenCode 调用 ${event.part.tool ?? 'tool'}`,
          toolName: event.part.tool,
          toolCallId,
          toolStatus: 'running',
          input,
          timestamp: toIsoTimestamp(startedAt) ?? timestamp,
        });

        items.push({
          id: `${toolCallId}:result`,
          source: 'opencode',
          role: 'user',
          kind: 'tool_result',
          label: `OpenCode 工具结果 ${event.part.tool ?? 'tool'}`,
          toolName: event.part.tool,
          toolCallId,
          toolStatus: event.part.state?.status === 'error' ? 'error' : 'completed',
          output,
          timestamp: toIsoTimestamp(endedAt) ?? timestamp,
          durationMs:
            typeof startedAt === 'number' && typeof endedAt === 'number' && endedAt >= startedAt ? endedAt - startedAt : undefined,
          metadata: event.part.state?.metadata,
        });

        continue;
      }

      if (event.type === 'step_finish') {
        items.push({
          id: event.part?.id ?? `opencode-step-finish-${items.length + 1}`,
          source: 'opencode',
          role: 'system',
          kind: 'step_finish',
          label: 'OpenCode 步骤完成',
          text: event.part?.reason ? `结束原因：${event.part.reason}` : '当前阶段输出已完成。',
          timestamp,
          metadata:
            event.part?.tokens || typeof event.part?.cost === 'number'
              ? {
                  tokens: event.part.tokens,
                  cost: event.part.cost,
                }
              : undefined,
        });
      }
    } catch {
      // Ignore malformed event lines and keep scanning the stream.
    }
  }

  return limitActivityTrace(items, 'opencode');
};

export const extractOpencodeStreamDetails = (activityTrace: WorkflowActivityItem[]): OpencodeStreamDetails => {
  const details: OpencodeStreamDetails = {
    reasoning: [],
    text: [],
  };

  for (const entry of activityTrace) {
    if (entry.kind === 'thinking' && entry.text) {
      details.reasoning.push(entry.text);
      continue;
    }

    if (entry.kind === 'message' && entry.text) {
      details.text.push(entry.text);
    }
  }

  return details;
};

export const extractClaudeExecutionDetails = (rawOutput: string): ClaudeExecutionDetails => {
  const activityTrace: WorkflowActivityItem[] = [];
  const toolNameByCallId = new Map<string, string>();
  const finalTextParts: string[] = [];
  let durationMs: number | undefined;
  let totalCostUsd: number | undefined;
  let totalTurns: number | undefined;

  for (const line of rawOutput.split(/\r?\n/gu)) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    try {
      const event = JSON.parse(trimmed) as ClaudeStreamEvent;

      if (event.type === 'assistant') {
        for (const content of event.message?.content ?? []) {
          if (content.type === 'thinking' && typeof content.thinking === 'string') {
            activityTrace.push({
              id: content.id ?? event.uuid ?? `claude-thinking-${activityTrace.length + 1}`,
              source: 'claude',
              role: 'assistant',
              kind: 'thinking',
              label: 'Claude 思考',
              text: truncate(content.thinking.trim(), MAX_ACTIVITY_TEXT_LENGTH),
            });
            continue;
          }

          if (content.type === 'tool_use') {
            const toolCallId = content.id ?? `claude-tool-${activityTrace.length + 1}`;
            const toolName = content.name ?? 'tool';
            toolNameByCallId.set(toolCallId, toolName);
            activityTrace.push({
              id: `${toolCallId}:call`,
              source: 'claude',
              role: 'assistant',
              kind: 'tool_use',
              label: `Claude 调用 ${toolName}`,
              toolName,
              toolCallId,
              toolStatus: 'running',
              input: formatActivityPayload(content.input),
            });
            continue;
          }

          if (content.type === 'text' && typeof content.text === 'string') {
            const messageText = content.text.trim();

            if (!messageText) {
              continue;
            }

            // Skip internal instructions: coordinator dispatch, verification results, etc.
            if (messageText.startsWith('{') && /"(action|status|score|summary|failed_reasons)"\s*:/u.test(messageText)) {
              continue;
            }

            finalTextParts.push(messageText);
            activityTrace.push({
              id: content.id ?? event.uuid ?? `claude-message-${activityTrace.length + 1}`,
              source: 'claude',
              role: 'assistant',
              kind: 'message',
              label: 'Claude 输出',
              text: truncate(messageText, MAX_ACTIVITY_TEXT_LENGTH),
            });
          }
        }

        continue;
      }

      if (event.type === 'user') {
        for (const content of event.message?.content ?? []) {
          if (content.type !== 'tool_result') {
            continue;
          }

          const toolCallId = content.tool_use_id;
          const toolName = toolCallId ? toolNameByCallId.get(toolCallId) : undefined;
          const output =
            typeof content.content === 'string'
              ? truncate(content.content.trim(), MAX_ACTIVITY_TEXT_LENGTH)
              : formatActivityPayload(content.content, MAX_ACTIVITY_TEXT_LENGTH);

          activityTrace.push({
            id: `${toolCallId ?? `claude-tool-result-${activityTrace.length + 1}`}:result`,
            source: 'claude',
            role: 'user',
            kind: 'tool_result',
            label: `Claude 工具结果 ${toolName ?? 'tool'}`,
            toolName,
            toolCallId,
            toolStatus: 'completed',
            output,
            timestamp: event.timestamp,
            metadata: event.tool_use_result ? { tool_use_result: event.tool_use_result } : undefined,
          });
        }

        continue;
      }

      if (event.type === 'result') {
        durationMs = event.duration_ms;
        totalCostUsd = event.total_cost_usd;
        totalTurns = event.num_turns;
        activityTrace.push({
          id: event.uuid ?? `claude-result-${activityTrace.length + 1}`,
          source: 'claude',
          role: 'system',
          kind: 'result',
          label: 'Claude 运行结果',
          text: typeof event.result === 'string' && event.result.trim() ? truncate(event.result.trim(), MAX_ACTIVITY_TEXT_LENGTH) : undefined,
          durationMs: event.duration_ms,
          metadata: {
            stop_reason: event.stop_reason,
            total_turns: event.num_turns,
            total_cost_usd: event.total_cost_usd,
          },
        });
      }
    } catch {
      // Ignore malformed stream-json lines and fall back to the raw summary below.
    }
  }

  const summary =
    finalTextParts.join('\n\n').trim() ||
    buildExecutionSummaryFromTrace(activityTrace) ||
    sanitizeTerminalOutput(rawOutput);

  return {
    summary,
    activityTrace: limitActivityTrace(activityTrace, 'claude'),
    durationMs,
    totalCostUsd,
    totalTurns,
  };
};

export const buildExecutionSummaryFromTrace = (activityTrace: WorkflowActivityItem[]): string => {
  const toolNames = [...new Set(activityTrace.filter((item) => item.kind === 'tool_use' && item.toolName).map((item) => item.toolName as string))];

  if (toolNames.length === 0) {
    return '';
  }

  return `Claude 已完成工具调用：${toolNames.join(', ')}。`;
};

export const limitActivityTrace = (items: WorkflowActivityItem[], source: 'opencode' | 'claude'): WorkflowActivityItem[] => {
  if (items.length <= MAX_ACTIVITY_TRACE_ITEMS) {
    return items;
  }

  const headCount = Math.min(ACTIVITY_TRACE_HEAD_ITEMS, items.length);
  const tailStart = Math.max(headCount, items.length - ACTIVITY_TRACE_TAIL_ITEMS);
  const headIndexes = Array.from({ length: headCount }, (_, index) => index);
  const tailIndexes = Array.from({ length: items.length - tailStart }, (_, index) => tailStart + index);
  const middlePinnedIndexes: number[] = [];

  for (let index = 0; index < items.length; index += 1) {
    if (index >= headCount && index < tailStart && isPinnedActivityItem(items[index])) {
      middlePinnedIndexes.push(index);
    }
  }

  const orderedIndexes = [...headIndexes, ...middlePinnedIndexes, ...tailIndexes];
  const pinnedMiddleCount = middlePinnedIndexes.length;

  return [
    ...headIndexes.map((index) => items[index]),
    {
      id: `${source}-trace-truncated-${items.length}`,
      source: 'system',
      role: 'system',
      kind: 'result',
      label: '活动流已截断',
      text:
        pinnedMiddleCount > 0
          ? `当前阶段活动过多，已保留前 ${headCount} 条、后 ${items.length - tailStart} 条，并额外保留 ${pinnedMiddleCount} 条关键结果/错误，共 ${orderedIndexes.length}/${items.length} 条活动。`
          : `当前阶段活动过多，已保留前 ${headCount} 条和后 ${items.length - tailStart} 条，共 ${orderedIndexes.length}/${items.length} 条活动。`,
    },
    ...middlePinnedIndexes.map((index) => items[index]),
    ...tailIndexes.map((index) => items[index]),
  ];
};

export const extractOpencodeEventText = (raw: string): string | null => {
  const normalizedParts = collectOpencodeTextParts(raw);

  if (normalizedParts.length === 0) {
    return null;
  }

  const combined = sanitizeTerminalOutput(normalizedParts.join('\n'));

  if (combined) {
    try {
      parseJsonObject(combined);
      return combined;
    } catch {
      // Fall through to the more targeted tail slices below.
    }
  }

  for (let startIndex = normalizedParts.length - 1; startIndex >= 0; startIndex -= 1) {
    const candidate = sanitizeTerminalOutput(normalizedParts.slice(startIndex).join('\n'));

    if (!candidate) {
      continue;
    }

    try {
      parseJsonObject(candidate);
      return candidate;
    } catch {
      // Keep trimming older text parts until a JSON-bearing tail is found.
    }
  }

  return combined || null;
};