import type { WorkflowPhase, WorkflowNodeStatus, WorkflowLifecycle, WorkflowSessionExecutionState } from '../shared/ipc';
import type { WorkflowSnapshot, RuntimeHealthSnapshot, WorkflowSessionSummary } from '../shared/ipc';

// ── Phase / Actor labels ──────────────────────────────────────────
export const phaseActorLabels: Record<WorkflowPhase, string> = {
  workflow: 'Orchestrator',
  planning: 'OpenCode',
  execution: 'Claude',
  verification: 'OpenCode',
  decision: 'Orchestrator',
  'circuit-breaker': 'Circuit Breaker',
  completed: 'Orchestrator',
};

export const phaseActorTones: Record<WorkflowPhase, string> = {
  workflow: 'text-[var(--text-muted)]',
  planning: 'text-[var(--text-muted)]',
  execution: 'text-[var(--text-muted)]',
  verification: 'text-[var(--text-muted)]',
  decision: 'text-[var(--text-muted)]',
  'circuit-breaker': 'text-[var(--text-muted)]',
  completed: 'text-[var(--text-muted)]',
};

/** Subtle left-border colors for agent turns in chat. */
export const phaseBorderColors: Record<WorkflowPhase, string> = {
  workflow: 'border-l-[#555555]',
  planning: 'border-l-[#5a7a9a]',
  execution: 'border-l-[#9a7a5a]',
  verification: 'border-l-[#5a7a9a]',
  decision: 'border-l-[#555555]',
  'circuit-breaker': 'border-l-[#555555]',
  completed: 'border-l-[#555555]',
};

/** Fallback border colors by agent source (when phase is empty). */
export const sourceBorderColors: Record<string, string> = {
  opencode: 'border-l-[#5a7a9a]',
  claude: 'border-l-[#9a7a5a]',
  system: 'border-l-[#555555]',
};

// ── Health status ─────────────────────────────────────────────────
export const healthStatusStyles: Record<RuntimeHealthSnapshot['overallStatus'], string> = {
  healthy: 'border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-[var(--text-secondary)]',
  warning: 'border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-[var(--text-secondary)]',
  error: 'border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-[var(--text-secondary)]',
};

export const healthStatusLabels: Record<RuntimeHealthSnapshot['overallStatus'], string> = {
  healthy: 'Healthy',
  warning: 'Warning',
  error: 'Error',
};

// ── Detail labels ─────────────────────────────────────────────────
export const detailLabels: Record<string, string> = {
  budget_cap_usd: 'Budget Cap',
  collaboration_agents: 'Collaboration Agents',
  collaboration_latest_summary: 'Latest Summary',
  collaboration_message_count: 'Message Count',
  collaboration_mode: 'Collaboration Mode',
  collaboration_roles: 'Suggested Roles',
  collaboration_session_id: 'Session ID',
  coordinator_prompt: 'Coordinator Prompt',
  execution_duration_ms: 'Execution Duration',
  execution_summary: 'Execution Summary',
  execution_turns: 'Execution Turns',
  fallback_reason: 'Fallback Reason',
  expanded_prompt: 'Expanded Prompt',
  failed_reasons: 'Failed Reasons',
  model_response: 'Model Response',
  next_instruction: 'Next Instruction',
  passing_score: 'Passing Score',
  prompt_override: 'Prompt Override',
  raw_output: 'Raw Output',
  remaining_budget_usd: 'Remaining Budget',
  reasoning_trace: 'Reasoning Trace',
  score: 'Score',
  session_cost_usd: 'Session Cost',
  stack: 'Stack Trace',
  step_description: 'Step Description',
  suggested_test_command: 'Test Command',
  total_cost_usd: 'Total Cost',
  verification_summary: 'Verification Summary',
};

// ── CSS class tokens ──────────────────────────────────────────────
export const panelClass =
  'rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-[var(--text-primary)]';

export const sectionClass = 'rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-[var(--text-primary)]';

export const surfaceCardClass = 'rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-overlay)] text-[var(--text-primary)]';

export const controlInputClass =
  'w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-input)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-muted)] focus:border-[var(--border-muted)]';

export const controlTextAreaClass =
  'w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-input)] px-3 py-3 text-sm leading-6 text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-muted)] focus:border-[var(--border-muted)]';

export const secondaryButtonClass =
  'rounded-md border border-[var(--border-subtle)] bg-[var(--surface-overlay)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)] disabled:opacity-40';

export const primaryButtonClass =
  'rounded-md bg-[var(--surface-overlay)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition hover:bg-[var(--surface-elevated)] disabled:opacity-40';

export const accentButtonClass =
  'rounded-md border border-[var(--border-subtle)] bg-[var(--surface-overlay)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)] disabled:opacity-40';

export const sectionHeadingClass = 'text-sm font-medium text-[var(--text-secondary)]';

export const sectionHintClass = 'mt-1 text-xs text-[var(--text-muted)]';

// ── Empty / default states ────────────────────────────────────────
export const emptySnapshot: WorkflowSnapshot = {
  runId: null,
  lifecycle: 'idle',
  currentPhase: 'workflow',
  executionSubState: null,
  currentStepId: 0,
  currentRetryCount: 0,
  stepRepairAttempts: 0,
  totalRepairAttempts: 0,
  maxRepairAttemptsPerStep: 3,
  maxTotalRepairAttempts: 10,
  passingScore: 9,
  lastVerificationScore: null,
  executionSettings: {
    claudeEffort: 'max',
    opencodeVariant: 'max',
  },
  budget: {
    capUsd: null,
    spentUsd: 0,
    remainingUsd: null,
    exceeded: false,
    lastStepCostUsd: null,
  },
  plan: [],
  manualInterventionRequired: false,
  userPrompt: '',
  updatedAt: new Date(0).toISOString(),
  lastExecutionSummary: '',
  lastVerification: null,
  circuitBreaker: null,
  collaboration: null,
};

// ── Lifecycle label ───────────────────────────────────────────────
export const lifecycleLabel = (value: WorkflowLifecycle): string => {
  switch (value) {
    case 'queued': return 'Queued';
    case 'running': return 'Running';
    case 'paused': return 'Paused';
    case 'needs_review': return 'Review';
    case 'completed': return 'Completed';
    case 'failed': return 'Failed';
    default: return 'Idle';
  }
};

// ── Session helpers ───────────────────────────────────────────────
export const sessionExecutionStateLabel = (value: WorkflowSessionExecutionState): string => {
  switch (value) {
    case 'active': return 'Active';
    case 'queued': return 'Queued';
    case 'scheduled': return 'Scheduled';
    default: return 'Idle';
  }
};

export const sessionExecutionStateTone = (value: WorkflowSessionExecutionState): string => {
  switch (value) {
    case 'active': return 'text-[var(--text-secondary)]';
    case 'queued': return 'text-[var(--text-muted)]';
    case 'scheduled': return 'text-[var(--text-muted)]';
    default: return 'text-[var(--text-muted)]';
  }
};

export const sessionLifecycleTone = (value: WorkflowLifecycle): string => {
  switch (value) {
    case 'completed': return 'text-[var(--text-secondary)]';
    case 'paused': return 'text-[var(--text-muted)]';
    case 'needs_review': return 'text-[var(--text-secondary)]';
    case 'running': return 'text-[var(--text-secondary)]';
    case 'queued': return 'text-[var(--text-muted)]';
    case 'failed': return 'text-[var(--text-muted)]';
    default: return 'text-[var(--text-muted)]';
  }
};

export const isSessionResumable = (session: WorkflowSessionSummary): boolean =>
  session.lifecycle === 'paused' || session.lifecycle === 'queued';
