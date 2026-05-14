import type { PlanStep, WorkflowBudgetSummary, WorkflowRuntimeConfig } from '../shared/ipc';
export { cloneJson } from './cloneUtils';
import { getWorkflowConfig } from './configManager';

export type RetriablePhase = 'planning' | 'execution' | 'verification';

export interface PhaseMetrics {
  nextAttempt: number;
  failureStreak: number;
}

export interface ActiveStage {
  phase: import('../shared/ipc').WorkflowPhase;
  stepId: number;
  retryCount: number;
  nodeId: string;
}

export interface WorkflowContext {
  runId: string;
  userPrompt: string;
  plan: PlanStep[];
  currentStepIndex: number;
  currentPhase: import('../shared/ipc').WorkflowPhase;
  currentExecutionPrompt: string;
  stepRepairAttempts: number;
  totalRepairAttempts: number;
  sessionCostUsd: number;
  lastStepCostUsd: number | null;
  lastExecutionSummary: string;
  lastVerification: import('../shared/ipc').VerificationResponse | null;
  lastVerificationScore: number | null;
  manualInterventionRequired: boolean;
  circuitBreaker: import('../shared/ipc').CircuitBreakerState | null;
  collaborationSessionId: string | null;
  collaborationHints: import('../shared/ipc').CollaborationHints | null;
  executionSubState: import('../shared/ipc').ExecutionSubState | null;
  executionHistory: import('../shared/ipc').ExecutionHistoryEntry[];
  agentMemory: import('../shared/ipc').AgentMemoryEntry[];
}

const EXCERPT_SHORT = 500;
export { EXCERPT_SHORT };
export const EXCERPT_MEDIUM = 1_500;
export const EXCERPT_LONG = 3_000;
export const EXCERPT_FULL = 4_000;
export const JSON_REPAIR_SUFFIX = 'JSON格式无效或结构错误，请严格按要求重试，只输出合法 JSON。';
export const MAX_ACTIVITY_TRACE_ITEMS = 120;
export const MAX_DISPATCH_ITERATIONS = 20;

export class StructuredOutputError extends Error {
  readonly command: string;
  readonly rawOutput: string;

  constructor(message: string, command: string, rawOutput: string, cause?: unknown) {
    super(message);
    this.name = 'StructuredOutputError';
    this.command = command;
    this.rawOutput = rawOutput;
    this.cause = cause;
  }
}

export const getCurrentStep = (context: WorkflowContext | null): PlanStep | null => {
  if (!context) return null;
  return context.plan[context.currentStepIndex] ?? null;
};

export const getRequiredCurrentStep = (context: WorkflowContext): PlanStep => {
  const step = getCurrentStep(context);
  if (!step) throw new Error('No current plan step.');
  return step;
};

export const findStepIndex = (context: WorkflowContext | null, stepId: number): number => {
  if (!context) return -1;
  return context.plan.findIndex((s) => s.step_id === stepId);
};

export const findNextActionableStepIndex = (context: WorkflowContext | null, fromIndex: number): number => {
  if (!context) return -1;
  for (let i = fromIndex; i < context.plan.length; i += 1) {
    const status = context.plan[i].status;
    if (status !== 'completed' && status !== 'skipped') return i;
  }
  return -1;
};

export const syncPlanStatuses = (context: WorkflowContext | null): void => {
  if (!context) return;
  for (let i = 0; i < context.plan.length; i += 1) {
    const step = context.plan[i];
    if (i < context.currentStepIndex) {
      if (step.status !== 'skipped') step.status = 'completed';
    } else if (i === context.currentStepIndex) {
      step.status = 'active';
    } else {
      step.status = 'pending';
    }
  }
};

export const mergePlanSteps = (context: WorkflowContext | null, nextPlan: PlanStep[]): PlanStep[] => {
  const maxPlanSteps = getWorkflowConfig().maxPlanSteps;
  if (nextPlan.length > maxPlanSteps) {
    throw new Error(`合并后计划步骤数 (${nextPlan.length}) 超过上限 (${maxPlanSteps})。`);
  }
  if (!context) return nextPlan;
  const existing = new Map(context.plan.map((s) => [s.step_id, s]));
  return nextPlan.map((next) => {
    const prev = existing.get(next.step_id);
    if (!prev) return next;
    return {
      ...prev,
      description: next.description,
      promptOverride: next.promptOverride ?? prev.promptOverride,
      notes: next.notes ?? prev.notes,
    };
  });
};

const normalizePlanStepText = (value?: string | null): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized ? normalized : undefined;
};

const resequencePlanSteps = (plan: PlanStep[]): PlanStep[] =>
  plan.map((step, index) => ({
    ...step,
    step_id: index + 1,
  }));

export const insertPlanStep = (
  context: WorkflowContext,
  afterStepId: number | null,
  input: { description: string; promptOverride?: string | null; notes?: string | null },
): { plan: PlanStep[]; currentStepIndex: number; insertedStepId: number } => {
  const description = input.description.trim();

  if (!description) {
    throw new Error('Step description is required.');
  }

  const maxPlanSteps = getWorkflowConfig().maxPlanSteps;
  if (context.plan.length >= maxPlanSteps) {
    throw new Error(`计划步骤数已达到上限 (${maxPlanSteps})。`);
  }

  let insertIndex = context.plan.length;

  if (afterStepId !== null) {
    const previousIndex = findStepIndex(context, afterStepId);
    if (previousIndex === -1) {
      throw new Error(`Unknown plan step: ${afterStepId}`);
    }
    insertIndex = previousIndex + 1;
  }

  if (context.plan.length > 0 && insertIndex < context.currentStepIndex) {
    throw new Error('Cannot insert a plan step before completed history.');
  }

  const timestamp = new Date().toISOString();
  const nextPlan = [
    ...context.plan.slice(0, insertIndex),
    {
      step_id: 0,
      description,
      status: 'pending' as const,
      promptOverride: normalizePlanStepText(input.promptOverride),
      notes: normalizePlanStepText(input.notes),
      updatedAt: timestamp,
    },
    ...context.plan.slice(insertIndex),
  ];

  return {
    plan: resequencePlanSteps(nextPlan),
    currentStepIndex: context.plan.length === 0 || insertIndex <= context.currentStepIndex ? insertIndex : context.currentStepIndex,
    insertedStepId: insertIndex + 1,
  };
};

export const removePlanStep = (
  context: WorkflowContext,
  stepId: number,
): { plan: PlanStep[]; currentStepIndex: number | null } => {
  const stepIndex = findStepIndex(context, stepId);

  if (stepIndex === -1) {
    throw new Error(`Unknown plan step: ${stepId}`);
  }

  if (stepIndex < context.currentStepIndex) {
    throw new Error('Cannot remove a completed or historical step.');
  }

  if (context.plan.length <= 1) {
    return {
      plan: [],
      currentStepIndex: null,
    };
  }

  const nextPlan = resequencePlanSteps(context.plan.filter((_step, index) => index !== stepIndex));

  if (stepIndex === context.currentStepIndex) {
    return {
      plan: nextPlan,
      currentStepIndex: stepIndex >= nextPlan.length ? null : stepIndex,
    };
  }

  return {
    plan: nextPlan,
    currentStepIndex: context.currentStepIndex,
  };
};

export const reorderPlanStep = (
  context: WorkflowContext,
  stepId: number,
  targetIndex: number,
): { plan: PlanStep[]; currentStepIndex: number; movedStepId: number } => {
  const stepIndex = findStepIndex(context, stepId);

  if (stepIndex === -1) {
    throw new Error(`Unknown plan step: ${stepId}`);
  }

  if (stepIndex < context.currentStepIndex) {
    throw new Error('Cannot move a completed or historical step.');
  }

  if (targetIndex < context.currentStepIndex || targetIndex >= context.plan.length) {
    throw new Error('Cannot move step to the requested position.');
  }

  if (targetIndex === stepIndex) {
    return {
      plan: context.plan,
      currentStepIndex: context.currentStepIndex,
      movedStepId: stepId,
    };
  }

  const timestamp = new Date().toISOString();
  const movingStep = {
    ...context.plan[stepIndex],
    updatedAt: timestamp,
  };
  const remainingSteps = context.plan.filter((_step, index) => index !== stepIndex);
  remainingSteps.splice(targetIndex, 0, movingStep);

  return {
    plan: resequencePlanSteps(remainingSteps),
    currentStepIndex: context.currentStepIndex,
    movedStepId: targetIndex + 1,
  };
};

export const movePlanStep = (
  context: WorkflowContext,
  stepId: number,
  direction: 'up' | 'down',
): { plan: PlanStep[]; currentStepIndex: number; movedStepId: number } => {
  const stepIndex = findStepIndex(context, stepId);

  if (stepIndex === -1) {
    throw new Error(`Unknown plan step: ${stepId}`);
  }

  if (stepIndex < context.currentStepIndex) {
    throw new Error('Cannot move a completed or historical step.');
  }

  const targetIndex = direction === 'up' ? stepIndex - 1 : stepIndex + 1;

  if (targetIndex < context.currentStepIndex || targetIndex >= context.plan.length) {
    throw new Error(`Cannot move step ${direction}.`);
  }

  return reorderPlanStep(context, stepId, targetIndex);
};

export const buildBudgetSummary = (context: WorkflowContext | null, capUsd?: number | null): WorkflowBudgetSummary => {
  const resolvedCap = capUsd === undefined ? getWorkflowConfig().budgetCapUsd : capUsd;
  const spentUsd = context?.sessionCostUsd ?? 0;
  return {
    capUsd: resolvedCap,
    spentUsd,
    remainingUsd: resolvedCap == null ? null : Math.max(0, resolvedCap - spentUsd),
    exceeded: resolvedCap == null ? false : spentUsd >= resolvedCap,
    lastStepCostUsd: context?.lastStepCostUsd ?? null,
  };
};

export const getMetrics = (phaseMetrics: Map<string, PhaseMetrics>, phase: string, stepId: number): PhaseMetrics => {
  const key = `${phase}:${stepId}`;
  let metrics = phaseMetrics.get(key);
  if (!metrics) {
    metrics = { nextAttempt: 1, failureStreak: 0 };
    phaseMetrics.set(key, metrics);
  }
  return metrics;
};

export const nextRetryCount = (phaseMetrics: Map<string, PhaseMetrics>, phase: string, stepId: number): number =>
  getMetrics(phaseMetrics, phase, stepId).nextAttempt;

export const registerFailure = (phaseMetrics: Map<string, PhaseMetrics>, phase: string, stepId: number): void => {
  const metrics = getMetrics(phaseMetrics, phase, stepId);
  metrics.nextAttempt += 1;
  metrics.failureStreak += 1;
};

export const resetFailureStreak = (phaseMetrics: Map<string, PhaseMetrics>, phase: string, stepId: number): void => {
  const metrics = getMetrics(phaseMetrics, phase, stepId);
  metrics.failureStreak = 0;
};