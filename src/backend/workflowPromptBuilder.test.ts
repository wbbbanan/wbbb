import { describe, it, expect, vi } from 'vitest';
import {
  buildPlanningPrompt,
  buildVerificationPrompt,
  buildFallbackExecutionPrompt,
  buildRepairPrompt,
} from './workflowPromptBuilder';
import type { WorkflowContext } from './workflowHelpers';
import type { PlanStep, VerificationResponse } from '../shared/ipc';

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
      planningInitial: 'INIT: {{userPrompt}} {{planningSchemaBlock}}',
      planningStep: 'STEP: {{userPrompt}} {{planJson}} {{currentStepDescription}}',
      verification: 'VERIFY: {{stepId}} {{stepDescription}} {{scoringRubric}}',
      fallbackExecution: 'FALLBACK: {{userPrompt}} {{stepId}} {{stepDescription}}',
      repair: 'REPAIR: {{userPrompt}} {{failedReasons}} {{nextInstruction}}',
      coordinatorExecution: 'COORD_EXEC',
      coordinatorDispatch: 'COORD_DISPATCH',
      subAgentTask: 'SUB_AGENT',
    },
  })),
  renderPromptTemplate: vi.fn((_template: string, vars: Record<string, string>) => {
    return Object.entries(vars).reduce((t, [k, v]) => t.replace(`{{${k}}}`, v), _template);
  }),
}));

const createContext = (overrides?: Partial<WorkflowContext>): WorkflowContext => ({
  runId: 'test-run',
  userPrompt: 'Create a login page',
  plan: [
    { step_id: 1, description: 'Create login form component' },
    { step_id: 2, description: 'Add authentication logic' },
    { step_id: 3, description: 'Write tests for login flow' },
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

describe('workflowPromptBuilder', () => {
  describe('buildPlanningPrompt', () => {
    it('returns initial planning prompt when plan is empty', () => {
      const ctx = createContext({ plan: [], currentStepIndex: 0 });
      const prompt = buildPlanningPrompt(ctx);
      expect(prompt).toContain('Create a login page');
    });

    it('returns step planning prompt when plan exists', () => {
      const ctx = createContext();
      const prompt = buildPlanningPrompt(ctx);
      expect(prompt).toContain('Create login form component');
    });
  });

  describe('buildVerificationPrompt', () => {
    it('includes step description and passing score', () => {
      const ctx = createContext({ lastExecutionSummary: 'Implemented login form' });
      const step: PlanStep = { step_id: 1, description: 'Create login form' };
      const prompt = buildVerificationPrompt(ctx, step);
      expect(prompt).toContain('Create login form');
      expect(prompt).toContain('7');
    });
  });

  describe('buildFallbackExecutionPrompt', () => {
    it('returns step description when context is null', () => {
      const step: PlanStep = { step_id: 1, description: 'Do the thing' };
      const result = buildFallbackExecutionPrompt(null as any, step);
      expect(result).toBe('Do the thing');
    });

    it('uses template when context is provided', () => {
      const ctx = createContext();
      const step: PlanStep = { step_id: 2, description: 'Add auth' };
      const prompt = buildFallbackExecutionPrompt(ctx, step);
      expect(prompt).toContain('2');
    });
  });

  describe('buildRepairPrompt', () => {
    it('returns step description when context is null', () => {
      const step: PlanStep = { step_id: 1, description: 'Fix the bug' };
      const verification: VerificationResponse = {
        status: 'rejected',
        score: 4,
        summary: 'Tests failed',
        failed_reasons: ['Missing error handling'],
        next_instruction: 'Add try-catch blocks',
      };
      const result = buildRepairPrompt(null as any, step, verification);
      expect(result).toBe('Fix the bug');
    });

    it('includes failed reasons and next instruction', () => {
      const ctx = createContext();
      const step: PlanStep = { step_id: 1, description: 'Create login' };
      const verification: VerificationResponse = {
        status: 'rejected',
        score: 5,
        summary: 'Missing validation',
        failed_reasons: ['No input validation', 'Missing error messages'],
        next_instruction: 'Add form validation',
      };
      const prompt = buildRepairPrompt(ctx, step, verification);
      expect(prompt).toContain('1.');
      expect(prompt).toContain('2.');
    });
  });
});