import type { WorkflowSnapshot } from '../shared/ipc';
import { getWorkflowConfig } from './configManager';

/** Create a canonical idle snapshot from current config. */
export const createIdleSnapshot = (updatedAt?: string): WorkflowSnapshot => {
  const config = getWorkflowConfig();

  return {
    runId: null,
    lifecycle: 'idle',
    currentPhase: 'workflow',
    executionSubState: null,
    currentStepId: 0,
    currentRetryCount: 0,
    stepRepairAttempts: 0,
    totalRepairAttempts: 0,
    maxRepairAttemptsPerStep: config.maxRepairAttemptsPerStep,
    maxTotalRepairAttempts: config.maxTotalRepairAttempts,
    passingScore: config.passingScore,
    lastVerificationScore: null,
    executionSettings: {
      claudeEffort: config.claudeEffort,
      opencodeVariant: config.opencodeVariant,
    },
    budget: {
      capUsd: config.budgetCapUsd,
      spentUsd: 0,
      remainingUsd: config.budgetCapUsd,
      exceeded: false,
      lastStepCostUsd: null,
    },
    plan: [],
    manualInterventionRequired: false,
    userPrompt: '',
    updatedAt: updatedAt ?? new Date().toISOString(),
    lastExecutionSummary: '',
    lastVerification: null,
    circuitBreaker: null,
    collaboration: null,
  };
};
