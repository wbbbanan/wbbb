export type WorkflowPhase =
  | 'workflow'
  | 'planning'
  | 'execution'
  | 'verification'
  | 'decision'
  | 'circuit-breaker'
  | 'completed';

export type ExecutionSubState = 'dispatch' | 'working' | 'review';

export type WorkflowNodeStatus = 'idle' | 'running' | 'success' | 'warning' | 'error' | 'paused';

export type WorkflowLifecycle = 'idle' | 'queued' | 'running' | 'paused' | 'needs_review' | 'completed' | 'failed';

export type WorkflowErrorCategory =
  | 'structured-output'
  | 'timeout'
  | 'transient-infrastructure'
  | 'authentication'
  | 'validation'
  | 'empty-output'
  | 'interrupted'
  | 'unknown';

export type WorkflowRecoveryAction = 'queued-retry' | 'resume-from-checkpoint' | 'manual-review' | 'restart-session' | 'repair-step' | 'none';

export type WorkflowSessionExecutionState = 'idle' | 'queued' | 'scheduled' | 'active';

export type RuntimeHealthStatus = 'healthy' | 'warning' | 'error';

export type PlanStepStatus = 'pending' | 'active' | 'completed' | 'skipped';

export type WorkflowExportFormat = 'json' | 'md';

export type ClaudeExecutionEffort = 'low' | 'medium' | 'high' | 'max';

export type OpencodeVariant = 'low' | 'medium' | 'high' | 'max';

/**
 * Structured result envelope for step execution outcomes.
 * Inspired by Claude Code's ToolResult pattern — every execution
 * produces a consistent shape regardless of the execution path.
 */
export interface StepExecutionResult {
  stepId: number;
  phase: 'planning' | 'execution' | 'verification';
  status: 'success' | 'failure' | 'timeout' | 'budget-exceeded';
  summary: string;
  costUsd?: number;
  durationMs?: number;
  rawOutput?: string;
  error?: {
    category: WorkflowErrorCategory;
    message: string;
    autoRetryable: boolean;
  };
  metadata?: Record<string, unknown>;
}

export interface PlanStep {
  step_id: number;
  description: string;
  status?: PlanStepStatus;
  promptOverride?: string;
  notes?: string;
  updatedAt?: string;
  skippedAt?: string;
}

export type CollaborationTransportKind = 'local-direct';

export type CollaborationMode = 'local-direct' | 'disabled' | 'claude-coordinator';

export type CollaborationAgentStatus = 'idle' | 'running' | 'waiting' | 'completed' | 'error';

export type CollaborationSessionStatus = 'active' | 'paused' | 'completed' | 'failed' | 'idle' | 'running' | 'error';

export type CollaborationAgentRole = string;

export type CollaborationMessageKind =
  | 'session'
  | 'plan'
  | 'dispatch'
  | 'assistant'
  | 'operator'
  | 'verification'
  | 'repair'
  | 'result'
  | 'status'
  | 'session_started'
  | 'planning_received'
  | 'dispatch_started'
  | 'assistant_message'
  | 'verification_received'
  | 'subagent_dispatch'
  | 'subagent_result';

export interface CollaborationHints {
  execution_mode: 'single-agent' | 'coordinator';
  suggested_agent_roles: string[];
  coordination_notes?: string;
}

export interface CoordinatorSubTask {
  role: string;
  task_description: string;
  context_summary?: string;
}

export interface CoordinatorDelegateCommand {
  action: 'delegate';
  role?: string;
  task_description?: string;
  context_summary?: string;
  tasks?: CoordinatorSubTask[];
}

export interface CoordinatorSaveMemoryItem {
  key: string;
  value: string;
}

export interface CoordinatorCompleteCommand {
  action: 'complete';
  summary: string;
  all_tasks_completed: boolean;
  saveMemories?: CoordinatorSaveMemoryItem[];
}

export type CoordinatorCommand = CoordinatorDelegateCommand | CoordinatorCompleteCommand;

export interface ExecutionHistoryEntry {
  role: string;
  task_description: string;
  result: string;
  rawResult?: string;
  costUsd?: number;
  durationMs?: number;
  completedAt: string;
}

export interface AgentMemoryEntry {
  key: string;
  value: string;
  createdAt: string;
  updatedAt: string;
  createdByStepId: number;
  createdByRole: string;
}

export interface SummarizedSubAgentResult {
  summary: string;
  keyFindings: string[];
  errorPatterns: string[];
  modifiedFiles: string[];
}

export interface PlanningCollaborationSuggestedAgent {
  agent_id: string;
  role: CollaborationAgentRole;
  label: string;
  objective: string;
}

export interface PlanningCollaborationHints {
  strategy: 'single-agent' | 'claude-coordinator';
  coordination_goal: string;
  suggested_agents: PlanningCollaborationSuggestedAgent[];
}

export interface CollaborationMessageSource {
  agentId: string;
  role: CollaborationAgentRole;
  label: string;
}

export interface CollaborationAgentState {
  agentId: string;
  role: CollaborationAgentRole;
  label: string;
  status: CollaborationAgentStatus;
  parentAgentId?: string;
  objective?: string;
  summary?: string;
  lastMessageAt?: string;
}

export type CollaborationAgent = CollaborationAgentState & {
  lastUpdatedAt?: string;
};

export interface CollaborationMessage {
  messageId: string;
  sessionId?: string;
  turnId?: number;
  kind: CollaborationMessageKind;
  source: CollaborationMessageSource;
  targetAgentId?: string;
  content: string;
  timestamp?: string;
  details?: Record<string, unknown>;
  agentId?: string;
  agentRole?: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

export interface CollaborationPermissionRequest {
  requestId: string;
  agentId: string;
  toolName: string;
  reason: string;
  status: 'pending' | 'approved' | 'denied';
  createdAt: string;
  updatedAt: string;
}

export interface CollaborationSessionSnapshot {
  sessionId: string;
  runId: string;
  mode: CollaborationMode;
  transport?: CollaborationTransportKind;
  status: CollaborationSessionStatus;
  goal: string;
  coordinationGoal?: string;
  createdAt: string;
  updatedAt: string;
  activeAgentId: string | null;
  latestSummary: string;
  currentStepId?: number;
  currentTurnId?: number;
  agents: CollaborationAgent[];
  messages: CollaborationMessage[];
  pendingPermissionRequests?: CollaborationPermissionRequest[];
}

export interface PlanningResponse {
  plan: PlanStep[];
  expanded_prompt_for_current_step: string;
  current_step_id: number;
  collaboration_hints?: CollaborationHints;
  collaboration?: PlanningCollaborationHints;
}

export interface VerificationResponse {
  status: 'approved' | 'rejected';
  score: number;
  summary: string;
  failed_reasons: string[];
  next_instruction: string;
  suggested_test_command?: string;
}

export type WorkflowActivitySource = 'opencode' | 'claude' | 'system';

export type WorkflowActivityRole = 'assistant' | 'user' | 'system';

export type WorkflowActivityKind =
  | 'thinking'
  | 'message'
  | 'tool_use'
  | 'tool_result'
  | 'step_start'
  | 'step_finish'
  | 'result';

export type WorkflowToolCallStatus = 'running' | 'completed' | 'error' | 'success';

export interface WorkflowActivityItem {
  id: string;
  source: WorkflowActivitySource;
  role: WorkflowActivityRole;
  kind: WorkflowActivityKind;
  label: string;
  text?: string;
  toolName?: string;
  toolCallId?: string;
  toolStatus?: WorkflowToolCallStatus;
  input?: string;
  output?: string;
  timestamp?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export interface CircuitBreakerState {
  phase: 'planning' | 'execution' | 'verification';
  stepId: number;
  retryCount: number;
  reason: string;
  command?: string;
  stack?: string;
  rawOutput?: string;
  recovery?: WorkflowRecoveryDescriptor;
}

export interface WorkflowRecoveryDescriptor {
  category: WorkflowErrorCategory;
  action: WorkflowRecoveryAction;
  summary: string;
  autoRetryable: boolean;
  classifiedAt: string;
  delayMs?: number;
}

export interface WorkflowExecutionSettings {
  claudeEffort: ClaudeExecutionEffort;
  opencodeVariant: OpencodeVariant;
}

export interface WorkflowBudgetSummary {
  capUsd: number | null;
  spentUsd: number;
  remainingUsd: number | null;
  exceeded: boolean;
  lastStepCostUsd: number | null;
}

export interface WorkflowSnapshot {
  runId: string | null;
  lifecycle: WorkflowLifecycle;
  currentPhase: WorkflowPhase;
  executionSubState: ExecutionSubState | null;
  currentStepId: number;
  currentRetryCount: number;
  stepRepairAttempts: number;
  totalRepairAttempts: number;
  maxRepairAttemptsPerStep: number;
  maxTotalRepairAttempts: number;
  passingScore: number;
  lastVerificationScore: number | null;
  executionSettings: WorkflowExecutionSettings;
  budget: WorkflowBudgetSummary;
  plan: PlanStep[];
  manualInterventionRequired: boolean;
  userPrompt: string;
  updatedAt: string;
  lastExecutionSummary: string;
  lastVerification: VerificationResponse | null;
  circuitBreaker: CircuitBreakerState | null;
  collaboration: CollaborationSessionSnapshot | null;
}

export interface WorkflowEvent {
  eventId: string;
  runId: string;
  phase: WorkflowPhase;
  stepId: number;
  retryCount: number;
  nodeId: string;
  title: string;
  message: string;
  status: WorkflowNodeStatus;
  timestamp: string;
  command?: string;
  sourceAgentId?: string;
  sourceAgentRole?: string;
  activityTrace?: WorkflowActivityItem[];
  /** @deprecated Use activityTrace instead. Kept for backward compatibility with persisted sessions. */
  activity_trace?: WorkflowActivityItem[];
  details?: Record<string, unknown>;
}

export interface WorkflowEventEnvelope {
  event: WorkflowEvent;
  snapshot: WorkflowSnapshot;
}

export interface WorkflowSessionMetrics {
  eventCount: number;
  warningCount: number;
  errorCount: number;
  retryCount: number;
  totalCostUsd: number;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface WorkflowSessionSummary {
  sessionId: string;
  runId: string | null;
  title: string;
  promptPreview: string;
  createdAt: string;
  updatedAt: string;
  lifecycle: WorkflowLifecycle;
  currentPhase: WorkflowPhase;
  currentStepId: number;
  queuePosition: number | null;
  executionState: WorkflowSessionExecutionState;
  manualInterventionRequired: boolean;
  latestMessage: string;
  metrics: WorkflowSessionMetrics;
  recovery: WorkflowRecoveryDescriptor | null;
}

export interface WorkflowSessionRecord extends WorkflowSessionSummary {
  snapshot: WorkflowSnapshot;
  events: WorkflowEvent[];
}

export interface WorkflowQueueSnapshot {
  activeSessionId: string | null;
  queuedSessionIds: string[];
  scheduledSessionIds: string[];
  sessions: WorkflowSessionSummary[];
}

export interface RuntimeHealthCheck {
  id: string;
  label: string;
  status: RuntimeHealthStatus;
  summary: string;
  details: string[];
}

export interface RuntimeHealthSnapshot {
  checkedAt: string;
  overallStatus: RuntimeHealthStatus;
  checks: RuntimeHealthCheck[];
}

export interface WorkflowPromptTemplates {
  planningInitial: string;
  planningStep: string;
  verification: string;
  fallbackExecution: string;
  repair: string;
  coordinatorExecution: string;
  coordinatorDispatch: string;
  subAgentTask: string;
}

export interface WorkflowRuntimeConfig {
  claudeEffort: ClaudeExecutionEffort;
  opencodeVariant: OpencodeVariant;
  budgetCapUsd: number | null;
  commandTimeoutMs: number;
  healthTimeoutMs: number;
  opencodeTimeoutMs: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  jsonRepairRetries: number;
  processRetries: number;
  executionRetries: number;
  maxRepairAttemptsPerStep: number;
  maxTotalRepairAttempts: number;
  passingScore: number;
  cleanupPeriodDays: number;
  collaborationEnabled: boolean;
  maxPlanSteps: number;
  promptTemplates: WorkflowPromptTemplates;
}

export interface WorkflowRuntimeConfigUpdate {
  claudeEffort?: ClaudeExecutionEffort;
  opencodeVariant?: OpencodeVariant;
  budgetCapUsd?: number | null;
  commandTimeoutMs?: number;
  healthTimeoutMs?: number;
  opencodeTimeoutMs?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  jsonRepairRetries?: number;
  processRetries?: number;
  executionRetries?: number;
  maxRepairAttemptsPerStep?: number;
  maxTotalRepairAttempts?: number;
  passingScore?: number;
  cleanupPeriodDays?: number;
  collaborationEnabled?: boolean;
  maxPlanSteps?: number;
  promptTemplates?: Partial<WorkflowPromptTemplates>;
}

export interface WorkflowConfigSnapshot {
  config: WorkflowRuntimeConfig;
  sources: {
    userConfigPath: string;
    projectConfigPath: string;
    loadedFromUserConfig: boolean;
    loadedFromProjectConfig: boolean;
    envOverrides: string[];
    updatedAt: string;
  };
}

export interface WorkflowExportPayload {
  fileName: string;
  mimeType: string;
  content: string;
}

import type { WorkflowTemplate, WorkflowTemplateCreate } from './schema';

export interface AgentFlowApi {
  getVersion: () => Promise<string>;
  getChangelog: () => Promise<string>;
  invokeAgentFlow: (prompt: string) => Promise<WorkflowSnapshot>;
  continueAgentFlow: (sessionId: string, prompt: string) => Promise<WorkflowSnapshot>;
  retryCurrentStep: () => Promise<WorkflowSnapshot>;
  pauseWorkflow: () => Promise<WorkflowSnapshot>;
  resumeWorkflow: () => Promise<WorkflowSnapshot>;
  cancelWorkflow: () => Promise<WorkflowSnapshot>;
  manualApprove: () => Promise<WorkflowSnapshot>;
  manualReject: () => Promise<WorkflowSnapshot>;
  getSnapshot: () => Promise<WorkflowSnapshot>;
  listSessions: () => Promise<WorkflowSessionSummary[]>;
  getSession: (sessionId: string) => Promise<WorkflowSessionRecord>;
  resumeSession: (sessionId: string) => Promise<WorkflowSnapshot>;
  getQueue: () => Promise<WorkflowQueueSnapshot>;
  getRuntimeHealth: () => Promise<RuntimeHealthSnapshot>;
  getConfig: () => Promise<WorkflowConfigSnapshot>;
  updateConfig: (update: WorkflowRuntimeConfigUpdate) => Promise<WorkflowConfigSnapshot>;
  editPlanStep: (stepId: number, update: { description?: string; promptOverride?: string | null; notes?: string | null }) => Promise<WorkflowSnapshot>;
  skipStep: (stepId: number) => Promise<WorkflowSnapshot>;
  sendCollaborationMessage: (content: string) => Promise<WorkflowSnapshot>;
  exportSession: (sessionId: string, format: WorkflowExportFormat) => Promise<WorkflowExportPayload>;
  clearAllSessions: () => Promise<number>;
  exportAllSessionsZip: () => Promise<{ filePath: string }>;
  listTemplates: () => Promise<WorkflowTemplate[]>;
  saveTemplate: (template: WorkflowTemplateCreate) => Promise<WorkflowTemplate>;
  deleteTemplate: (templateId: string) => Promise<void>;
  onWorkflowEvent: (callback: (envelope: WorkflowEventEnvelope) => void) => () => void;
}
