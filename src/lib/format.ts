import type { WorkflowActivityItem, WorkflowActivitySource, WorkflowEvent } from '../shared/ipc';
import { truncate } from '../backend/streamUtils';
import { detailLabels } from './constants';

/** Truncate a string with ellipsis. */
export const snippet = (value: string, maxLength = 320): string => truncate(value, maxLength);

/** Convert an unknown value into an Error instance. */
export const toError = (value: unknown): Error => {
  if (value instanceof Error) return value;
  return new Error(typeof value === 'string' ? value : JSON.stringify(value));
};

/** Convert an unknown error into a user-visible string. */
export const toErrorMessage = (value: unknown): string => {
  if (value instanceof Error) return value.message;
  return typeof value === 'string' ? value : '发生未知错误。';
};

/** Format a detail value for display (arrays, objects, primitives). */
const formatDetailValue = (value: unknown): string => {
  if (Array.isArray(value)) return value.map((item) => String(item)).join('\n');
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
};

/** Type guard for WorkflowActivityItem. */
const isWorkflowActivityItem = (value: unknown): value is WorkflowActivityItem => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<WorkflowActivityItem>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.source === 'string' &&
    typeof candidate.role === 'string' &&
    typeof candidate.kind === 'string' &&
    typeof candidate.label === 'string'
  );
};

/** Extract activity trace from event details. Prefers camelCase field, falls back to snake_case for legacy data. */
export const getActivityTrace = (details?: Record<string, unknown>): WorkflowActivityItem[] => {
  const candidate = details?.activityTrace ?? details?.activity_trace;
  if (!Array.isArray(candidate)) return [];
  return candidate.filter(isWorkflowActivityItem);
};

/** Build display-ready detail entries, excluding specified keys. */
export const getDetailEntries = (
  details?: Record<string, unknown>,
  options?: { excludeKeys?: string[] },
): Array<{ key: string; label: string; value: string }> => {
  if (!details) return [];

  const excludedKeys = new Set(options?.excludeKeys ?? []);

  return Object.entries(details)
    .filter(([key]) => !excludedKeys.has(key))
    .filter(([, value]) => {
      if (typeof value === 'undefined' || value === null) return false;
      if (typeof value === 'string') return value.trim().length > 0;
      if (Array.isArray(value)) return value.length > 0;
      return true;
    })
    .map(([key, value]) => ({
      key,
      label: detailLabels[key] ?? key,
      value: formatDetailValue(value),
    }));
};

/** Flatten activity traces from a list of events into a single timeline. Prefers camelCase field, falls back to snake_case. */
const isInternalInstruction = (text: string): boolean => {
  const trimmed = text.trim();
  return trimmed.startsWith('{') && /"(action|status|score|summary|failed_reasons)"\s*:/u.test(trimmed);
};

export const flattenActivityTrace = (
  events: WorkflowEvent[],
  options?: { source?: WorkflowActivitySource },
): WorkflowActivityItem[] => {
  if (!Array.isArray(events)) return [];
  const allItems: WorkflowActivityItem[] = [];
  const chronologicalEvents = [...events].reverse();
  for (const event of chronologicalEvents) {
    if (!event || typeof event !== 'object') continue;
    try {
      const trace =
        event.activityTrace ??
        event.activity_trace ??
        getActivityTrace(event.details);
      if (trace && trace.length > 0) {
        // Filter out internal coordinator instructions
        const filteredTrace = trace.filter(
          (item) => {
            if (item.kind === 'message' && item.text && isInternalInstruction(item.text)) {
              return false;
            }

            if (options?.source && item.source !== options.source) {
              return false;
            }

            return true;
          }
        );
        allItems.push(...filteredTrace);
      } else {
        const text = event.message ?? '';
        if (!isInternalInstruction(text) && !options?.source) {
          allItems.push({
            id: event.eventId ?? `evt-${allItems.length}`,
            source: 'system',
            role: 'system',
            kind: 'message',
            label: event.title ?? '',
            text,
            timestamp: event.timestamp ?? '',
          } as WorkflowActivityItem);
        }
      }
    } catch {
      // Skip malformed events
    }
  }
  return allItems;
};
