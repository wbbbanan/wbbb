import { describe, it, expect } from 'vitest';
import {
  coordinatorCompleteCommandSchema,
  verificationResponseSchema,
  workflowRuntimeConfigSchema,
  workflowRuntimeConfigUpdateSchema,
} from './schema';

describe('verificationResponseSchema', () => {
  const validResponse = {
    status: 'approved' as const,
    score: 9,
    summary: 'Code is correct.',
    failed_reasons: [],
    next_instruction: '',
  };

  it('accepts a valid approved response with score 9', () => {
    const result = verificationResponseSchema.parse(validResponse);
    expect(result.status).toBe('approved');
    expect(result.score).toBe(9);
  });

  it('accepts a valid rejected response with score 8', () => {
    const result = verificationResponseSchema.parse({
      ...validResponse,
      status: 'rejected',
      score: 8,
    });
    expect(result.status).toBe('rejected');
    expect(result.score).toBe(8);
  });

  it('accepts score 10 (upper bound)', () => {
    const result = verificationResponseSchema.parse({ ...validResponse, score: 10 });
    expect(result.score).toBe(10);
  });

  it('accepts score 1 (lower bound)', () => {
    const result = verificationResponseSchema.parse({
      ...validResponse,
      status: 'rejected',
      score: 1,
    });
    expect(result.score).toBe(1);
  });

  it('rejects score 0 (below minimum)', () => {
    expect(() =>
      verificationResponseSchema.parse({ ...validResponse, score: 0 }),
    ).toThrow();
  });

  it('rejects score 11 (above maximum)', () => {
    expect(() =>
      verificationResponseSchema.parse({ ...validResponse, score: 11 }),
    ).toThrow();
  });

  it('rejects missing score field', () => {
    const { score: _, ...noScore } = validResponse;
    expect(() => verificationResponseSchema.parse(noScore)).toThrow();
  });

  it('rejects non-integer score', () => {
    expect(() =>
      verificationResponseSchema.parse({ ...validResponse, score: 8.5 }),
    ).toThrow();
  });

  it('defaults failed_reasons to empty array', () => {
    const { failed_reasons: _, ...noReasons } = validResponse;
    const result = verificationResponseSchema.parse(noReasons);
    expect(result.failed_reasons).toEqual([]);
  });

  it('defaults next_instruction to empty string', () => {
    const { next_instruction: _, ...noInstruction } = validResponse;
    const result = verificationResponseSchema.parse(noInstruction);
    expect(result.next_instruction).toBe('');
  });
});

describe('workflowRuntimeConfigSchema - passingScore', () => {
  const validConfig = {
    claudeEffort: 'medium' as const,
    opencodeVariant: 'medium' as const,
    budgetCapUsd: null,
    commandTimeoutMs: 600_000,
    healthTimeoutMs: 15_000,
    opencodeTimeoutMs: 600_000,
    backoffBaseMs: 2_000,
    backoffMaxMs: 60_000,
    jsonRepairRetries: 3,
    processRetries: 3,
    executionRetries: 3,
    maxRepairAttemptsPerStep: 3,
    maxTotalRepairAttempts: 10,
    passingScore: 9,
    cleanupPeriodDays: 30,
    collaborationEnabled: true,
    maxPlanSteps: 8,
    promptTemplates: {
      planningInitial: 'a',
      planningStep: 'b',
      verification: 'c',
      fallbackExecution: 'd',
      repair: 'e',
      coordinatorExecution: 'f',
      coordinatorDispatch: 'g',
      subAgentTask: 'h',
    },
  };

  it('accepts passingScore 9 (default)', () => {
    const result = workflowRuntimeConfigSchema.parse(validConfig);
    expect(result.passingScore).toBe(9);
  });

  it('accepts passingScore 1 (minimum)', () => {
    const result = workflowRuntimeConfigSchema.parse({ ...validConfig, passingScore: 1 });
    expect(result.passingScore).toBe(1);
  });

  it('accepts passingScore 10 (maximum)', () => {
    const result = workflowRuntimeConfigSchema.parse({ ...validConfig, passingScore: 10 });
    expect(result.passingScore).toBe(10);
  });

  it('rejects passingScore 0', () => {
    expect(() =>
      workflowRuntimeConfigSchema.parse({ ...validConfig, passingScore: 0 }),
    ).toThrow();
  });

  it('rejects passingScore 11', () => {
    expect(() =>
      workflowRuntimeConfigSchema.parse({ ...validConfig, passingScore: 11 }),
    ).toThrow();
  });

  it('rejects missing passingScore', () => {
    const { passingScore: _, ...noPassing } = validConfig;
    expect(() => workflowRuntimeConfigSchema.parse(noPassing)).toThrow();
  });
});

describe('workflowRuntimeConfigSchema - maxPlanSteps', () => {
  const baseConfig = {
    claudeEffort: 'medium' as const,
    opencodeVariant: 'medium' as const,
    budgetCapUsd: null,
    commandTimeoutMs: 600_000,
    healthTimeoutMs: 15_000,
    opencodeTimeoutMs: 600_000,
    backoffBaseMs: 2_000,
    backoffMaxMs: 60_000,
    jsonRepairRetries: 3,
    processRetries: 3,
    executionRetries: 3,
    maxRepairAttemptsPerStep: 3,
    maxTotalRepairAttempts: 10,
    passingScore: 9,
    cleanupPeriodDays: 30,
    collaborationEnabled: true,
    maxPlanSteps: 8,
    promptTemplates: {
      planningInitial: 'a',
      planningStep: 'b',
      verification: 'c',
      fallbackExecution: 'd',
      repair: 'e',
      coordinatorExecution: 'f',
      coordinatorDispatch: 'g',
      subAgentTask: 'h',
    },
  };

  it('accepts maxPlanSteps 8 (default)', () => {
    const result = workflowRuntimeConfigSchema.parse(baseConfig);
    expect(result.maxPlanSteps).toBe(8);
  });

  it('accepts maxPlanSteps 1 (minimum)', () => {
    const result = workflowRuntimeConfigSchema.parse({ ...baseConfig, maxPlanSteps: 1 });
    expect(result.maxPlanSteps).toBe(1);
  });

  it('accepts maxPlanSteps 50 (maximum)', () => {
    const result = workflowRuntimeConfigSchema.parse({ ...baseConfig, maxPlanSteps: 50 });
    expect(result.maxPlanSteps).toBe(50);
  });

  it('rejects maxPlanSteps 0', () => {
    expect(() =>
      workflowRuntimeConfigSchema.parse({ ...baseConfig, maxPlanSteps: 0 }),
    ).toThrow();
  });

  it('rejects maxPlanSteps 51', () => {
    expect(() =>
      workflowRuntimeConfigSchema.parse({ ...baseConfig, maxPlanSteps: 51 }),
    ).toThrow();
  });

  it('rejects missing maxPlanSteps', () => {
    const { maxPlanSteps: _, ...noMax } = baseConfig;
    expect(() => workflowRuntimeConfigSchema.parse(noMax)).toThrow();
  });
});

describe('workflowRuntimeConfigUpdateSchema - passingScore', () => {
  it('accepts passingScore in update', () => {
    const result = workflowRuntimeConfigUpdateSchema.parse({ passingScore: 7 });
    expect(result.passingScore).toBe(7);
  });

  it('accepts empty update (all optional)', () => {
    const result = workflowRuntimeConfigUpdateSchema.parse({});
    expect(result.passingScore).toBeUndefined();
  });

  it('rejects passingScore 0 in update', () => {
    expect(() =>
      workflowRuntimeConfigUpdateSchema.parse({ passingScore: 0 }),
    ).toThrow();
  });
});

describe('workflowRuntimeConfigUpdateSchema - maxPlanSteps', () => {
  it('accepts maxPlanSteps in update', () => {
    const result = workflowRuntimeConfigUpdateSchema.parse({ maxPlanSteps: 5 });
    expect(result.maxPlanSteps).toBe(5);
  });

  it('accepts empty update (all optional)', () => {
    const result = workflowRuntimeConfigUpdateSchema.parse({});
    expect(result.maxPlanSteps).toBeUndefined();
  });

  it('rejects maxPlanSteps 0 in update', () => {
    expect(() =>
      workflowRuntimeConfigUpdateSchema.parse({ maxPlanSteps: 0 }),
    ).toThrow();
  });
});

describe('score-based routing logic', () => {
  const route = (score: number, passingScore: number): 'approved' | 'rejected' =>
    score >= passingScore ? 'approved' : 'rejected';

  it('score 9, passingScore 9 → approved', () => {
    expect(route(9, 9)).toBe('approved');
  });

  it('score 10, passingScore 9 → approved', () => {
    expect(route(10, 9)).toBe('approved');
  });

  it('score 8, passingScore 9 → rejected', () => {
    expect(route(8, 9)).toBe('rejected');
  });

  it('score 1, passingScore 9 → rejected', () => {
    expect(route(1, 9)).toBe('rejected');
  });

  it('score 5, passingScore 5 → approved (boundary)', () => {
    expect(route(5, 5)).toBe('approved');
  });

  it('score 4, passingScore 5 → rejected (boundary)', () => {
    expect(route(4, 5)).toBe('rejected');
  });

  it('score 10, passingScore 1 → approved (permissive threshold)', () => {
    expect(route(10, 1)).toBe('approved');
  });

  it('score 1, passingScore 10 → rejected (strict threshold)', () => {
    expect(route(1, 10)).toBe('rejected');
  });
});

describe('snapshot field regression', () => {
  it('verification response always contains score', () => {
    const raw = {
      status: 'approved',
      score: 9,
      summary: 'ok',
    };
    const parsed = verificationResponseSchema.parse(raw);
    expect(parsed).toHaveProperty('score');
    expect(typeof parsed.score).toBe('number');
  });

  it('config always contains passingScore', () => {
    const minimalConfig = {
      claudeEffort: 'medium' as const,
      opencodeVariant: 'medium' as const,
      budgetCapUsd: null,
      commandTimeoutMs: 1000,
      healthTimeoutMs: 1000,
      opencodeTimeoutMs: 1000,
      backoffBaseMs: 1000,
      backoffMaxMs: 1000,
      jsonRepairRetries: 1,
      processRetries: 1,
      executionRetries: 1,
      maxRepairAttemptsPerStep: 1,
      maxTotalRepairAttempts: 1,
      passingScore: 9,
      cleanupPeriodDays: 1,
      collaborationEnabled: false,
      maxPlanSteps: 8,
      promptTemplates: {
        planningInitial: 'a',
        planningStep: 'b',
        verification: 'c',
        fallbackExecution: 'd',
        repair: 'e',
        coordinatorExecution: 'f',
        coordinatorDispatch: 'g',
        subAgentTask: 'h',
      },
    };
    const parsed = workflowRuntimeConfigSchema.parse(minimalConfig);
    expect(parsed).toHaveProperty('passingScore');
    expect(typeof parsed.passingScore).toBe('number');
  });

  it('score and passingScore are independent integers', () => {
    const config = workflowRuntimeConfigSchema.parse({
      claudeEffort: 'medium' as const,
      opencodeVariant: 'medium' as const,
      budgetCapUsd: null,
      commandTimeoutMs: 1000,
      healthTimeoutMs: 1000,
      opencodeTimeoutMs: 1000,
      backoffBaseMs: 1000,
      backoffMaxMs: 1000,
      jsonRepairRetries: 1,
      processRetries: 1,
      executionRetries: 1,
      maxRepairAttemptsPerStep: 1,
      maxTotalRepairAttempts: 1,
      passingScore: 7,
      cleanupPeriodDays: 1,
      collaborationEnabled: false,
      maxPlanSteps: 8,
      promptTemplates: {
        planningInitial: 'a',
        planningStep: 'b',
        verification: 'c',
        fallbackExecution: 'd',
        repair: 'e',
        coordinatorExecution: 'f',
        coordinatorDispatch: 'g',
        subAgentTask: 'h',
      },
    });

    const response = verificationResponseSchema.parse({
      status: 'rejected',
      score: 6,
      summary: 'minor issues',
    });

    expect(response.score).toBeLessThan(config.passingScore);
    expect(response.score >= 1 && response.score <= 10).toBe(true);
    expect(config.passingScore >= 1 && config.passingScore <= 10).toBe(true);
  });
});

describe('coordinatorCompleteCommandSchema', () => {
  it('accepts complete command without saveMemories', () => {
    const result = coordinatorCompleteCommandSchema.parse({
      action: 'complete',
      summary: 'All done',
      all_tasks_completed: true,
    });
    expect(result.summary).toBe('All done');
    expect(result.saveMemories).toBeUndefined();
  });

  it('accepts complete command with saveMemories', () => {
    const result = coordinatorCompleteCommandSchema.parse({
      action: 'complete',
      summary: 'All done',
      all_tasks_completed: true,
      saveMemories: [
        { key: 'react_version', value: 'React 18' },
      ],
    });
    expect(result.saveMemories).toHaveLength(1);
    expect(result.saveMemories?.[0].key).toBe('react_version');
  });

  it('rejects complete command with empty summary', () => {
    expect(() =>
      coordinatorCompleteCommandSchema.parse({
        action: 'complete',
        summary: '',
        all_tasks_completed: true,
      }),
    ).toThrow();
  });
});
