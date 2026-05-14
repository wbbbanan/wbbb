import type { WorkflowActivityItem } from '../shared/ipc';

export interface OpencodeJsonEvent {
  type?: string;
  timestamp?: number;
  result?: string;
  part?: {
    id?: string;
    type?: string;
    text?: string;
    reason?: string;
    tool?: string;
    callID?: string;
    cost?: number;
    tokens?: {
      total?: number;
      input?: number;
      output?: number;
      reasoning?: number;
    };
    state?: {
      status?: string;
      input?: unknown;
      output?: unknown;
      metadata?: Record<string, unknown>;
      time?: {
        start?: number;
        end?: number;
      };
    };
  };
}

export interface ClaudeStreamContent {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
}

export interface ClaudeStreamEvent {
  type?: string;
  subtype?: string;
  timestamp?: string;
  uuid?: string;
  message?: {
    id?: string;
    role?: string;
    content?: ClaudeStreamContent[];
  };
  result?: string;
  duration_ms?: number;
  num_turns?: number;
  total_cost_usd?: number;
  stop_reason?: string | null;
  tool_use_result?: {
    type?: string;
    file?: {
      filePath?: string;
      content?: string;
      numLines?: number;
      startLine?: number;
      totalLines?: number;
    };
  };
}

export interface ClaudeExecutionDetails {
  summary: string;
  activityTrace: WorkflowActivityItem[];
  durationMs?: number;
  totalCostUsd?: number;
  totalTurns?: number;
}

export interface OpencodeStreamDetails {
  reasoning: string[];
  text: string[];
}