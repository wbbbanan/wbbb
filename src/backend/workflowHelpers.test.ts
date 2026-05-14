import { describe, it, expect, vi } from 'vitest';
import {
  type WorkflowContext,
  type PhaseMetrics,
  EXCERPT_SHORT,
  EXCERPT_MEDIUM,
  EXCERPT_LONG,
  EXCERPT_FULL,
  JSON_REPAIR_SUFFIX,
  MAX_DISPATCH_ITERATIONS,
  StructuredOutputError,
  cloneJson,
  getCurrentStep,
  getRequiredCurrentStep,
  findStepIndex,
  findNextActionableStepIndex,
  syncPlanStatuses,
  mergePlanSteps,
  insertPlanStep,
  removePlanStep,
  reorderPlanStep,
  movePlanStep,
  buildBudgetSummary,
  getMetrics,
  registerFailure,
  resetFailureStreak,
} from './workflowHelpers';
import type { PlanStep } from '../shared/ipc';

vi.mock('./configManager', () => ({
  getWorkflowConfig: vi.fn(() => ({
    claudeEffort: 'medium',
    opencodeVariant: 'medium',
    budgetCapUsd: null,
    commandTimeoutMs: 60_000,
    healthTimeoutMs: 15_000,
    opencodeTimeoutMs: 60_000,
    backoffBaseMs: 2_000,
    backoffMaxMs: 60_000,
    jsonRepairRetries: 3,
    processRetries: 3,
    executionRetries: 3,
    maxRepairAttemptsPerStep: 3,
    maxTotalRepairAttempts: 10,
    passingScore: 7,
    cleanupPeriodDays: 30,
    collaborationEnabled: false,
    maxPlanSteps: 8,
    promptTemplates: {
      planningInitial: 'test',
      planningStep: 'test',
      verification: 'test',
      fallbackExecution: 'test',
      repair: 'test',
      coordinatorExecution: 'test',
      coordinatorDispatch: 'test',
      subAgentTask: 'test',
    },
  })),
}));

const createContext = (overrides?: Partial<WorkflowContext>): WorkflowContext => ({
  runId: 'test-run',
  userPrompt: 'test prompt',
  plan: [
    { step_id: 1, description: 'Step 1' },
    { step_id: 2, description: 'Step 2' },
    { step_id: 3, description: 'Step 3' },
  ],
  currentStepIndex: 0,
  currentPhase: 'planning',
  currentExecutionPrompt: '',
  stepRepairAttempts: 0,
  totalRepairAttempts: 0,
  sessionCostUsd: 0,
  lastStepCostUsd: null,
  lastExecutionSummary: '',
  lastVerification: null,
  lastVerificationScore: null,
  manualInterventionRequired: false,
  circuitBreaker: null,
  collaborationSessionId: null,
  collaborationHints: null,
  executionSubState: null,
  executionHistory: [],
  agentMemory: [],
  ...overrides,
});

describe('workflowHelpers', () => {
  describe('constants', () => {
    it('exports correct excerpt lengths', () => {
      expect(EXCERPT_SHORT).toBe(500);
      expect(EXCERPT_MEDIUM).toBe(1500);
      expect(EXCERPT_LONG).toBe(3000);
      expect(EXCERPT_FULL).toBe(4000);
    });

    it('exports JSON_REPAIR_SUFFIX', () => {
      expect(JSON_REPAIR_SUFFIX).toContain('JSON');
    });

    it('exports MAX_DISPATCH_ITERATIONS', () => {
      expect(MAX_DISPATCH_ITERATIONS).toBe(20);
    });
  });

  describe('StructuredOutputError', () => {
    it('creates error with command and rawOutput', () => {
      const err = new StructuredOutputError('test', 'cmd', 'raw');
      expect(err.message).toBe('test');
      expect(err.command).toBe('cmd');
      expect(err.rawOutput).toBe('raw');
      expect(err.name).toBe('StructuredOutputError');
    });

    it('preserves cause', () => {
      const cause = new Error('original');
      const err = new StructuredOutputError('test', 'cmd', 'raw', cause);
      expect(err.cause).toBe(cause);
    });
  });

  describe('cloneJson', () => {
    it('deep clones objects', () => {
      const obj = { a: 1, b: { c: 2 } };
      const cloned = cloneJson(obj);
      expect(cloned).toEqual(obj);
      expect(cloned).not.toBe(obj);
      expect(cloned.b).not.toBe(obj.b);
    });

    it('deep clones arrays', () => {
      const arr = [1, [2, 3]];
      const cloned = cloneJson(arr);
      expect(cloned).toEqual(arr);
      expect(cloned[1]).not.toBe(arr[1]);
    });
  });

  describe('getCurrentStep', () => {
    it('returns current step from context', () => {
      const ctx = createContext();
      expect(getCurrentStep(ctx)!.step_id).toBe(1);
    });

    it('returns null when context is null', () => {
      expect(getCurrentStep(null)).toBeNull();
    });

    it('returns null when index is out of bounds', () => {
      const ctx = createContext({ currentStepIndex: 99 });
      expect(getCurrentStep(ctx)).toBeNull();
    });
  });

  describe('getRequiredCurrentStep', () => {
    it('returns current step from valid context', () => {
      const ctx = createContext();
      expect(getRequiredCurrentStep(ctx).step_id).toBe(1);
    });

    it('throws when index is out of bounds', () => {
      const ctx = createContext({ currentStepIndex: 99 });
      expect(() => getRequiredCurrentStep(ctx)).toThrow('No current plan step');
    });
  });

  describe('findStepIndex', () => {
    it('finds step by id', () => {
      const ctx = createContext();
      expect(findStepIndex(ctx, 2)).toBe(1);
      expect(findStepIndex(ctx, 1)).toBe(0);
    });

    it('returns -1 for non-existent step', () => {
      const ctx = createContext();
      expect(findStepIndex(ctx, 99)).toBe(-1);
    });

    it('returns -1 when context is null', () => {
      expect(findStepIndex(null, 1)).toBe(-1);
    });
  });

  describe('findNextActionableStepIndex', () => {
    it('finds next pending step', () => {
      const ctx = createContext();
      expect(findNextActionableStepIndex(ctx, 1)).toBe(1);
    });

    it('returns -1 when all later steps are completed or skipped', () => {
      const ctx = createContext({
        plan: [
          { step_id: 1, description: 'A', status: 'completed' },
          { step_id: 2, description: 'B', status: 'skipped' },
          { step_id: 3, description: 'C', status: 'completed' },
        ],
      });
      expect(findNextActionableStepIndex(ctx, 0)).toBe(-1);
    });

    it('skips completed and skipped steps', () => {
      const ctx = createContext({
        plan: [
          { step_id: 1, description: 'A', status: 'completed' },
          { step_id: 2, description: 'B', status: 'skipped' },
          { step_id: 3, description: 'C', status: 'pending' },
        ],
        currentStepIndex: 0,
      });
      expect(findNextActionableStepIndex(ctx, 0)).toBe(2);
    });

    it('returns -1 when context is null', () => {
      expect(findNextActionableStepIndex(null, 0)).toBe(-1);
    });
  });

  describe('syncPlanStatuses', () => {
    it('sets completed/skipped status for steps before current', () => {
      const ctx = createContext({
        plan: [
          { step_id: 1, description: 'A' },
          { step_id: 2, description: 'B' },
          { step_id: 3, description: 'C' },
        ],
        currentStepIndex: 1,
      });
      syncPlanStatuses(ctx);
      expect(ctx.plan[0].status).toBe('completed');
      expect(ctx.plan[1].status).toBe('active');
      expect(ctx.plan[2].status).toBe('pending');
    });

    it('preserves skipped status for steps before current', () => {
      const ctx = createContext({
        plan: [
          { step_id: 1, description: 'A', status: 'skipped' as const },
          { step_id: 2, description: 'B' },
        ],
        currentStepIndex: 1,
      });
      syncPlanStatuses(ctx);
      expect(ctx.plan[0].status).toBe('skipped');
    });

    it('does nothing when context is null', () => {
      expect(() => syncPlanStatuses(null)).not.toThrow();
    });
  });

  describe('mergePlanSteps', () => {
    it('merges new plan steps with existing overrides', () => {
      const ctx = createContext({
        plan: [
          { step_id: 1, description: 'old desc 1', promptOverride: 'old override', notes: 'old notes' },
        ],
        currentStepIndex: 0,
      });
      const nextPlan: PlanStep[] = [
        { step_id: 1, description: 'new desc 1' },
      ];
      const result = mergePlanSteps(ctx, nextPlan);
      expect(result[0].description).toBe('new desc 1');
      expect(result[0].promptOverride).toBe('old override');
      expect(result[0].notes).toBe('old notes');
    });

    it('throws when plan exceeds maxPlanSteps', () => {
      const ctx = createContext();
      const largePlan = Array.from({ length: 100 }, (_, i) => ({ step_id: i + 1, description: `Step ${i + 1}` }));
      expect(() => mergePlanSteps(ctx, largePlan)).toThrow('超过上限');
    });

    it('returns nextPlan when context is null', () => {
      const nextPlan = [{ step_id: 1, description: 'Step 1' }];
      expect(mergePlanSteps(null, nextPlan)).toEqual(nextPlan);
    });
  });

  describe('insertPlanStep', () => {
    it('appends a new step and keeps the current step when inserting after it', () => {
      const ctx = createContext({
        plan: [
          { step_id: 1, description: 'A', status: 'active' },
          { step_id: 2, description: 'B', status: 'pending' },
        ],
        currentStepIndex: 0,
      });

      const result = insertPlanStep(ctx, 1, {
        description: '  New step  ',
        promptOverride: '  override  ',
      });

      expect(result.currentStepIndex).toBe(0);
      expect(result.insertedStepId).toBe(2);
      expect(result.plan.map((step) => [step.step_id, step.description])).toEqual([
        [1, 'A'],
        [2, 'New step'],
        [3, 'B'],
      ]);
      expect(result.plan[1].promptOverride).toBe('override');
    });

    it('makes the inserted step current when inserting before the current unfinished step', () => {
      const ctx = createContext({
        plan: [
          { step_id: 1, description: 'Done', status: 'completed' },
          { step_id: 2, description: 'Active', status: 'active' },
          { step_id: 3, description: 'Later', status: 'pending' },
        ],
        currentStepIndex: 1,
      });

      const result = insertPlanStep(ctx, 1, { description: 'Inserted first' });

      expect(result.currentStepIndex).toBe(1);
      expect(result.plan.map((step) => step.description)).toEqual(['Done', 'Inserted first', 'Active', 'Later']);
      expect(result.insertedStepId).toBe(2);
    });

    it('rejects inserts before completed history', () => {
      const ctx = createContext({
        plan: [
          { step_id: 1, description: 'Done', status: 'completed' },
          { step_id: 2, description: 'Active', status: 'active' },
        ],
        currentStepIndex: 1,
      });

      expect(() => insertPlanStep(ctx, 0, { description: 'bad' })).toThrow('Unknown plan step');
      expect(() => insertPlanStep(ctx, 1, { description: '' })).toThrow('Step description is required');
    });

    it('rejects when afterStepId points before the editable region', () => {
      const ctx = createContext({
        plan: [
          { step_id: 1, description: 'Done 1', status: 'completed' },
          { step_id: 2, description: 'Done 2', status: 'completed' },
          { step_id: 3, description: 'Active', status: 'active' },
        ],
        currentStepIndex: 2,
      });

      expect(() => insertPlanStep(ctx, 1, { description: 'bad' })).toThrow('Cannot insert a plan step before completed history');
    });
  });

  describe('removePlanStep', () => {
    it('removes a later unfinished step and resequences ids', () => {
      const ctx = createContext({
        plan: [
          { step_id: 1, description: 'Active', status: 'active' },
          { step_id: 2, description: 'Later', status: 'pending' },
          { step_id: 3, description: 'Tail', status: 'pending' },
        ],
        currentStepIndex: 0,
      });

      const result = removePlanStep(ctx, 2);

      expect(result.currentStepIndex).toBe(0);
      expect(result.plan.map((step) => [step.step_id, step.description])).toEqual([
        [1, 'Active'],
        [2, 'Tail'],
      ]);
    });

    it('removes the current step and promotes the next editable slot', () => {
      const ctx = createContext({
        plan: [
          { step_id: 1, description: 'Active', status: 'active' },
          { step_id: 2, description: 'Later', status: 'pending' },
          { step_id: 3, description: 'Tail', status: 'pending' },
        ],
        currentStepIndex: 0,
      });

      const result = removePlanStep(ctx, 1);

      expect(result.currentStepIndex).toBe(0);
      expect(result.plan.map((step) => [step.step_id, step.description])).toEqual([
        [1, 'Later'],
        [2, 'Tail'],
      ]);
    });

    it('rejects removing completed history', () => {
      const ctx = createContext({
        plan: [
          { step_id: 1, description: 'Done', status: 'completed' },
          { step_id: 2, description: 'Active', status: 'active' },
          { step_id: 3, description: 'Later', status: 'pending' },
        ],
        currentStepIndex: 1,
      });

      expect(() => removePlanStep(ctx, 1)).toThrow('Cannot remove a completed or historical step');
    });

    it('completes the editable region when deleting the final current step', () => {
      const ctx = createContext({
        plan: [
          { step_id: 1, description: 'Done', status: 'completed' },
          { step_id: 2, description: 'Only active', status: 'active' },
        ],
        currentStepIndex: 1,
      });

      const result = removePlanStep(ctx, 2);

      expect(result.currentStepIndex).toBeNull();
      expect(result.plan.map((step) => [step.step_id, step.description])).toEqual([[1, 'Done']]);
    });

    it('allows deleting the only remaining step', () => {
      const ctx = createContext({
        plan: [{ step_id: 1, description: 'Only active', status: 'active' }],
        currentStepIndex: 0,
      });

      const result = removePlanStep(ctx, 1);

      expect(result.currentStepIndex).toBeNull();
      expect(result.plan).toEqual([]);
    });
  });

  describe('reorderPlanStep', () => {
    it('moves a later step into the current slot while keeping the boundary index stable', () => {
      const ctx = createContext({
        plan: [
          { step_id: 1, description: 'Done', status: 'completed' },
          { step_id: 2, description: 'Active', status: 'active' },
          { step_id: 3, description: 'Later', status: 'pending' },
          { step_id: 4, description: 'Tail', status: 'pending' },
        ],
        currentStepIndex: 1,
      });

      const result = reorderPlanStep(ctx, 3, 1);

      expect(result.currentStepIndex).toBe(1);
      expect(result.movedStepId).toBe(2);
      expect(result.plan.map((step) => step.description)).toEqual(['Done', 'Later', 'Active', 'Tail']);
    });

    it('moves the current step later and makes the next slot current', () => {
      const ctx = createContext({
        plan: [
          { step_id: 1, description: 'Done', status: 'completed' },
          { step_id: 2, description: 'Active', status: 'active' },
          { step_id: 3, description: 'Later', status: 'pending' },
          { step_id: 4, description: 'Tail', status: 'pending' },
        ],
        currentStepIndex: 1,
      });

      const result = reorderPlanStep(ctx, 2, 3);

      expect(result.currentStepIndex).toBe(1);
      expect(result.movedStepId).toBe(4);
      expect(result.plan.map((step) => step.description)).toEqual(['Done', 'Later', 'Tail', 'Active']);
    });

    it('rejects moving a step before the editable boundary', () => {
      const ctx = createContext({
        plan: [
          { step_id: 1, description: 'Done', status: 'completed' },
          { step_id: 2, description: 'Active', status: 'active' },
          { step_id: 3, description: 'Later', status: 'pending' },
        ],
        currentStepIndex: 1,
      });

      expect(() => reorderPlanStep(ctx, 3, 0)).toThrow('Cannot move step to the requested position');
    });
  });

  describe('movePlanStep', () => {
    it('moves a later unfinished step upward and promotes it to current when needed', () => {
      const ctx = createContext({
        plan: [
          { step_id: 1, description: 'Done', status: 'completed' },
          { step_id: 2, description: 'Active', status: 'active' },
          { step_id: 3, description: 'Later', status: 'pending' },
          { step_id: 4, description: 'Tail', status: 'pending' },
        ],
        currentStepIndex: 1,
      });

      const result = movePlanStep(ctx, 3, 'up');

      expect(result.currentStepIndex).toBe(1);
      expect(result.movedStepId).toBe(2);
      expect(result.plan.map((step) => step.description)).toEqual(['Done', 'Later', 'Active', 'Tail']);
    });

    it('allows moving the current step downward within the editable region', () => {
      const ctx = createContext({
        plan: [
          { step_id: 1, description: 'Done', status: 'completed' },
          { step_id: 2, description: 'Active', status: 'active' },
          { step_id: 3, description: 'Later', status: 'pending' },
          { step_id: 4, description: 'Tail', status: 'pending' },
        ],
        currentStepIndex: 1,
      });

      const result = movePlanStep(ctx, 2, 'down');

      expect(result.currentStepIndex).toBe(1);
      expect(result.movedStepId).toBe(3);
      expect(result.plan.map((step) => step.description)).toEqual(['Done', 'Later', 'Active', 'Tail']);
    });

    it('moves a later unfinished step downward without changing current step', () => {
      const ctx = createContext({
        plan: [
          { step_id: 1, description: 'Active', status: 'active' },
          { step_id: 2, description: 'Later', status: 'pending' },
          { step_id: 3, description: 'Tail', status: 'pending' },
        ],
        currentStepIndex: 0,
      });

      const result = movePlanStep(ctx, 2, 'down');

      expect(result.currentStepIndex).toBe(0);
      expect(result.movedStepId).toBe(3);
      expect(result.plan.map((step) => step.description)).toEqual(['Active', 'Tail', 'Later']);
    });

    it('rejects moving historical steps or moving beyond the editable region', () => {
      const ctx = createContext({
        plan: [
          { step_id: 1, description: 'Done', status: 'completed' },
          { step_id: 2, description: 'Active', status: 'active' },
          { step_id: 3, description: 'Later', status: 'pending' },
        ],
        currentStepIndex: 1,
      });

      expect(() => movePlanStep(ctx, 1, 'down')).toThrow('Cannot move a completed or historical step');
      expect(() => movePlanStep(ctx, 3, 'down')).toThrow('Cannot move step down');
      expect(() => movePlanStep(ctx, 2, 'up')).toThrow('Cannot move step up');
    });
  });

  describe('buildBudgetSummary', () => {
    it('calculates budget with null cap', () => {
      const ctx = createContext();
      const summary = buildBudgetSummary(ctx, null);
      expect(summary.capUsd).toBeNull();
      expect(summary.remainingUsd).toBeNull();
      expect(summary.exceeded).toBe(false);
    });

    it('calculates budget with cap', () => {
      const ctx = createContext({ sessionCostUsd: 5 });
      const summary = buildBudgetSummary(ctx, 10);
      expect(summary.capUsd).toBe(10);
      expect(summary.spentUsd).toBe(5);
      expect(summary.remainingUsd).toBe(5);
      expect(summary.exceeded).toBe(false);
    });

    it('detects exceeded budget', () => {
      const ctx = createContext({ sessionCostUsd: 15 });
      const summary = buildBudgetSummary(ctx, 10);
      expect(summary.exceeded).toBe(true);
      expect(summary.remainingUsd).toBe(0);
    });

    it('uses context cost when provided', () => {
      const ctx = createContext({ sessionCostUsd: 3, lastStepCostUsd: 1.5 });
      const summary = buildBudgetSummary(ctx, 10);
      expect(summary.lastStepCostUsd).toBe(1.5);
    });

    it('handles null context', () => {
      const summary = buildBudgetSummary(null, 10);
      expect(summary.spentUsd).toBe(0);
    });
  });

  describe('PhaseMetrics', () => {
    it('creates new metrics entry on first access', () => {
      const metrics = new Map<string, PhaseMetrics>();
      const m = getMetrics(metrics, 'planning', 1);
      expect(m.nextAttempt).toBe(1);
      expect(m.failureStreak).toBe(0);
    });

    it('registers failure correctly', () => {
      const metrics = new Map<string, PhaseMetrics>();
      registerFailure(metrics, 'planning', 1);
      const m = getMetrics(metrics, 'planning', 1);
      expect(m.nextAttempt).toBe(2);
      expect(m.failureStreak).toBe(1);
    });

    it('resets failure streak', () => {
      const metrics = new Map<string, PhaseMetrics>();
      registerFailure(metrics, 'execution', 1);
      registerFailure(metrics, 'execution', 1);
      resetFailureStreak(metrics, 'execution', 1);
      const m = getMetrics(metrics, 'execution', 1);
      expect(m.failureStreak).toBe(0);
      expect(m.nextAttempt).toBe(3);
    });

    it('isolates metrics between different phases', () => {
      const metrics = new Map<string, PhaseMetrics>();
      registerFailure(metrics, 'verification', 1);
      const planM = getMetrics(metrics, 'planning', 1);
      const verM = getMetrics(metrics, 'verification', 1);
      expect(planM.failureStreak).toBe(0);
      expect(verM.failureStreak).toBe(1);
    });
  });
});