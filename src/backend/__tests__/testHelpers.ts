import type { WorkflowRuntimeConfig, WorkflowSnapshot, PlanStep } from '../../shared/ipc';

export const createTestConfig = (overrides?: Partial<WorkflowRuntimeConfig>): WorkflowRuntimeConfig => ({
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
    planningInitial: 'test-planning-initial',
    planningStep: 'test-planning-step',
    verification: 'test-verification',
    fallbackExecution: 'test-fallback',
    repair: 'test-repair',
    coordinatorExecution: 'test-coordinator-exec',
    coordinatorDispatch: 'test-coordinator-dispatch',
    subAgentTask: 'test-subagent-task',
  },
  ...overrides,
});

export const createTestSnapshot = (overrides?: Partial<WorkflowSnapshot>): WorkflowSnapshot => ({
  runId: 'test-run-id',
  lifecycle: 'idle',
  currentPhase: 'workflow',
  executionSubState: null,
  currentStepId: 0,
  currentRetryCount: 0,
  stepRepairAttempts: 0,
  totalRepairAttempts: 0,
  maxRepairAttemptsPerStep: 3,
  maxTotalRepairAttempts: 10,
  passingScore: 7,
  lastVerificationScore: null,
  executionSettings: { claudeEffort: 'medium', opencodeVariant: 'medium' },
  budget: { capUsd: null, spentUsd: 0, remainingUsd: null, exceeded: false, lastStepCostUsd: null },
  plan: [],
  manualInterventionRequired: false,
  userPrompt: 'test prompt',
  updatedAt: new Date().toISOString(),
  lastExecutionSummary: '',
  lastVerification: null,
  circuitBreaker: null,
  collaboration: null,
  ...overrides,
});

export const createTestPlanStep = (overrides?: Partial<PlanStep>): PlanStep => ({
  step_id: 1,
  description: 'Test step',
  ...overrides,
});

export const createMockPublish = () => {
  const envelopes: Array<import('../../shared/ipc').WorkflowEventEnvelope> = [];
  const publish = (envelope: import('../../shared/ipc').WorkflowEventEnvelope) => {
    envelopes.push(envelope);
  };
  return { publish, envelopes };
};

export const SAMPLE_NDJSON_STREAM = [
  '{"type":"text","part":{"id":"p1","type":"text","text":"Hello world"}}',
  '{"type":"reasoning","part":{"id":"p2","type":"reasoning","reason":"thinking..."}}',
  '{"type":"tool_use","part":{"type":"tool","tool":"Read","callID":"c1","id":"p3","state":{"status":"completed","input":{"file":"test.ts"},"output":"file content","time":{"start":1000,"end":2000}}}}',
  '{"type":"step_finish","part":{"id":"p4","reason":"done"}}',
].join('\n');

export const SAMPLE_CLAUDE_STREAM = [
  '{"type":"assistant","message":{"id":"m1","role":"assistant","content":[{"type":"text","text":"I will help you."}]}}',
  '{"type":"result","duration_ms":5000,"total_cost_usd":0.05,"num_turns":2,"result":"Done"}',
].join('\n');