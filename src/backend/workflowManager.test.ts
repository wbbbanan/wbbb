import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all heavy dependencies before importing
vi.mock('./processRunner', () => ({
  runCommand: vi.fn(),
  runCommandWithStdin: vi.fn(),
  runCommandStreaming: vi.fn(),
  killProcessTree: vi.fn(),
  killAllTrackedProcesses: vi.fn(),
  delay: vi.fn(() => Promise.resolve()),
  getBackoffDelay: vi.fn(() => 100),
  formatCommand: vi.fn(() => 'mock-command'),
  resolveWindowsSpawnTarget: vi.fn((bin, args) => ({ bin, args })),
}));

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
    passingScore: 9,
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
  getWorkflowConfigSnapshot: vi.fn(() => ({
    config: {},
    sources: {
      userConfigPath: '',
      projectConfigPath: '',
      loadedFromUserConfig: false,
      loadedFromProjectConfig: false,
      envOverrides: [],
      updatedAt: new Date().toISOString(),
    },
  })),
  renderPromptTemplate: vi.fn((template) => template),
  reloadWorkflowConfig: vi.fn(),
  updateWorkflowConfig: vi.fn(),
}));

vi.mock('./workflowStateMachine', () => {
  const defaultSnapshot = {
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
    executionSettings: { claudeEffort: 'medium', opencodeVariant: 'medium' },
    budget: { capUsd: null, spentUsd: 0, remainingUsd: null, exceeded: false, lastStepCostUsd: null },
    plan: [],
    manualInterventionRequired: false,
    userPrompt: '',
    updatedAt: new Date().toISOString(),
    lastExecutionSummary: '',
    lastVerification: null,
    circuitBreaker: null,
    collaboration: null,
  };

  return {
    WorkflowStateMachine: class MockWorkflowStateMachine {
      private currentRunId: string | null = null;
      private currentUserPrompt = '';
      private lastExecutionSummary = '';
      private plan: Array<{ step_id: number; description: string; status: 'active' | 'pending' }> = [{ step_id: 1, description: 'Initial step', status: 'active' }];
      getSnapshot() {
        return {
          ...defaultSnapshot,
          runId: this.currentRunId,
          userPrompt: this.currentUserPrompt,
          lastExecutionSummary: this.lastExecutionSummary,
          plan: this.plan,
          currentStepId: this.plan[0]?.step_id ?? 0,
        };
      }
      async start(prompt: string, opts?: { runId?: string }) {
        this.currentRunId = opts?.runId ?? null;
        this.currentUserPrompt = prompt;
        this.plan = [{ step_id: 1, description: 'Initial step', status: 'active' }];
        return this.getSnapshot();
      }
      async resume() { return this.getSnapshot(); }
      async retryCurrentStep() { return this.getSnapshot(); }
      pause() { return this.getSnapshot(); }
      cancel() { return this.getSnapshot(); }
      manualApprove() { return this.getSnapshot(); }
      manualReject() { return this.getSnapshot(); }
      editPlanStep() { return this.getSnapshot(); }
      insertPlanStep(afterStepId: number | null, input: { description: string }) {
        const insertIndex = afterStepId == null ? this.plan.length : this.plan.findIndex((step) => step.step_id === afterStepId) + 1;
        this.plan.splice(insertIndex, 0, { step_id: 0, description: input.description, status: 'pending' });
        this.plan = this.plan.map((step, index) => ({ ...step, step_id: index + 1 }));
        return this.getSnapshot();
      }
      removePlanStep(stepId: number) {
        this.plan = this.plan.filter((step) => step.step_id !== stepId).map((step, index) => ({ ...step, step_id: index + 1 }));
        return this.getSnapshot();
      }
      reorderPlanStep(stepId: number, targetIndex: number) {
        const currentIndex = this.plan.findIndex((step) => step.step_id === stepId);
        const [step] = this.plan.splice(currentIndex, 1);
        this.plan.splice(targetIndex, 0, step);
        this.plan = this.plan.map((item, index) => ({ ...item, step_id: index + 1 }));
        return this.getSnapshot();
      }
      movePlanStep(stepId: number, direction: 'up' | 'down') {
        const currentIndex = this.plan.findIndex((step) => step.step_id === stepId);
        const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
        const [step] = this.plan.splice(currentIndex, 1);
        this.plan.splice(targetIndex, 0, step);
        this.plan = this.plan.map((item, index) => ({ ...item, step_id: index + 1 }));
        return this.getSnapshot();
      }
      skipStep() { return this.getSnapshot(); }
      sendCollaborationMessage(content: string) {
        this.lastExecutionSummary = content;
        return this.getSnapshot();
      }
      hydrate() {}
      applyRuntimeConfig() {}
      getPersistedState() { return null; }
    },
  };
});

vi.mock('./workflowSessionStore', () => {
  return {
    WorkflowSessionStore: class MockWorkflowSessionStore {
      load() {
        return {
          activeSessionId: null,
          queuedSessionIds: [],
          scheduledSessionIds: [],
          sessions: [],
        };
      }
      save() {}
    },
    clonePersistedState: vi.fn((v: any) => JSON.parse(JSON.stringify(v))),
  };
});

vi.mock('./workflowRecovery', () => ({
  createInterruptedRecovery: vi.fn(() => ({
    category: 'interrupted',
    action: 'resume-from-checkpoint',
    summary: 'test recovery',
    autoRetryable: false,
    classifiedAt: new Date().toISOString(),
  })),
  classifyWorkflowError: vi.fn(() => ({
    category: 'unknown',
    action: 'manual-review',
    summary: 'test error',
    autoRetryable: false,
    classifiedAt: new Date().toISOString(),
  })),
}));

import { WorkflowManager } from './workflowManager';

describe('WorkflowManager', () => {
  let manager: WorkflowManager;
  let publishedEvents: any[];

  beforeEach(() => {
    publishedEvents = [];
    manager = new WorkflowManager('/tmp/test-base', (envelope) => {
      publishedEvents.push(envelope);
    });
  });

  describe('getSnapshot', () => {
    it('returns idle snapshot when no sessions exist', () => {
      const snapshot = manager.getSnapshot();
      expect(snapshot.lifecycle).toBe('idle');
      expect(snapshot.runId).toBeNull();
    });
  });

  describe('listSessions', () => {
    it('returns empty array when no sessions exist', () => {
      const sessions = manager.listSessions();
      expect(sessions).toEqual([]);
    });
  });

  describe('getQueue', () => {
    it('returns empty queue initially', () => {
      const queue = manager.getQueue();
      expect(queue.activeSessionId).toBeNull();
      expect(queue.queuedSessionIds).toEqual([]);
      expect(queue.scheduledSessionIds).toEqual([]);
    });
  });

  describe('start', () => {
    it('creates a new session with the given prompt', async () => {
      const snapshot = await manager.start('Test prompt');
      expect(snapshot.runId).toBeTruthy();
      expect(snapshot.userPrompt).toBe('Test prompt');
    });

    it('rejects empty prompt', async () => {
      await expect(manager.start('')).rejects.toThrow('Prompt is required.');
      await expect(manager.start('   ')).rejects.toThrow('Prompt is required.');
    });

    it('queues second session when one is active', async () => {
      const first = await manager.start('First');
      const second = await manager.start('Second');

      // Second should be queued since first is active
      expect(second.lifecycle).toBe('queued');
    });
  });

  describe('resumeSession', () => {
    it('keeps a queued session at the front when another workflow is active', async () => {
      const first = await manager.start('First');
      const second = await manager.start('Second');

      const resumed = await manager.resumeSession(second.runId!);
      const queue = manager.getQueue();
      const session = manager.getSession(second.runId!);

      expect(first.runId).not.toBe(second.runId);
      expect(resumed.lifecycle).toBe('queued');
      expect(session.executionState).toBe('queued');
      expect(queue.activeSessionId).toBe(first.runId);
      expect(queue.queuedSessionIds[0]).toBe(second.runId);
    });
  });

  describe('pause', () => {
    it('throws when no active workflow', () => {
      expect(() => manager.pause()).toThrow('No active workflow is running.');
    });
  });

  describe('sendCollaborationMessage', () => {
    it('commits the returned snapshot into the active session record', async () => {
      const started = await manager.start('Test prompt');

      const snapshot = manager.sendCollaborationMessage('Operator note');
      const session = manager.getSession(started.runId!);

      expect(snapshot.lastExecutionSummary).toBe('Operator note');
      expect(session.snapshot.lastExecutionSummary).toBe('Operator note');
    });
  });

  describe('insertPlanStep', () => {
    it('commits the inserted plan step into the active session record', async () => {
      const started = await manager.start('Test prompt');

      const snapshot = manager.insertPlanStep(1, { description: 'Added step' });
      const session = manager.getSession(started.runId!);

      expect(snapshot.plan.map((step) => step.description)).toEqual(['Initial step', 'Added step']);
      expect(session.snapshot.plan.map((step) => step.description)).toEqual(['Initial step', 'Added step']);
    });
  });

  describe('movePlanStep', () => {
    it('persists reordered plan steps on the active session record', async () => {
      const started = await manager.start('Test prompt');
      manager.insertPlanStep(1, { description: 'Second step' });

      const snapshot = manager.movePlanStep(2, 'up');
      const session = manager.getSession(started.runId!);

      expect(snapshot.plan.map((step) => step.description)).toEqual(['Second step', 'Initial step']);
      expect(session.snapshot.plan.map((step) => step.description)).toEqual(['Second step', 'Initial step']);
    });
  });

  describe('reorderPlanStep', () => {
    it('persists drag-style reorder results on the active session record', async () => {
      const started = await manager.start('Test prompt');
      manager.insertPlanStep(1, { description: 'Second step' });
      manager.insertPlanStep(2, { description: 'Third step' });

      const snapshot = manager.reorderPlanStep(1, 2);
      const session = manager.getSession(started.runId!);

      expect(snapshot.plan.map((step) => step.description)).toEqual(['Second step', 'Third step', 'Initial step']);
      expect(session.snapshot.plan.map((step) => step.description)).toEqual(['Second step', 'Third step', 'Initial step']);
    });
  });

  describe('cancel', () => {
    it('throws when no active workflow', () => {
      expect(() => manager.cancel()).toThrow('No active workflow is loaded.');
    });
  });

  describe('manualApprove', () => {
    it('throws when no active workflow', () => {
      expect(() => manager.manualApprove()).toThrow('No active workflow is loaded.');
    });
  });

  describe('manualReject', () => {
    it('throws when no active workflow', () => {
      expect(() => manager.manualReject()).toThrow('No active workflow is loaded.');
    });
  });

  describe('retryCurrentStep', () => {
    it('throws when no circuit-breaker checkpoint is waiting', async () => {
      await expect(manager.retryCurrentStep()).rejects.toThrow('No circuit-breaker checkpoint');
    });
  });
});
