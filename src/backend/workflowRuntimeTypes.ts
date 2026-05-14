import type {
  CollaborationHints,
  CollaborationSessionSnapshot,
  CircuitBreakerState,
  PlanStep,
  VerificationResponse,
  WorkflowPhase,
  WorkflowSnapshot,
} from '../shared/ipc';

export interface WorkflowPersistedContext {
  runId: string;
  userPrompt: string;
  plan: PlanStep[];
  currentStepIndex: number;
  currentPhase: WorkflowPhase;
  currentExecutionPrompt: string;
  stepRepairAttempts: number;
  totalRepairAttempts: number;
  sessionCostUsd: number;
  lastStepCostUsd: number | null;
  lastExecutionSummary: string;
  lastVerification: VerificationResponse | null;
  lastVerificationScore: number | null;
  manualInterventionRequired: boolean;
  circuitBreaker: CircuitBreakerState | null;
  collaborationSessionId: string | null;
  collaborationHints: CollaborationHints | null;
  planningCollaboration?: CollaborationHints | null;
  collaboration?: CollaborationSessionSnapshot | null;
  /** @deprecated Optional fields used during hydration backward-compat */
  executionSubState?: string | null;
  executionHistory?: unknown[];
  agentMemory?: unknown[];
}

export interface WorkflowPersistedPhaseMetric {
  key: string;
  nextAttempt: number;
  failureStreak: number;
}

export interface WorkflowStateMachinePersistedState {
  context: WorkflowPersistedContext;
  snapshot: WorkflowSnapshot;
  phaseMetrics: WorkflowPersistedPhaseMetric[];
  collaborationSession: CollaborationSessionSnapshot | null;
}