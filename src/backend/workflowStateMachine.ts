import crypto from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ZodType } from 'zod';
import {
  type CollaborationHints,
  type CollaborationSessionSnapshot,
  type CircuitBreakerState,
  type PlanStep,
  type PlanStepStatus,
  type PlanningResponse,
  type WorkflowBudgetSummary,
  type WorkflowActivityItem,
  type WorkflowRuntimeConfig,
  type VerificationResponse,
  type WorkflowEvent,
  type WorkflowEventEnvelope,
  type WorkflowLifecycle,
  type WorkflowNodeStatus,
  type WorkflowPhase,
  type WorkflowRecoveryDescriptor,
  type WorkflowSnapshot,
} from '../shared/ipc';
import { planningResponseSchema, verificationResponseSchema } from '../shared/schema';
import { CollaborationCoordinator } from './collaborationCoordinator';
import { cloneJson } from './cloneUtils';
import { getWorkflowConfig, renderPromptTemplate } from './configManager';
import { type CommandResult, formatCommand, ProcessAbortError, ProcessExecutionError, runCommand, runCommandWithStdin, withExponentialBackoff } from './processRunner';
import { classifyWorkflowError } from './workflowRecovery';
import type {
  ClaudeExecutionDetails,
  ClaudeStreamEvent,
  OpencodeJsonEvent,
  OpencodeStreamDetails,
} from './streamEvents';
import {
  extractWorkflowChangePreview,
  limitActivityTrace as limitActivityTraceShared,
  parseStructuredOpencodeOutput as parseStructuredOpencodeOutputShared,
} from './workflowOutputParser';
import {
  insertPlanStep as insertPlanStepInContext,
  movePlanStep as movePlanStepInContext,
  reorderPlanStep as reorderPlanStepInContext,
  removePlanStep as removePlanStepInContext,
} from './workflowHelpers';
import { buildToolLaunchSpec } from './toolRuntimeConfig';
import type { WorkflowPersistedContext, WorkflowStateMachinePersistedState } from './workflowRuntimeTypes';

type NodePtyModule = typeof import('node-pty');
type NodePtyProcess = import('node-pty').IPty;

declare const __non_webpack_require__: NodeJS.Require | undefined;

type RetriablePhase = 'planning' | 'execution' | 'verification';
type IndexedPhase = WorkflowPhase;

interface PhaseMetrics {
  nextAttempt: number;
  failureStreak: number;
}

interface ActiveStage {
  phase: WorkflowPhase;
  stepId: number;
  retryCount: number;
  nodeId: string;
}

interface WorkflowContext {
  runId: string;
  userPrompt: string;
  plan: PlanStep[];
  currentStepIndex: number;
  currentPhase: WorkflowPhase;
  executionSubState: import('../shared/ipc').ExecutionSubState | null;
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
  executionHistory: import('../shared/ipc').ExecutionHistoryEntry[];
  agentMemory: import('../shared/ipc').AgentMemoryEntry[];
}

interface WorkflowStartOptions {
  runId?: string;
}

class StructuredOutputError extends Error {
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

const JSON_REPAIR_SUFFIX = 'JSON格式无效或结构错误，请严格按要求重试，只输出合法 JSON。';
const MAX_ACTIVITY_TEXT_LENGTH = 2_500;
const MAX_ACTIVITY_PAYLOAD_LENGTH = 1_800;

let nodePtyModule: NodePtyModule | null = null;

const toError = (value: unknown): Error => {
  if (value instanceof Error) {
    return value;
  }

  return new Error(typeof value === 'string' ? value : JSON.stringify(value));
};

const excerpt = (value: string, maxLength = 2_000): string => {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...`;
};

const formatActivityPayload = (value: unknown, maxLength = MAX_ACTIVITY_PAYLOAD_LENGTH): string | undefined => {
  if (typeof value === 'undefined' || value === null) {
    return undefined;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? excerpt(trimmed, maxLength) : undefined;
  }

  try {
    return excerpt(JSON.stringify(value, null, 2), maxLength);
  } catch {
    return excerpt(String(value), maxLength);
  }
};

const toIsoTimestamp = (value?: number): string | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  return new Date(value).toISOString();
};

const getRuntimeRequire = (): NodeJS.Require => {
  if (typeof __non_webpack_require__ === 'function') {
    return __non_webpack_require__;
  }

  return require;
};

const resolveNodePtyEntryPath = (): string => {
  const candidates = [
    typeof process.resourcesPath === 'string'
      ? path.join(process.resourcesPath, 'node-pty-runtime', 'lib', 'index.js')
      : null,
    path.resolve(__dirname, '..', '..', 'node_modules', 'node-pty', 'lib', 'index.js'),
    path.resolve(process.cwd(), 'node_modules', 'node-pty', 'lib', 'index.js'),
  ].filter((candidate): candidate is string => typeof candidate === 'string');

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Unable to locate node-pty runtime. Checked: ${candidates.join(', ')}`);
};

const getNodePtyModule = (): NodePtyModule => {
  if (!nodePtyModule) {
    nodePtyModule = getRuntimeRequire()(resolveNodePtyEntryPath()) as NodePtyModule;
  }

  return nodePtyModule;
};

const createIdleSnapshot = (): WorkflowSnapshot => {
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
    updatedAt: new Date().toISOString(),
    lastExecutionSummary: '',
    lastVerification: null,
    circuitBreaker: null,
    collaboration: null,
  };
};

export class WorkflowStateMachine {
  private readonly publish: (envelope: WorkflowEventEnvelope) => void;
  private readonly collaboration = new CollaborationCoordinator();
  private context: WorkflowContext | null = null;
  private snapshot: WorkflowSnapshot = createIdleSnapshot();
  private readonly phaseMetrics = new Map<string, PhaseMetrics>();
  private drivePromise: Promise<void> | null = null;
  private pauseRequested = false;
  private cancelRequested = false;
  private activeCommandAbortController: AbortController | null = null;
  private activePtyProcess: NodePtyProcess | null = null;

  constructor(publish: (envelope: WorkflowEventEnvelope) => void) {
    this.publish = publish;
  }

  getSnapshot(): WorkflowSnapshot {
    return this.snapshot;
  }

  applyRuntimeConfig(config: WorkflowRuntimeConfig): WorkflowSnapshot {
    const executionSettings = {
      claudeEffort: config.claudeEffort,
      opencodeVariant: config.opencodeVariant,
    };

    if (!this.context) {
      this.snapshot = {
        ...this.snapshot,
        executionSettings,
        budget: {
          ...this.snapshot.budget,
          capUsd: config.budgetCapUsd,
          remainingUsd: config.budgetCapUsd == null ? null : Math.max(0, config.budgetCapUsd - this.snapshot.budget.spentUsd),
          exceeded: config.budgetCapUsd == null ? false : this.snapshot.budget.spentUsd >= config.budgetCapUsd,
        },
        maxRepairAttemptsPerStep: config.maxRepairAttemptsPerStep,
        maxTotalRepairAttempts: config.maxTotalRepairAttempts,
        passingScore: config.passingScore,
      };
      return this.snapshot;
    }

    this.refreshSnapshot({
      executionSettings,
      budget: this.buildBudgetSummary(config.budgetCapUsd),
      maxRepairAttemptsPerStep: config.maxRepairAttemptsPerStep,
      maxTotalRepairAttempts: config.maxTotalRepairAttempts,
      passingScore: config.passingScore,
    });

    return this.snapshot;
  }

  async start(prompt: string, options?: WorkflowStartOptions): Promise<WorkflowSnapshot> {
    const normalizedPrompt = prompt.trim();

    if (!normalizedPrompt) {
      throw new Error('Prompt is required.');
    }

    if (this.snapshot.lifecycle === 'running' || this.snapshot.lifecycle === 'paused') {
      throw new Error('A workflow is already active.');
    }

    const config = getWorkflowConfig();
    const runId = options?.runId ?? crypto.randomUUID();
    const collaborationSession = this.collaboration.createWorkflowSession(runId, normalizedPrompt);
    this.pauseRequested = false;
    this.cancelRequested = false;
    this.activeCommandAbortController = null;
    this.activePtyProcess = null;
    this.phaseMetrics.clear();
    this.context = {
      runId,
      userPrompt: normalizedPrompt,
      plan: [],
      currentStepIndex: 0,
      currentPhase: 'planning',
      executionSubState: null,
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
      collaborationSessionId: collaborationSession?.sessionId ?? null,
      collaborationHints: null,
      executionHistory: [],
      agentMemory: [],
    };

    this.snapshot = {
      runId,
      lifecycle: 'running',
      currentPhase: 'planning',
      executionSubState: null,
      currentStepId: 1,
      currentRetryCount: 1,
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
      userPrompt: normalizedPrompt,
      updatedAt: new Date().toISOString(),
      lastExecutionSummary: '',
      lastVerification: null,
      circuitBreaker: null,
      collaboration: collaborationSession,
    };

    this.emitStandaloneEvent('workflow', 0, 'running', '工作流已启动', '等待 OpenCode 规划多阶段计划。');
    this.startDrive();

    return this.snapshot;
  }

  async continueWorkflow(newPrompt: string): Promise<WorkflowSnapshot> {
    if (!this.context) {
      throw new Error('No workflow session is loaded.');
    }

    if (this.snapshot.lifecycle === 'running') {
      throw new Error('A workflow is already active.');
    }

    const normalizedPrompt = newPrompt.trim();

    if (!normalizedPrompt) {
      throw new Error('Prompt is required.');
    }

    // Preserve budget (cumulative)
    const preservedBudget = { ...this.snapshot.budget };

    // Update context for new round
    this.context.userPrompt = normalizedPrompt;
    this.context.currentPhase = 'planning';
    this.context.currentStepIndex = 0;
    this.context.executionSubState = null;
    this.context.currentExecutionPrompt = '';
    this.context.stepRepairAttempts = 0;
    this.context.totalRepairAttempts = 0;
    this.context.lastExecutionSummary = '';
    this.context.lastVerification = null;
    this.context.lastVerificationScore = null;
    this.context.manualInterventionRequired = false;
    this.context.circuitBreaker = null;

    // Update snapshot
    this.snapshot.userPrompt = normalizedPrompt;
    this.snapshot.lifecycle = 'running';
    this.snapshot.currentPhase = 'planning';
    this.snapshot.executionSubState = null;
    this.snapshot.currentStepId = 1;
    this.snapshot.currentRetryCount = 1;
    this.snapshot.stepRepairAttempts = 0;
    this.snapshot.totalRepairAttempts = 0;
    this.snapshot.lastExecutionSummary = '';
    this.snapshot.lastVerification = null;
    this.snapshot.lastVerificationScore = null;
    this.snapshot.manualInterventionRequired = false;
    this.snapshot.circuitBreaker = null;
    this.snapshot.updatedAt = new Date().toISOString();
    this.snapshot.budget = preservedBudget;

    this.pauseRequested = false;
    this.cancelRequested = false;
    this.activeCommandAbortController = null;
    this.activePtyProcess = null;

    this.emitStandaloneEvent('workflow', 0, 'running', '继续工作流', `用户追加指令：${normalizedPrompt}`);
    this.startDrive();

    return this.snapshot;
  }

  async resume(): Promise<WorkflowSnapshot> {
    if (!this.context) {
      throw new Error('No workflow session is loaded.');
    }

    if (this.snapshot.lifecycle === 'running') {
      return this.snapshot;
    }

    if (this.snapshot.lifecycle === 'needs_review') {
      throw new Error('The workflow is waiting for manual approval or rejection.');
    }

    this.pauseRequested = false;
    this.cancelRequested = false;
    this.refreshSnapshot({
      lifecycle: 'running',
      currentPhase: this.context.currentPhase,
      currentStepId: this.getCurrentStep()?.step_id ?? this.snapshot.currentStepId,
      manualInterventionRequired: this.context.manualInterventionRequired,
    });

    this.startDrive();

    return this.snapshot;
  }

  pause(): WorkflowSnapshot {
    if (!this.context) {
      throw new Error('No workflow session is loaded.');
    }

    if (this.snapshot.lifecycle === 'paused' || this.pauseRequested) {
      return this.snapshot;
    }

    if (this.snapshot.lifecycle !== 'running') {
      throw new Error('Only a running workflow can be paused.');
    }

    this.pauseRequested = true;
    return this.snapshot;
  }

  cancel(): WorkflowSnapshot {
    if (!this.context) {
      throw new Error('No workflow session is loaded.');
    }

    if (this.snapshot.lifecycle === 'completed' || this.snapshot.lifecycle === 'failed') {
      return this.snapshot;
    }

    this.cancelRequested = true;
    this.pauseRequested = false;
    this.context.manualInterventionRequired = false;
    this.context.circuitBreaker = null;
    this.activeCommandAbortController?.abort();

    if (this.activePtyProcess) {
      try {
        this.activePtyProcess.kill();
      } catch {
        // Ignore secondary PTY termination errors during cancellation.
      }

      this.activePtyProcess = null;
    }

    this.refreshSnapshot({
      lifecycle: 'failed',
      currentPhase: this.context.currentPhase,
      currentStepId: this.getCurrentStep()?.step_id ?? this.snapshot.currentStepId,
      manualInterventionRequired: false,
      circuitBreaker: null,
    });
    this.emitStandaloneEvent(this.context.currentPhase, this.snapshot.currentStepId, 'error', '工作流已取消', '用户已取消当前 workflow。');

    return this.snapshot;
  }

  manualApprove(): WorkflowSnapshot {
    if (!this.context || this.snapshot.lifecycle !== 'needs_review') {
      throw new Error('No workflow is waiting for manual approval.');
    }

    const currentStep = this.getRequiredCurrentStep();
    const nextIndex = this.findNextActionableStepIndex(this.context.currentStepIndex + 1);

    this.pauseRequested = false;
    this.cancelRequested = false;
    this.context.manualInterventionRequired = false;
    this.context.circuitBreaker = null;
    this.context.stepRepairAttempts = 0;
    this.context.lastVerificationScore = null;
    this.context.plan[this.context.currentStepIndex] = {
      ...this.context.plan[this.context.currentStepIndex],
      status: 'completed',
    };

    if (nextIndex === -1) {
      this.context.currentPhase = 'completed';
      this.syncPlanStatuses();
      this.refreshSnapshot({
        lifecycle: 'completed',
        currentPhase: 'completed',
        currentStepId: currentStep.step_id,
        manualInterventionRequired: false,
        circuitBreaker: null,
        stepRepairAttempts: this.context.stepRepairAttempts,
        totalRepairAttempts: this.context.totalRepairAttempts,
        lastVerificationScore: null,
      });
      this.emitStandaloneEvent('decision', currentStep.step_id, 'success', '人工裁决通过', '当前步骤已人工通过，workflow 完成。');
      return this.snapshot;
    }

    const nextStep = this.context.plan[nextIndex];
    this.context.currentStepIndex = nextIndex;
    this.context.currentPhase = 'planning';
    this.context.currentExecutionPrompt = '';
    this.syncPlanStatuses();
    this.refreshSnapshot({
      lifecycle: 'running',
      currentPhase: 'planning',
      currentStepId: nextStep.step_id,
      manualInterventionRequired: false,
      circuitBreaker: null,
      stepRepairAttempts: this.context.stepRepairAttempts,
      totalRepairAttempts: this.context.totalRepairAttempts,
      lastVerificationScore: null,
    });
    this.emitStandaloneEvent('decision', currentStep.step_id, 'success', '人工裁决通过', `步骤 ${currentStep.step_id} 已人工通过，切换到步骤 ${nextStep.step_id}。`);
    this.startDrive();

    return this.snapshot;
  }

  manualReject(): WorkflowSnapshot {
    if (!this.context || this.snapshot.lifecycle !== 'needs_review') {
      throw new Error('No workflow is waiting for manual rejection.');
    }

    const currentStep = this.getRequiredCurrentStep();
    this.pauseRequested = false;
    this.cancelRequested = false;
    this.context.manualInterventionRequired = false;
    this.context.currentPhase = 'decision';
    this.context.circuitBreaker = null;
    this.refreshSnapshot({
      lifecycle: 'failed',
      currentPhase: 'decision',
      currentStepId: currentStep.step_id,
      manualInterventionRequired: false,
      circuitBreaker: null,
      stepRepairAttempts: this.context.stepRepairAttempts,
      totalRepairAttempts: this.context.totalRepairAttempts,
    });
    this.emitStandaloneEvent('decision', currentStep.step_id, 'error', '人工裁决拒绝', '当前 workflow 已被人工拒绝并终止。');

    return this.snapshot;
  }

  editPlanStep(stepId: number, update: { description?: string; promptOverride?: string | null; notes?: string | null }): WorkflowSnapshot {
    if (!this.context) {
      throw new Error('No workflow session is loaded.');
    }

    if (this.snapshot.lifecycle === 'running') {
      throw new Error('Pause the workflow before editing the plan.');
    }

    const stepIndex = this.findStepIndex(stepId);

    if (stepIndex === -1) {
      throw new Error(`Unknown plan step: ${stepId}`);
    }

    const existing = this.context.plan[stepIndex];
    const description = update.description?.trim() || existing.description;
    const promptOverride = typeof update.promptOverride === 'string' ? update.promptOverride.trim() || undefined : existing.promptOverride;
    const notes = typeof update.notes === 'string' ? update.notes.trim() || undefined : existing.notes;

    this.context.plan[stepIndex] = {
      ...existing,
      description,
      promptOverride,
      notes,
      updatedAt: new Date().toISOString(),
    };

    if (stepIndex === this.context.currentStepIndex) {
      this.context.currentPhase = 'planning';
      this.context.currentExecutionPrompt = '';
      this.context.manualInterventionRequired = false;
      this.context.circuitBreaker = null;
      this.refreshSnapshot({
        lifecycle: 'paused',
        currentPhase: 'planning',
        currentStepId: stepId,
        manualInterventionRequired: false,
        circuitBreaker: null,
      });
    } else {
      this.refreshSnapshot({ plan: this.context.plan });
    }

    this.syncPlanStatuses();
    this.emitStandaloneEvent('workflow', stepId, 'success', '计划步骤已更新', `步骤 ${stepId} 的描述或提示词覆盖已更新。`, undefined, {
      step_description: description,
      prompt_override: promptOverride,
    });
    return this.snapshot;
  }

  insertPlanStep(afterStepId: number | null, input: { description: string; promptOverride?: string | null; notes?: string | null }): WorkflowSnapshot {
    if (!this.context) {
      throw new Error('No workflow session is loaded.');
    }

    if (this.snapshot.lifecycle === 'running') {
      throw new Error('Pause the workflow before editing the plan.');
    }

    const result = insertPlanStepInContext(this.context, afterStepId, input);
    this.context.plan = result.plan;
    this.context.currentStepIndex = result.currentStepIndex;
    this.context.currentPhase = 'planning';
    this.context.currentExecutionPrompt = '';
    this.context.manualInterventionRequired = false;
    this.context.circuitBreaker = null;
    this.syncPlanStatuses();

    this.refreshSnapshot({
      lifecycle: 'paused',
      currentPhase: 'planning',
      currentStepId: this.getCurrentStep()?.step_id ?? result.insertedStepId,
      manualInterventionRequired: false,
      circuitBreaker: null,
    });

    this.emitStandaloneEvent('workflow', result.insertedStepId, 'success', '计划步骤已新增', `已插入步骤 ${result.insertedStepId}，后续步骤编号已自动更新。`, undefined, {
      inserted_after_step_id: afterStepId,
      step_description: this.context.plan[result.insertedStepId - 1]?.description,
    });
    return this.snapshot;
  }

  removePlanStep(stepId: number): WorkflowSnapshot {
    if (!this.context) {
      throw new Error('No workflow session is loaded.');
    }

    if (this.snapshot.lifecycle === 'running') {
      throw new Error('Pause the workflow before editing the plan.');
    }

    const result = removePlanStepInContext(this.context, stepId);
    this.context.plan = result.plan;
    this.context.currentStepIndex = result.currentStepIndex ?? result.plan.length;
    this.context.currentExecutionPrompt = '';
    this.context.manualInterventionRequired = false;
    this.context.circuitBreaker = null;

    if (result.currentStepIndex === null) {
      this.context.currentPhase = 'completed';
      this.syncPlanStatuses();
      this.refreshSnapshot({
        lifecycle: 'completed',
        currentPhase: 'completed',
        currentStepId: 0,
        manualInterventionRequired: false,
        circuitBreaker: null,
      });
      this.emitStandaloneEvent('workflow', stepId, 'warning', '当前步骤已删除', '当前步骤已删除，workflow 已无剩余待执行步骤。');
      return this.snapshot;
    }

    this.context.currentPhase = 'planning';
    this.syncPlanStatuses();

    this.refreshSnapshot({
      lifecycle: 'paused',
      currentPhase: 'planning',
      currentStepId: this.getCurrentStep()?.step_id ?? 0,
      manualInterventionRequired: false,
      circuitBreaker: null,
    });

    this.emitStandaloneEvent('workflow', stepId, 'warning', '计划步骤已删除', `步骤 ${stepId} 已删除，后续步骤编号已自动更新。`);
    return this.snapshot;
  }

  reorderPlanStep(stepId: number, targetIndex: number): WorkflowSnapshot {
    if (!this.context) {
      throw new Error('No workflow session is loaded.');
    }

    if (this.snapshot.lifecycle === 'running') {
      throw new Error('Pause the workflow before editing the plan.');
    }

    const result = reorderPlanStepInContext(this.context, stepId, targetIndex);
    this.context.plan = result.plan;
    this.context.currentStepIndex = result.currentStepIndex;
    this.context.currentPhase = 'planning';
    this.context.currentExecutionPrompt = '';
    this.context.manualInterventionRequired = false;
    this.context.circuitBreaker = null;
    this.syncPlanStatuses();

    this.refreshSnapshot({
      lifecycle: 'paused',
      currentPhase: 'planning',
      currentStepId: this.getCurrentStep()?.step_id ?? result.movedStepId,
      manualInterventionRequired: false,
      circuitBreaker: null,
    });

    this.emitStandaloneEvent('workflow', result.movedStepId, 'success', '计划顺序已重排', '步骤顺序已按拖拽结果更新。');
    return this.snapshot;
  }

  movePlanStep(stepId: number, direction: 'up' | 'down'): WorkflowSnapshot {
    if (!this.context) {
      throw new Error('No workflow session is loaded.');
    }

    if (this.snapshot.lifecycle === 'running') {
      throw new Error('Pause the workflow before editing the plan.');
    }

    const result = movePlanStepInContext(this.context, stepId, direction);
    this.context.plan = result.plan;
    this.context.currentStepIndex = result.currentStepIndex;
    this.context.currentPhase = 'planning';
    this.context.currentExecutionPrompt = '';
    this.context.manualInterventionRequired = false;
    this.context.circuitBreaker = null;
    this.syncPlanStatuses();

    this.refreshSnapshot({
      lifecycle: 'paused',
      currentPhase: 'planning',
      currentStepId: this.getCurrentStep()?.step_id ?? result.movedStepId,
      manualInterventionRequired: false,
      circuitBreaker: null,
    });

    this.emitStandaloneEvent('workflow', result.movedStepId, 'success', `计划步骤已${direction === 'up' ? '上移' : '下移'}`, `步骤已${direction === 'up' ? '上移' : '下移'}，当前顺序已更新。`);
    return this.snapshot;
  }

  skipStep(stepId: number): WorkflowSnapshot {
    if (!this.context) {
      throw new Error('No workflow session is loaded.');
    }

    if (this.snapshot.lifecycle === 'running') {
      throw new Error('Pause the workflow before skipping a step.');
    }

    const stepIndex = this.findStepIndex(stepId);

    if (stepIndex === -1) {
      throw new Error(`Unknown plan step: ${stepId}`);
    }

    const timestamp = new Date().toISOString();
    this.context.plan[stepIndex] = {
      ...this.context.plan[stepIndex],
      status: 'skipped',
      skippedAt: timestamp,
      updatedAt: timestamp,
    };

    if (stepIndex === this.context.currentStepIndex) {
      const nextIndex = this.findNextActionableStepIndex(stepIndex + 1);
      this.context.manualInterventionRequired = false;
      this.context.circuitBreaker = null;
      this.context.currentExecutionPrompt = '';

      if (nextIndex === -1) {
        this.context.currentPhase = 'completed';
        this.syncPlanStatuses();
        this.refreshSnapshot({
          lifecycle: 'completed',
          currentPhase: 'completed',
          currentStepId: stepId,
          manualInterventionRequired: false,
          circuitBreaker: null,
        });
      } else {
        this.context.currentStepIndex = nextIndex;
        this.context.currentPhase = 'planning';
        this.syncPlanStatuses();
        this.refreshSnapshot({
          lifecycle: 'paused',
          currentPhase: 'planning',
          currentStepId: this.context.plan[nextIndex].step_id,
          manualInterventionRequired: false,
          circuitBreaker: null,
        });
      }
    } else {
      this.syncPlanStatuses();
      this.refreshSnapshot({ plan: this.context.plan });
    }

    this.emitStandaloneEvent('workflow', stepId, 'warning', '计划步骤已跳过', `步骤 ${stepId} 已被 operator 标记为跳过。`);
    return this.snapshot;
  }

  sendCollaborationMessage(content: string): WorkflowSnapshot {
    if (!this.context) {
      throw new Error('No workflow session is loaded.');
    }

    const normalized = content.trim();

    if (!normalized) {
      throw new Error('Message content is required.');
    }

    const collaboration = this.collaboration.appendOperatorMessage(this.context.collaborationSessionId, normalized);
    this.refreshSnapshot({ collaboration });
    this.emitStandaloneEvent('workflow', this.snapshot.currentStepId, 'success', '协作消息已发送', normalized, undefined, {
      collaboration_session_id: collaboration?.sessionId,
    });
    return this.snapshot;
  }

  hydrate(persistedState: WorkflowStateMachinePersistedState): WorkflowSnapshot {
    const config = getWorkflowConfig();
    const persistedContext = cloneJson(persistedState.context);
    const persistedSnapshot = cloneJson(persistedState.snapshot);

    this.context = {
      ...persistedContext,
      executionSubState: persistedContext.executionSubState ?? persistedSnapshot.executionSubState ?? null,
      executionHistory: persistedContext.executionHistory ?? [],
      agentMemory: persistedContext.agentMemory ?? [],
      stepRepairAttempts: persistedContext.stepRepairAttempts ?? persistedSnapshot.stepRepairAttempts ?? 0,
      totalRepairAttempts: persistedContext.totalRepairAttempts ?? persistedSnapshot.totalRepairAttempts ?? 0,
      sessionCostUsd: persistedContext.sessionCostUsd ?? persistedSnapshot.budget?.spentUsd ?? 0,
      lastStepCostUsd: persistedContext.lastStepCostUsd ?? persistedSnapshot.budget?.lastStepCostUsd ?? null,
      lastVerificationScore: persistedContext.lastVerificationScore ?? persistedSnapshot.lastVerificationScore ?? null,
    } as WorkflowContext;
    this.snapshot = {
      ...persistedSnapshot,
      executionSubState: persistedSnapshot.executionSubState ?? this.context.executionSubState,
      stepRepairAttempts: persistedSnapshot.stepRepairAttempts ?? this.context.stepRepairAttempts,
      totalRepairAttempts: persistedSnapshot.totalRepairAttempts ?? this.context.totalRepairAttempts,
      maxRepairAttemptsPerStep: persistedSnapshot.maxRepairAttemptsPerStep ?? config.maxRepairAttemptsPerStep,
      maxTotalRepairAttempts: persistedSnapshot.maxTotalRepairAttempts ?? config.maxTotalRepairAttempts,
      passingScore: persistedSnapshot.passingScore ?? config.passingScore,
      lastVerificationScore: persistedSnapshot.lastVerificationScore ?? this.context.lastVerificationScore,
      executionSettings: persistedSnapshot.executionSettings ?? {
        claudeEffort: config.claudeEffort,
        opencodeVariant: config.opencodeVariant,
      },
      budget: persistedSnapshot.budget ?? this.buildBudgetSummary(config.budgetCapUsd),
    };
    this.syncPlanStatuses();
    this.snapshot.plan = this.context.plan;
    this.phaseMetrics.clear();

    for (const metric of persistedState.phaseMetrics) {
      this.phaseMetrics.set(metric.key, {
        nextAttempt: metric.nextAttempt,
        failureStreak: metric.failureStreak,
      });
    }

    this.collaboration.hydrateSession(persistedState.collaborationSession);
    return this.snapshot;
  }

  getPersistedState(): WorkflowStateMachinePersistedState | null {
    if (!this.context) {
      return null;
    }

    const persistedContext: WorkflowPersistedContext = cloneJson({
      runId: this.context.runId,
      userPrompt: this.context.userPrompt,
      plan: this.context.plan,
      currentStepIndex: this.context.currentStepIndex,
      currentPhase: this.context.currentPhase,
      currentExecutionPrompt: this.context.currentExecutionPrompt,
      stepRepairAttempts: this.context.stepRepairAttempts,
      totalRepairAttempts: this.context.totalRepairAttempts,
      sessionCostUsd: this.context.sessionCostUsd,
      lastStepCostUsd: this.context.lastStepCostUsd,
      lastExecutionSummary: this.context.lastExecutionSummary,
      lastVerification: this.context.lastVerification,
      lastVerificationScore: this.context.lastVerificationScore,
      manualInterventionRequired: this.context.manualInterventionRequired,
      circuitBreaker: this.context.circuitBreaker,
      collaborationSessionId: this.context.collaborationSessionId,
      collaborationHints: this.context.collaborationHints,
      executionSubState: this.context.executionSubState,
      executionHistory: this.context.executionHistory,
      agentMemory: this.context.agentMemory,
      planningCollaboration: null,
      collaboration: this.collaboration.getSession(this.context.collaborationSessionId),
    });

    return {
      context: persistedContext,
      snapshot: cloneJson(this.snapshot),
      phaseMetrics: Array.from(this.phaseMetrics.entries()).map(([key, metrics]) => ({
        key,
        nextAttempt: metrics.nextAttempt,
        failureStreak: metrics.failureStreak,
      })),
      collaborationSession: cloneJson(this.collaboration.getSession(this.context.collaborationSessionId)),
    };
  }

  async retryCurrentStep(): Promise<WorkflowSnapshot> {
    if (!this.context || !this.context.manualInterventionRequired || !this.context.circuitBreaker) {
      throw new Error('No circuit-breaker checkpoint is waiting for manual retry.');
    }

    const breaker = this.context.circuitBreaker;
    const metrics = this.getMetrics(breaker.phase, breaker.stepId);
    metrics.failureStreak = 0;

    this.pauseRequested = false;
    this.cancelRequested = false;
    this.context.manualInterventionRequired = false;
    this.context.circuitBreaker = null;
    this.context.currentPhase = breaker.phase;

    this.refreshSnapshot({
      lifecycle: 'running',
      currentPhase: breaker.phase,
      currentStepId: breaker.stepId,
      manualInterventionRequired: false,
      circuitBreaker: null,
    });

    this.emitStandaloneEvent(
      'circuit-breaker',
      breaker.stepId,
      'success',
      '人工恢复已确认',
      `恢复到 ${breaker.phase} 阶段并从断点继续执行。`,
    );

    this.startDrive();

    return this.snapshot;
  }

  private async drive(): Promise<void> {
    if (!this.context) {
      return;
    }

    while (this.context && !this.context.manualInterventionRequired) {
      if (this.cancelRequested) {
        return;
      }

      if (this.pauseRequested) {
        this.pauseRequested = false;
        this.refreshSnapshot({
          lifecycle: 'paused',
          currentPhase: this.context.currentPhase,
          currentStepId: this.getCurrentStep()?.step_id ?? this.snapshot.currentStepId,
        });
        this.emitStandaloneEvent(this.context.currentPhase, this.snapshot.currentStepId, 'paused', '工作流已暂停', '已在阶段边界暂停，等待继续。');
        return;
      }

      switch (this.context.currentPhase) {
        case 'planning':
          await this.runPlanningStage();
          break;
        case 'execution':
          await this.runExecutionStage();
          break;
        case 'verification':
          await this.runVerificationStage();
          break;
        case 'decision':
          this.runDecisionStage();
          break;
        case 'completed':
          this.finishWorkflow();
          return;
        default:
          return;
      }
    }
  }

  private async runPlanningStage(): Promise<void> {
    if (!this.context) {
      return;
    }

    const currentStep = this.getCurrentStep() ?? { step_id: 1, description: '初始化计划' };
    const stage = this.beginStage('planning', currentStep.step_id, 'OpenCode 规划中', '正在构建或扩写当前步骤提示词。');

    if (currentStep.promptOverride?.trim()) {
      this.context.currentExecutionPrompt = currentStep.promptOverride.trim();
      this.context.currentPhase = 'execution';
      this.syncPlanStatuses();
      this.refreshSnapshot({
        currentPhase: 'execution',
        currentStepId: currentStep.step_id,
        plan: this.context.plan,
      });
      this.emitStageEvent(stage, 'success', '已采用人工覆盖提示词，跳过 OpenCode 扩写。', undefined, {
        step_description: currentStep.description,
        prompt_override: excerpt(currentStep.promptOverride, 3_000),
      });
      return;
    }

    const basePrompt = this.buildPlanningPrompt();

    try {
      const { response, rawOutput } = await this.runStructuredOpencode<PlanningResponse>(
        basePrompt,
        stage,
        planningResponseSchema,
        (parsed) => {
          const matchIndex = parsed.plan.findIndex((item) => item.step_id === parsed.current_step_id);

          if (matchIndex === -1) {
            throw new Error('current_step_id is not present in the returned plan.');
          }

          if (this.context && this.context.plan.length > 0) {
            const expectedStepId = this.context.plan[this.context.currentStepIndex]?.step_id;

            if (expectedStepId && parsed.current_step_id !== expectedStepId) {
              throw new Error(`Expected current_step_id=${expectedStepId}, received ${parsed.current_step_id}.`);
            }
          }

          return parsed;
        },
      );

      const currentStepIndex = response.plan.findIndex((item) => item.step_id === response.current_step_id);
      this.context.plan = this.mergePlanSteps(response.plan);
      this.context.currentStepIndex = currentStepIndex;
      this.context.currentExecutionPrompt = response.expanded_prompt_for_current_step;
      this.context.collaborationHints = response.collaboration_hints ?? null;
      this.context.currentPhase = 'execution';
      this.syncPlanStatuses();

      const collaborationSession = this.collaboration.recordPlanningTurn(
        this.context.collaborationSessionId,
        this.context.plan[currentStepIndex],
        response,
      );

      this.resetFailureStreak('planning', response.current_step_id);
      this.refreshSnapshot({
        currentPhase: 'execution',
        currentStepId: response.current_step_id,
        plan: this.context.plan,
        collaboration: collaborationSession,
      });

      const activityTrace = this.extractOpencodeActivityTrace(rawOutput);
      const streamDetails = this.extractOpencodeStreamDetails(activityTrace);

      this.emitStageEvent(stage, 'success', `步骤 ${response.current_step_id} 的扩写提示词已准备完成。`, undefined, {
        step_description: this.context.plan[currentStepIndex]?.description,
        expanded_prompt: excerpt(response.expanded_prompt_for_current_step, 3_000),
        reasoning_trace: excerpt(streamDetails.reasoning.join('\n\n'), 4_000),
        model_response: excerpt(streamDetails.text.join('\n\n'), 4_000),
        activity_trace: activityTrace,
        collaboration_mode: this.context.collaborationSessionId ? 'local-direct' : 'disabled',
        collaboration_roles: response.collaboration_hints?.suggested_agent_roles ?? [],
      });
    } catch (error) {
      if (this.cancelRequested) {
        return;
      }

      const normalizedError = toError(error);
      this.registerFailure('planning', currentStep.step_id);
      const stderr = error instanceof ProcessExecutionError ? error.stderr : '';
      const errorMessage = stderr.trim() ? `${normalizedError.message}\n\nstderr:\n${excerpt(stderr, 500)}` : normalizedError.message;
      this.emitStageEvent(stage, 'error', errorMessage, this.extractCommand(error), {
        raw_output: this.extractRawOutput(error),
      });
      this.triggerCircuitBreaker('planning', currentStep.step_id, stage.retryCount, normalizedError, this.extractCommand(error), this.extractRawOutput(error));
    }
  }

  private async runExecutionStage(): Promise<void> {
    if (!this.context) {
      return;
    }

    const currentStep = this.getRequiredCurrentStep();
    const stage = this.beginStage('execution', currentStep.step_id, 'Claude 执行中', '正在根据扩写提示词修改代码。');

    if (this.snapshot.budget.capUsd != null && this.context.sessionCostUsd >= this.snapshot.budget.capUsd) {
      this.pauseRequested = true;
      this.refreshSnapshot({ budget: this.buildBudgetSummary() });
      this.emitStageEvent(stage, 'warning', '当前累计成本已达到预算上限，请调整配置后继续。', undefined, {
        session_cost_usd: this.context.sessionCostUsd,
        budget_cap_usd: this.snapshot.budget.capUsd,
      });
      return;
    }

    const prompt = this.context.currentExecutionPrompt || this.buildFallbackExecutionPrompt(currentStep);

    try {
      const { summary, rawOutput, command, collaborationSession, collaborationPrompt, usedFallback, activityTrace, durationMs, totalCostUsd, totalTurns } = await this.executeClaudeStep(
        currentStep,
        prompt,
        stage,
      );

      this.context.lastExecutionSummary = summary;
      const stepCostUsd = totalCostUsd ?? 0;
      this.context.sessionCostUsd += stepCostUsd;
      this.context.lastStepCostUsd = stepCostUsd;
      this.context.currentPhase = 'verification';
      this.resetFailureStreak('execution', currentStep.step_id);
      this.refreshSnapshot({
        currentPhase: 'verification',
        currentStepId: currentStep.step_id,
        lastExecutionSummary: summary,
        budget: this.buildBudgetSummary(),
        collaboration: collaborationSession,
      });

      const budgetExceeded = this.snapshot.budget.capUsd != null && this.context.sessionCostUsd >= this.snapshot.budget.capUsd;

      if (budgetExceeded) {
        this.pauseRequested = true;
      }

      const changePreview = extractWorkflowChangePreview({
        activityTrace,
        rawOutput,
        executionSummary: summary,
      });

      this.emitStageEvent(stage, budgetExceeded ? 'warning' : 'success', budgetExceeded ? 'Claude 已完成执行，但累计成本已达到预算上限，工作流将在阶段边界暂停。' : 'Claude 已返回可用执行摘要，进入验收阶段。', command, {
        execution_summary: excerpt(summary, 1_500),
        raw_output: excerpt(rawOutput, 4_000),
        activity_trace: activityTrace,
        touched_files: changePreview.touchedFiles,
        change_preview: changePreview.preview ?? undefined,
        change_preview_format: changePreview.format ?? undefined,
        execution_duration_ms: durationMs,
        total_cost_usd: totalCostUsd,
        session_cost_usd: this.context.sessionCostUsd,
        remaining_budget_usd: this.buildBudgetSummary().remainingUsd,
        budget_cap_usd: this.snapshot.budget.capUsd,
        execution_turns: totalTurns,
        collaboration_mode: this.context.collaborationSessionId ? 'local-direct' : 'disabled',
        collaboration_session_id: collaborationSession?.sessionId,
        collaboration_message_count: collaborationSession?.messages.length,
        collaboration_latest_summary: collaborationSession?.latestSummary,
        collaboration_agents: collaborationSession?.agents.map((agent) => `${agent.label}:${agent.status}`),
        coordinator_prompt: collaborationPrompt ? excerpt(collaborationPrompt, 3_000) : undefined,
        fallback_reason: usedFallback ? '协调层执行失败，已自动回退到单 agent Claude 路径。' : undefined,
      });
    } catch (error) {
      if (this.cancelRequested) {
        return;
      }

      const normalizedError = toError(error);
      this.registerFailure('execution', currentStep.step_id);
      const claudeLaunch = buildToolLaunchSpec('claude');
      const directCommand = formatCommand(claudeLaunch.bin, ['-p', prompt, '--verbose', '--output-format', 'stream-json', '--dangerously-skip-permissions', '--effort', this.snapshot.executionSettings.claudeEffort]);
      this.emitStageEvent(stage, 'error', normalizedError.message, directCommand, {
        raw_output: this.extractRawOutput(error),
      });
      this.triggerCircuitBreaker('execution', currentStep.step_id, stage.retryCount, normalizedError, directCommand, this.extractRawOutput(error));
    }
  }

  private async runVerificationStage(): Promise<void> {
    if (!this.context) {
      return;
    }

    const currentStep = this.getRequiredCurrentStep();
    const stage = this.beginStage('verification', currentStep.step_id, 'OpenCode 验收中', '正在检查代码修改并触发验证命令。');
    const basePrompt = this.buildVerificationPrompt(currentStep);

    try {
      const { response, rawOutput } = await this.runStructuredOpencode<VerificationResponse>(
        basePrompt,
        stage,
        verificationResponseSchema,
        (parsed) => parsed,
      );

      this.context.lastVerification = response;
      this.context.lastVerificationScore = response.score;
      this.context.currentPhase = 'decision';
      const collaborationSession = this.collaboration.recordVerificationTurn(this.context.collaborationSessionId, currentStep, response);
      this.resetFailureStreak('verification', currentStep.step_id);
      this.refreshSnapshot({
        currentPhase: 'decision',
        currentStepId: currentStep.step_id,
        lastVerification: response,
        lastVerificationScore: response.score,
        collaboration: collaborationSession,
      });

      const activityTrace = this.extractOpencodeActivityTrace(rawOutput);
      const streamDetails = this.extractOpencodeStreamDetails(activityTrace);
      const passed = response.score >= this.snapshot.passingScore;

      this.emitStageEvent(
        stage,
        passed ? 'success' : 'warning',
        passed ? '验收通过，等待路由。' : '验收未通过，等待回滚修复。',
        undefined,
        {
          score: response.score,
          passing_score: this.snapshot.passingScore,
          verification_summary: response.summary,
          failed_reasons: response.failed_reasons,
          next_instruction: response.next_instruction,
          suggested_test_command: response.suggested_test_command,
          reasoning_trace: excerpt(streamDetails.reasoning.join('\n\n'), 4_000),
          model_response: excerpt(streamDetails.text.join('\n\n'), 4_000),
          activity_trace: activityTrace,
          collaboration_session_id: collaborationSession?.sessionId,
        },
      );
    } catch (error) {
      if (this.cancelRequested) {
        return;
      }

      const normalizedError = toError(error);
      this.registerFailure('verification', currentStep.step_id);
      this.emitStageEvent(stage, 'error', normalizedError.message, this.extractCommand(error), {
        raw_output: this.extractRawOutput(error),
      });
      this.triggerCircuitBreaker(
        'verification',
        currentStep.step_id,
        stage.retryCount,
        normalizedError,
        this.extractCommand(error),
        this.extractRawOutput(error),
      );
    }
  }

  private runDecisionStage(): void {
    if (!this.context || !this.context.lastVerification) {
      return;
    }

    const currentStep = this.getRequiredCurrentStep();
    const stage = this.beginStage('decision', currentStep.step_id, '路由决策中', '正在根据验收结果决定下一跳。');
    const verification = this.context.lastVerification;
    const passed = verification.score >= this.snapshot.passingScore;

    if (passed) {
      const nextIndex = this.findNextActionableStepIndex(this.context.currentStepIndex + 1);
      this.context.lastVerificationScore = null;
      this.context.stepRepairAttempts = 0;
      this.context.plan[this.context.currentStepIndex] = {
        ...this.context.plan[this.context.currentStepIndex],
        status: 'completed',
      };

      if (nextIndex === -1) {
        this.context.currentPhase = 'completed';
        this.syncPlanStatuses();
        this.refreshSnapshot({
          currentPhase: 'completed',
          currentStepId: currentStep.step_id,
          stepRepairAttempts: this.context.stepRepairAttempts,
          totalRepairAttempts: this.context.totalRepairAttempts,
          lastVerificationScore: null,
        });
        this.emitStageEvent(stage, 'success', '所有计划步骤均已验收通过。');
        return;
      }

      const nextStep = this.context.plan[nextIndex];
      this.context.currentStepIndex = nextIndex;
      this.context.currentPhase = 'planning';
      this.context.currentExecutionPrompt = '';
      this.syncPlanStatuses();
      this.refreshSnapshot({
        currentPhase: 'planning',
        currentStepId: nextStep.step_id,
        stepRepairAttempts: this.context.stepRepairAttempts,
        totalRepairAttempts: this.context.totalRepairAttempts,
        lastVerificationScore: null,
      });
      this.emitStageEvent(stage, 'success', `步骤 ${currentStep.step_id} 已完成，切换到步骤 ${nextStep.step_id}。`);
      return;
    }

    if (this.context.stepRepairAttempts >= this.snapshot.maxRepairAttemptsPerStep) {
      this.context.manualInterventionRequired = true;
      this.context.currentPhase = 'decision';
      this.refreshSnapshot({
        lifecycle: 'needs_review',
        currentPhase: 'decision',
        currentStepId: currentStep.step_id,
        manualInterventionRequired: true,
        stepRepairAttempts: this.context.stepRepairAttempts,
        totalRepairAttempts: this.context.totalRepairAttempts,
      });
      this.emitStageEvent(stage, 'warning', `步骤 ${currentStep.step_id} 已达到最大修复次数，等待人工裁决。`, undefined, {
        score: verification.score,
        passing_score: this.snapshot.passingScore,
      });
      return;
    }

    if (this.context.totalRepairAttempts >= this.snapshot.maxTotalRepairAttempts) {
      this.context.manualInterventionRequired = false;
      this.context.currentPhase = 'decision';
      this.refreshSnapshot({
        lifecycle: 'failed',
        currentPhase: 'decision',
        currentStepId: currentStep.step_id,
        manualInterventionRequired: false,
        stepRepairAttempts: this.context.stepRepairAttempts,
        totalRepairAttempts: this.context.totalRepairAttempts,
      });
      this.emitStageEvent(stage, 'error', '已达到总修复次数上限，workflow 终止。', undefined, {
        score: verification.score,
        passing_score: this.snapshot.passingScore,
      });
      return;
    }

    this.context.stepRepairAttempts += 1;
    this.context.totalRepairAttempts += 1;
    this.context.currentExecutionPrompt = this.buildRepairPrompt(currentStep, verification);
    this.context.currentPhase = 'execution';
    const collaborationSession = this.collaboration.recordRepairInstruction(this.context.collaborationSessionId, currentStep, verification);
    this.refreshSnapshot({
      currentPhase: 'execution',
      currentStepId: currentStep.step_id,
      stepRepairAttempts: this.context.stepRepairAttempts,
      totalRepairAttempts: this.context.totalRepairAttempts,
      collaboration: collaborationSession,
    });
    this.emitStageEvent(stage, 'warning', '验收拒绝，回滚到 Claude 进行二次修复。', undefined, {
      score: verification.score,
      passing_score: this.snapshot.passingScore,
      failed_reasons: verification.failed_reasons,
      next_instruction: verification.next_instruction,
      collaboration_session_id: collaborationSession?.sessionId,
    });
  }

  private finishWorkflow(): void {
    if (!this.context) {
      return;
    }

    const currentStep = this.getCurrentStep();

    if (currentStep) {
      this.context.plan[this.context.currentStepIndex] = {
        ...this.context.plan[this.context.currentStepIndex],
        status: 'completed',
      };
    }

    this.syncPlanStatuses();

    const collaborationSession = this.collaboration.markCompleted(this.context.collaborationSessionId, this.context.lastExecutionSummary);

    this.refreshSnapshot({
      lifecycle: 'completed',
      currentPhase: 'completed',
      currentStepId: this.getCurrentStep()?.step_id ?? this.snapshot.currentStepId,
      manualInterventionRequired: false,
      circuitBreaker: null,
      collaboration: collaborationSession,
    });

    this.emitStandaloneEvent('completed', this.snapshot.currentStepId, 'success', '工作流完成', '全部计划步骤已执行并通过验收。');
  }

  private buildPlanningPrompt(): string {
    if (!this.context) {
      return '';
    }

    const schemaBlock = [
      '请严格输出 JSON，不要输出 Markdown 代码块或额外解释。',
      '{',
      '  "plan": [ { "step_id": 1, "description": "string" } ],',
      '  "expanded_prompt_for_current_step": "string",',
      '  "current_step_id": 1,',
      '  "collaboration_hints": {',
      '    "execution_mode": "single-agent" | "coordinator",',
      '    "suggested_agent_roles": ["string"],',
      '    "coordination_notes": "string"',
      '  }',
      '}',
    ].join('\n');

    const planningGuardrails = [
      '你当前处于规划模式，不允许执行需求本身。',
      '严禁调用任何工具，严禁读写文件，严禁运行命令，严禁修改代码。',
      '你的唯一任务是分析用户需求，并输出严格 JSON。',
      '',
      '【拆分要求】你必须将需求拆分为尽可能细粒度的原子步骤。每个步骤必须满足：',
      '1. 只做一件事——一个独立的、可单独验证的改动',
      '2. 有明确的完成标准——具体到文件路径、函数名、预期行为',
      '3. 禁止模糊描述——不允许"优化代码"、"完善逻辑"等，必须写明具体改什么、改到什么程度',
      '4. 步骤之间尽量解耦——每步完成后代码应处于可编译可运行状态',
      '',
      '步骤数量建议：简单需求 5-10 步，中等需求 10-20 步，复杂需求 20+ 步。宁可多拆不要少拆。',
    ].join('\n');

    if (this.context.plan.length === 0) {
      return renderPromptTemplate(getWorkflowConfig().promptTemplates.planningInitial, {
        planningGuardrails,
        userPrompt: this.context.userPrompt,
        planningSchemaBlock: schemaBlock,
      });
    }

    const currentStep = this.getRequiredCurrentStep();
    return renderPromptTemplate(getWorkflowConfig().promptTemplates.planningStep, {
      planningGuardrails,
      userPrompt: this.context.userPrompt,
      planJson: JSON.stringify(this.context.plan, null, 2),
      currentStepId: String(currentStep.step_id),
      currentStepDescription: currentStep.description,
      planningSchemaBlock: schemaBlock,
    });
  }

  private buildVerificationPrompt(step: PlanStep): string {
    if (!this.context) {
      return '';
    }

    const passingScore = this.snapshot.passingScore;
    const schemaBlock = [
      '请严格输出 JSON，不要输出 Markdown 代码块或额外说明。',
      '{',
      '  "status": "approved" | "rejected",',
      '  "score": 1-10,',
      '  "summary": "string",',
      '  "failed_reasons": ["string"],',
      '  "next_instruction": "string",',
      '  "suggested_test_command": "string"',
      '}',
    ].join('\n');

    const scoringRubric = [
      '【评分标准】',
      '10 分：完美。代码完全正确，测试全部通过，风格一致，无任何遗留问题。',
      '9  分：优秀。代码正确，测试通过，仅有极微小的可改进项（如命名、注释）。',
      '8  分：良好。核心逻辑正确，但存在小问题（边界条件处理、错误消息不够清晰）。',
      '7  分：及格。方向正确，但实现有明显缺陷（缺少错误处理、遗漏分支）。',
      '5-6 分：不及格。实现不完整，缺少关键部分，或有明显 bug。',
      '3-4 分：差。方向基本正确，但实现严重不足。',
      '1-2 分：极差。完全错误或未执行任务。',
      '',
      `通过分数线：${passingScore} 分。只有 score >= ${passingScore} 才能 status = "approved"。`,
      '',
      '【验收要求】',
      '1. 必须实际运行验证命令（测试、编译、lint），不能只看代码就判断',
      '2. 对于"代码看起来正确"但没有运行验证的情况，最高给 7 分',
      '3. 如果测试失败，必须 rejected，不能给 8 分以上',
      '4. 必须具体指出问题所在（文件路径、行号），不能笼统说"需要改进"',
    ].join('\n');

    return renderPromptTemplate(getWorkflowConfig().promptTemplates.verification, {
      stepId: String(step.step_id),
      stepDescription: step.description,
      lastExecutionSummary: this.context.lastExecutionSummary,
      verificationSchemaBlock: schemaBlock,
      scoringRubric,
      passingScore: String(passingScore),
    });
  }

  private buildFallbackExecutionPrompt(step: PlanStep): string {
    if (!this.context) {
      return step.description;
    }

    return renderPromptTemplate(getWorkflowConfig().promptTemplates.fallbackExecution, {
      userPrompt: this.context.userPrompt,
      stepId: String(step.step_id),
      stepDescription: step.description,
    });
  }

  private buildRepairPrompt(step: PlanStep, verification: VerificationResponse): string {
    if (!this.context) {
      return step.description;
    }

    return renderPromptTemplate(getWorkflowConfig().promptTemplates.repair, {
      userPrompt: this.context.userPrompt,
      stepId: String(step.step_id),
      stepDescription: step.description,
      lastExecutionSummary: this.context.lastExecutionSummary,
      failedReasons:
        verification.failed_reasons.length > 0
          ? verification.failed_reasons.map((reason, index) => `${index + 1}. ${reason}`).join('\n')
          : '1. OpenCode 未给出显式失败原因。',
      nextInstruction: verification.next_instruction || '根据失败原因修复并重新验证。',
    });
  }

  private async runStructuredOpencode<T>(
    basePrompt: string,
    stage: ActiveStage,
    schema: ZodType<T, any, unknown>,
    validate: (parsed: T) => T,
  ): Promise<{ response: T; rawOutput: string }> {
    const config = getWorkflowConfig();
    let prompt = basePrompt;

    for (let jsonAttempt = 1; jsonAttempt <= config.jsonRepairRetries; jsonAttempt += 1) {
      const cwd = process.cwd();
      const args = ['--format', 'json', '--pure', '--dangerously-skip-permissions', '--variant', this.snapshot.executionSettings.opencodeVariant, '--thinking', '--dir', cwd];
      const opencodeLaunch = buildToolLaunchSpec('opencode');
      const command = formatCommand(opencodeLaunch.bin, ['run', prompt, ...args]);
      const result = await withExponentialBackoff(async (attempt) => {
        try {
          return await this.executeStructuredOpencodeProcess(prompt, args);
        } catch (error) {
          if (error instanceof ProcessAbortError) {
            throw error;
          }

          if (attempt < config.processRetries) {
            const normalizedError = toError(error);
            const details: Record<string, unknown> = {
              failure_reason: normalizedError.message,
              cwd,
            };

            if (error instanceof ProcessExecutionError) {
              if (error.stderr.trim()) {
                details.stderr = excerpt(error.stderr, 1_500);
              }

              if (error.stdout.trim()) {
                details.raw_output = excerpt(error.stdout, 1_500);
              }

              if (typeof error.exitCode === 'number') {
                details.exit_code = error.exitCode;
              }

              if (error.timedOut) {
                details.timed_out = true;
              }
            }

            this.emitStageEvent(stage, 'warning', `OpenCode 进程异常，启动第 ${attempt + 1} 次指数退避重试。`, command, details);
          }

          throw error;
        }
      }, config.processRetries);

      let candidate: unknown;

      try {
        candidate = this.parseStructuredOpencodeOutput(result.stdout);
        const response = validate(schema.parse(candidate));
        return {
          response,
          rawOutput: result.stdout,
        };
      } catch (error) {
        if (jsonAttempt === config.jsonRepairRetries) {
          throw new StructuredOutputError('OpenCode JSON 输出无效且已耗尽纠偏重试。', command, result.stdout, error);
        }

        this.emitStageEvent(stage, 'warning', `OpenCode JSON 结构无效，执行第 ${jsonAttempt} 次格式纠偏。`, command, {
          parse_error: toError(error).message,
          raw_output: excerpt(result.stdout, 1_500),
          sanitized_output_preview: excerpt(this.sanitizeTerminalOutput(result.stdout), 500),
          validation_stage: typeof candidate === 'undefined' ? 'json-extraction' : 'schema-validation',
          ...(typeof candidate === 'undefined' ? {} : this.describeStructuredCandidate(candidate)),
        });

        prompt = `${basePrompt}\n\n${JSON_REPAIR_SUFFIX}`;
      }
    }

    throw new Error('Structured OpenCode execution reached an unexpected state.');
  }

  private async executeStructuredOpencodeProcess(prompt: string, args: string[]): Promise<CommandResult> {
    const controller = new AbortController();
    this.activeCommandAbortController = controller;
    const launch = buildToolLaunchSpec('opencode');

    try {
      // OpenCode requires the prompt as a positional argument (does not read from stdin).
      return await runCommand({
        bin: launch.bin,
        args: ['run', prompt, ...args],
        env: launch.env,
        signal: controller.signal,
      });
    } finally {
      if (this.activeCommandAbortController === controller) {
        this.activeCommandAbortController = null;
      }
    }
  }

  private parseStructuredOpencodeOutput(raw: string): unknown {
    return parseStructuredOpencodeOutputShared(raw);
  }

  private extractOpencodeActivityTrace(raw: string): WorkflowActivityItem[] {
    const items: WorkflowActivityItem[] = [];

    for (const line of raw.split(/\r?\n/gu)) {
      const trimmed = line.trim();

      if (!trimmed) {
        continue;
      }

      try {
        const event = JSON.parse(trimmed) as OpencodeJsonEvent;
        const timestamp = toIsoTimestamp(event.timestamp);

        if (event.type === 'step_start') {
          items.push({
            id: event.part?.id ?? `opencode-step-start-${items.length + 1}`,
            source: 'opencode',
            role: 'system',
            kind: 'step_start',
            label: 'OpenCode 步骤开始',
            text: '开始处理当前阶段。',
            timestamp,
          });
          continue;
        }

        if (event.type === 'reasoning') {
          const text = typeof event.part?.text === 'string' ? this.stripMarkdownCodeFence(event.part.text) : '';

          if (text) {
            items.push({
              id: event.part?.id ?? `opencode-thinking-${items.length + 1}`,
              source: 'opencode',
              role: 'assistant',
              kind: 'thinking',
              label: 'OpenCode 思考',
              text: excerpt(text, MAX_ACTIVITY_TEXT_LENGTH),
              timestamp,
            });
          }

          continue;
        }

        if (event.type === 'text') {
          const text = typeof event.part?.text === 'string' ? this.stripMarkdownCodeFence(event.part.text) : '';

          if (text) {
            items.push({
              id: event.part?.id ?? `opencode-message-${items.length + 1}`,
              source: 'opencode',
              role: 'assistant',
              kind: 'message',
              label: 'OpenCode 输出',
              text: excerpt(text, MAX_ACTIVITY_TEXT_LENGTH),
              timestamp,
            });
          }

          continue;
        }

        if (event.type === 'tool_use' && event.part?.type === 'tool') {
          const toolCallId = event.part.callID ?? event.part.id ?? `opencode-tool-${items.length + 1}`;
          const input = formatActivityPayload(event.part.state?.input);
          const output = formatActivityPayload(event.part.state?.output);
          const startedAt = event.part.state?.time?.start;
          const endedAt = event.part.state?.time?.end;

          items.push({
            id: `${toolCallId}:call`,
            source: 'opencode',
            role: 'assistant',
            kind: 'tool_use',
            label: `OpenCode 调用 ${event.part.tool ?? 'tool'}`,
            toolName: event.part.tool,
            toolCallId,
            toolStatus: 'running',
            input,
            timestamp: toIsoTimestamp(startedAt) ?? timestamp,
          });

          items.push({
            id: `${toolCallId}:result`,
            source: 'opencode',
            role: 'user',
            kind: 'tool_result',
            label: `OpenCode 工具结果 ${event.part.tool ?? 'tool'}`,
            toolName: event.part.tool,
            toolCallId,
            toolStatus: event.part.state?.status === 'error' ? 'error' : 'completed',
            output,
            timestamp: toIsoTimestamp(endedAt) ?? timestamp,
            durationMs:
              typeof startedAt === 'number' && typeof endedAt === 'number' && endedAt >= startedAt ? endedAt - startedAt : undefined,
            metadata: event.part.state?.metadata,
          });

          continue;
        }

        if (event.type === 'step_finish') {
          items.push({
            id: event.part?.id ?? `opencode-step-finish-${items.length + 1}`,
            source: 'opencode',
            role: 'system',
            kind: 'step_finish',
            label: 'OpenCode 步骤完成',
            text: event.part?.reason ? `结束原因：${event.part.reason}` : '当前阶段输出已完成。',
            timestamp,
            metadata:
              event.part?.tokens || typeof event.part?.cost === 'number'
                ? {
                    tokens: event.part.tokens,
                    cost: event.part.cost,
                  }
                : undefined,
          });
        }
      } catch {
        // Ignore malformed event lines and keep scanning the stream.
      }
    }

    return this.limitActivityTrace(items, 'opencode');
  }

  private extractOpencodeStreamDetails(activityTrace: WorkflowActivityItem[]): OpencodeStreamDetails {
    const details: OpencodeStreamDetails = {
      reasoning: [],
      text: [],
    };

    for (const entry of activityTrace) {
      if (entry.kind === 'thinking' && entry.text) {
        details.reasoning.push(entry.text);
        continue;
      }

      if (entry.kind === 'message' && entry.text) {
        details.text.push(entry.text);
      }
    }

    return details;
  }

  private extractClaudeExecutionDetails(rawOutput: string): ClaudeExecutionDetails {
    const activityTrace: WorkflowActivityItem[] = [];
    const toolNameByCallId = new Map<string, string>();
    const finalTextParts: string[] = [];
    let durationMs: number | undefined;
    let totalCostUsd: number | undefined;
    let totalTurns: number | undefined;

    for (const line of rawOutput.split(/\r?\n/gu)) {
      const trimmed = line.trim();

      if (!trimmed) {
        continue;
      }

      try {
        const event = JSON.parse(trimmed) as ClaudeStreamEvent;

        if (event.type === 'assistant') {
          for (const content of event.message?.content ?? []) {
            if (content.type === 'thinking' && typeof content.thinking === 'string') {
              activityTrace.push({
                id: content.id ?? event.uuid ?? `claude-thinking-${activityTrace.length + 1}`,
                source: 'claude',
                role: 'assistant',
                kind: 'thinking',
                label: 'Claude 思考',
                text: excerpt(content.thinking.trim(), MAX_ACTIVITY_TEXT_LENGTH),
              });
              continue;
            }

            if (content.type === 'tool_use') {
              const toolCallId = content.id ?? `claude-tool-${activityTrace.length + 1}`;
              const toolName = content.name ?? 'tool';
              toolNameByCallId.set(toolCallId, toolName);
              activityTrace.push({
                id: `${toolCallId}:call`,
                source: 'claude',
                role: 'assistant',
                kind: 'tool_use',
                label: `Claude 调用 ${toolName}`,
                toolName,
                toolCallId,
                toolStatus: 'running',
                input: formatActivityPayload(content.input),
              });
              continue;
            }

            if (content.type === 'text' && typeof content.text === 'string') {
              const messageText = content.text.trim();

              if (!messageText) {
                continue;
              }

              // Skip internal instructions: coordinator dispatch, verification results, etc.
              if (messageText.startsWith('{') && /"(action|status|score|summary|failed_reasons)"\s*:/u.test(messageText)) {
                continue;
              }

              finalTextParts.push(messageText);
              activityTrace.push({
                id: content.id ?? event.uuid ?? `claude-message-${activityTrace.length + 1}`,
                source: 'claude',
                role: 'assistant',
                kind: 'message',
                label: 'Claude 输出',
                text: excerpt(messageText, MAX_ACTIVITY_TEXT_LENGTH),
              });
            }
          }

          continue;
        }

        if (event.type === 'user') {
          for (const content of event.message?.content ?? []) {
            if (content.type !== 'tool_result') {
              continue;
            }

            const toolCallId = content.tool_use_id;
            const toolName = toolCallId ? toolNameByCallId.get(toolCallId) : undefined;
            const output =
              typeof content.content === 'string'
                ? excerpt(content.content.trim(), MAX_ACTIVITY_TEXT_LENGTH)
                : formatActivityPayload(content.content, MAX_ACTIVITY_TEXT_LENGTH);

            activityTrace.push({
              id: `${toolCallId ?? `claude-tool-result-${activityTrace.length + 1}`}:result`,
              source: 'claude',
              role: 'user',
              kind: 'tool_result',
              label: `Claude 工具结果 ${toolName ?? 'tool'}`,
              toolName,
              toolCallId,
              toolStatus: 'completed',
              output,
              timestamp: event.timestamp,
              metadata: event.tool_use_result ? { tool_use_result: event.tool_use_result } : undefined,
            });
          }

          continue;
        }

        if (event.type === 'result') {
          durationMs = event.duration_ms;
          totalCostUsd = event.total_cost_usd;
          totalTurns = event.num_turns;
          activityTrace.push({
            id: event.uuid ?? `claude-result-${activityTrace.length + 1}`,
            source: 'claude',
            role: 'system',
            kind: 'result',
            label: 'Claude 运行结果',
            text: typeof event.result === 'string' && event.result.trim() ? excerpt(event.result.trim(), MAX_ACTIVITY_TEXT_LENGTH) : undefined,
            durationMs: event.duration_ms,
            metadata: {
              stop_reason: event.stop_reason,
              total_turns: event.num_turns,
              total_cost_usd: event.total_cost_usd,
            },
          });
        }
      } catch {
        // Ignore malformed stream-json lines and fall back to the raw summary below.
      }
    }

    const summary =
      finalTextParts.join('\n\n').trim() ||
      this.buildExecutionSummaryFromTrace(activityTrace) ||
      this.sanitizeTerminalOutput(rawOutput);

    return {
      summary,
      activityTrace: this.limitActivityTrace(activityTrace, 'claude'),
      durationMs,
      totalCostUsd,
      totalTurns,
    };
  }

  private buildExecutionSummaryFromTrace(activityTrace: WorkflowActivityItem[]): string {
    const toolNames = [...new Set(activityTrace.filter((item) => item.kind === 'tool_use' && item.toolName).map((item) => item.toolName as string))];

    if (toolNames.length === 0) {
      return '';
    }

    return `Claude 已完成工具调用：${toolNames.join(', ')}。`;
  }

  private limitActivityTrace(items: WorkflowActivityItem[], source: 'opencode' | 'claude'): WorkflowActivityItem[] {
    return limitActivityTraceShared(items, source);
  }

  private extractOpencodeEventText(raw: string): string | null {
    const textParts: string[] = [];

    for (const line of raw.split(/\r?\n/gu)) {
      const trimmed = line.trim();

      if (!trimmed) {
        continue;
      }

      try {
        const event = JSON.parse(trimmed) as OpencodeJsonEvent;

        if ((event.type === 'text' || event.part?.type === 'text') && typeof event.part?.text === 'string') {
          textParts.push(this.stripMarkdownCodeFence(event.part.text));
        }
      } catch {
        // Ignore non-JSON lines and fall back to the legacy parser.
      }
    }

    if (textParts.length === 0) {
      return null;
    }

    const normalizedParts = textParts.map((part) => this.sanitizeTerminalOutput(part)).filter(Boolean);

    for (let startIndex = normalizedParts.length - 1; startIndex >= 0; startIndex -= 1) {
      const candidate = this.sanitizeTerminalOutput(normalizedParts.slice(startIndex).join('\n'));

      if (!candidate) {
        continue;
      }

      try {
        this.parseJsonObject(candidate);
        return candidate;
      } catch {
        // Keep walking backward until a JSON-bearing tail is found.
      }
    }

    return this.sanitizeTerminalOutput(normalizedParts.join('\n'));
  }

  private stripMarkdownCodeFence(value: string): string {
    return value.replace(/^```[^\n]*\n?/u, '').replace(/\n?```$/u, '').trim();
  }

  private sanitizeTerminalOutput(value: string): string {
    return value
      .replace(/\u0000/gu, '')
      .replace(/\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/gu, '')
      .replace(/\u001B(?:\[[0-?]*[ -/]*[@-~]|[@-Z\\-_])/gu, '')
      .trim();
  }

  private parseJsonObject(raw: string): unknown {
    const trimmed = raw.trim();
    const candidates = [trimmed];
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');

    if (firstBrace >= 0 && lastBrace > firstBrace) {
      candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
    }

    candidates.push(...this.collectBalancedJsonObjectCandidates(trimmed));

    for (const candidate of new Set(candidates.map((candidate) => candidate.trim()).filter(Boolean))) {
      try {
        return JSON.parse(candidate);
      } catch {
        // Try the next candidate.
      }
    }

    throw new Error('Unable to extract a valid JSON object from model output.');
  }

  private collectBalancedJsonObjectCandidates(raw: string): string[] {
    const candidates: string[] = [];

    for (let start = 0; start < raw.length; start += 1) {
      if (raw[start] !== '{') {
        continue;
      }

      let depth = 0;
      let inString = false;
      let escaped = false;

      for (let index = start; index < raw.length; index += 1) {
        const character = raw[index];

        if (inString) {
          if (escaped) {
            escaped = false;
            continue;
          }

          if (character === '\\') {
            escaped = true;
            continue;
          }

          if (character === '"') {
            inString = false;
          }

          continue;
        }

        if (character === '"') {
          inString = true;
          continue;
        }

        if (character === '{') {
          depth += 1;
          continue;
        }

        if (character !== '}') {
          continue;
        }

        depth -= 1;

        if (depth === 0) {
          candidates.push(raw.slice(start, index + 1));
          break;
        }
      }
    }

    return candidates;
  }

  private extractExecutionSummary(rawOutput: string): string {
    return this.extractClaudeExecutionDetails(rawOutput).summary;
  }

  private async executeClaudeStep(
    step: PlanStep,
    prompt: string,
    stage: ActiveStage,
  ): Promise<{
    summary: string;
    rawOutput: string;
    command: string;
    collaborationSession: CollaborationSessionSnapshot | null;
    collaborationPrompt: string | null;
    usedFallback: boolean;
    activityTrace: WorkflowActivityItem[];
    durationMs?: number;
    totalCostUsd?: number;
    totalTurns?: number;
  }> {
    const claudeLaunch = buildToolLaunchSpec('claude');
    const directArgs = ['-p', '--verbose', '--output-format', 'stream-json', '--dangerously-skip-permissions', '--effort', this.snapshot.executionSettings.claudeEffort];
    const directCommand = formatCommand(claudeLaunch.bin, directArgs);

    const runDirectExecution = async (): Promise<{
      summary: string;
      rawOutput: string;
      command: string;
      collaborationSession: CollaborationSessionSnapshot | null;
      collaborationPrompt: string | null;
      usedFallback: boolean;
      activityTrace: WorkflowActivityItem[];
      durationMs?: number;
      totalCostUsd?: number;
      totalTurns?: number;
    }> => {
      const controller = new AbortController();
      this.activeCommandAbortController = controller;

      try {
        const result = await runCommandWithStdin({
          bin: claudeLaunch.bin,
          args: directArgs,
          env: claudeLaunch.env,
          signal: controller.signal,
        }, prompt);
        const executionDetails = this.extractClaudeExecutionDetails(result.stdout);
        const summary = executionDetails.summary;

        if (!this.hasMeaningfulExecutionSummary(summary)) {
          throw new Error('Claude 输出为空、不可读，或未体现代码修改特征。');
        }

        return {
          summary,
          rawOutput: result.stdout,
          command: directCommand,
          collaborationSession: this.collaboration.getSession(this.context?.collaborationSessionId),
          collaborationPrompt: null,
          usedFallback: false,
          activityTrace: executionDetails.activityTrace,
          durationMs: executionDetails.durationMs,
          totalCostUsd: executionDetails.totalCostUsd,
          totalTurns: executionDetails.totalTurns,
        };
      } finally {
        if (this.activeCommandAbortController === controller) {
          this.activeCommandAbortController = null;
        }
      }
    };

    return withExponentialBackoff(async (attempt) => {
      if (attempt > 1) {
        this.emitStageEvent(stage, 'warning', `Claude 执行输出不可用，准备进行第 ${attempt} 次重试。`, directCommand);
      }

      if (!this.context?.collaborationSessionId) {
        return runDirectExecution();
      }

      try {
        const collaborative = await this.collaboration.executeStep({
          sessionId: this.context.collaborationSessionId,
          userPrompt: this.context.userPrompt,
          step,
          executionPrompt: prompt,
          collaborationHints: this.context.collaborationHints,
          claudeEffort: this.snapshot.executionSettings.claudeEffort,
        });
        const executionDetails = this.extractClaudeExecutionDetails(collaborative.rawOutput);
        const summary = executionDetails.summary;

        if (!this.hasMeaningfulExecutionSummary(summary)) {
          throw new Error('Claude 协调者输出为空、不可读，或未体现代码修改特征。');
        }

        const collaborationSession = this.collaboration.recordExecutionResult(this.context.collaborationSessionId, step, summary, {
          raw_output: excerpt(collaborative.rawOutput, 4_000),
        });

        return {
          summary,
          rawOutput: collaborative.rawOutput,
          command: collaborative.command,
          collaborationSession,
          collaborationPrompt: collaborative.prompt,
          usedFallback: false,
          activityTrace: executionDetails.activityTrace,
          durationMs: executionDetails.durationMs,
          totalCostUsd: executionDetails.totalCostUsd,
          totalTurns: executionDetails.totalTurns,
        };
      } catch (error) {
        const fallback = this.describeCollaborationFallback(error);
        this.emitStageEvent(stage, 'warning', fallback.message, directCommand, {
          ...fallback.details,
          collaboration_session_id: this.context.collaborationSessionId,
        });
        const directResult = await runDirectExecution();
        return {
          ...directResult,
          collaborationSession: this.collaboration.getSession(this.context.collaborationSessionId),
          usedFallback: true,
        };
      }
    }, getWorkflowConfig().executionRetries);
  }

  private hasMeaningfulExecutionSummary(summary: string): boolean {
    if (summary.length >= 120) {
      return true;
    }

    return /(modified|updated|created|added|removed|implemented|deleted|test|diff|patch|file|src\/|package\.json|README|创建|已创建|新增|修改|更新|删除|写入|文件|验证|测试|通过|完成)/iu.test(
      summary.replace(/\s+/gu, ''),
    );
  }

  private describeCollaborationFallback(error: unknown): { message: string; details: Record<string, unknown> } {
    const normalizedError = toError(error);

    if (error instanceof ProcessExecutionError) {
      return {
        message: error.timedOut ? 'Claude 协调层进程超时，自动回退到单 agent 执行路径。' : 'Claude 协调层进程失败，自动回退到单 agent 执行路径。',
        details: {
          failure_kind: 'process',
          failure_reason: normalizedError.message,
          stderr: error.stderr.trim() ? excerpt(error.stderr, 1_500) : undefined,
          raw_output: error.stdout.trim() ? excerpt(error.stdout, 1_500) : undefined,
          exit_code: typeof error.exitCode === 'number' ? error.exitCode : undefined,
          timed_out: error.timedOut || undefined,
        },
      };
    }

    if (/输出为空|不可读|未体现代码修改特征/u.test(normalizedError.message)) {
      return {
        message: 'Claude 协调层输出不可用，自动回退到单 agent 执行路径。',
        details: {
          failure_kind: 'summary-unusable',
          failure_reason: normalizedError.message,
        },
      };
    }

    return {
      message: 'Claude 协调层执行失败，自动回退到单 agent 执行路径。',
      details: {
        failure_kind: 'unexpected',
        failure_reason: normalizedError.message,
      },
    };
  }

  private describeStructuredCandidate(candidate: unknown): Record<string, unknown> {
    if (candidate === null) {
      return {
        parsed_candidate_type: 'null',
      };
    }

    if (Array.isArray(candidate)) {
      return {
        parsed_candidate_type: 'array',
        parsed_candidate_length: candidate.length,
        parsed_candidate_preview: excerpt(this.serializeStructuredCandidate(candidate), 800),
      };
    }

    if (typeof candidate === 'object') {
      const record = candidate as Record<string, unknown>;

      return {
        parsed_candidate_type: 'object',
        parsed_candidate_keys: Object.keys(record).slice(0, 20),
        parsed_candidate_preview: excerpt(this.serializeStructuredCandidate(record), 800),
      };
    }

    return {
      parsed_candidate_type: typeof candidate,
      parsed_candidate_preview: excerpt(String(candidate), 800),
    };
  }

  private serializeStructuredCandidate(candidate: unknown): string {
    if (typeof candidate === 'string') {
      return candidate;
    }

    try {
      return JSON.stringify(candidate, null, 2);
    } catch {
      return String(candidate);
    }
  }

  private triggerCircuitBreaker(
    phase: RetriablePhase,
    stepId: number,
    retryCount: number,
    error: Error,
    command?: string,
    rawOutput?: string,
  ): void {
    if (!this.context) {
      return;
    }

    const recovery = classifyWorkflowError(error, phase, retryCount);

    const circuitBreaker: CircuitBreakerState = {
      phase,
      stepId,
      retryCount,
      reason: error.message,
      command,
      stack: error.stack,
      rawOutput,
      recovery,
    };

    this.context.manualInterventionRequired = true;
    this.context.circuitBreaker = circuitBreaker;
    this.context.currentPhase = phase;
    const collaborationSession = this.collaboration.markPaused(this.context.collaborationSessionId, error.message);

    this.refreshSnapshot({
      lifecycle: 'paused',
      currentPhase: 'circuit-breaker',
      currentStepId: stepId,
      currentRetryCount: retryCount,
      manualInterventionRequired: true,
      circuitBreaker,
      collaboration: collaborationSession,
    });

    this.emitStandaloneEvent(
      'circuit-breaker',
      stepId,
      'paused',
      `熔断触发：${phase}`,
      error instanceof ProcessExecutionError && error.stderr.trim()
        ? `${error.message}\n\nstderr:\n${excerpt(error.stderr, 500)}`
        : error.message,
      command,
      {
        stack: error.stack,
        raw_output: rawOutput,
        ...this.recoveryDetails(recovery),
      },
    );
  }

  private recoveryDetails(recovery: WorkflowRecoveryDescriptor | undefined): Record<string, unknown> | undefined {
    if (!recovery) {
      return undefined;
    }

    return {
      recovery_category: recovery.category,
      recovery_action: recovery.action,
      recovery_summary: recovery.summary,
      recovery_auto_retryable: recovery.autoRetryable,
      recovery_delay_ms: recovery.delayMs,
    };
  }

  private beginStage(phase: IndexedPhase, stepId: number, title: string, message: string): ActiveStage {
    const retryCount = this.nextRetryCount(phase, stepId);
    const nodeId = `${phase}-${stepId}-${retryCount}`;
    this.refreshSnapshot({
      lifecycle: 'running',
      currentPhase: phase,
      currentStepId: stepId,
      currentRetryCount: retryCount,
    });

    this.publishEvent({
      phase,
      stepId,
      retryCount,
      nodeId,
      title,
      message,
      status: 'running',
    });

    return {
      phase,
      stepId,
      retryCount,
      nodeId,
    };
  }

  private emitStageEvent(
    stage: ActiveStage,
    status: WorkflowNodeStatus,
    message: string,
    command?: string,
    details?: Record<string, unknown>,
  ): void {
    this.refreshSnapshot({
      currentPhase: stage.phase,
      currentStepId: stage.stepId,
      currentRetryCount: stage.retryCount,
    });

    this.publishEvent({
      phase: stage.phase,
      stepId: stage.stepId,
      retryCount: stage.retryCount,
      nodeId: stage.nodeId,
      title: this.titleForPhase(stage.phase),
      message,
      status,
      command,
      details,
    });
  }

  private emitStandaloneEvent(
    phase: WorkflowPhase,
    stepId: number,
    status: WorkflowNodeStatus,
    title: string,
    message: string,
    command?: string,
    details?: Record<string, unknown>,
  ): void {
    const retryCount = this.nextRetryCount(phase, stepId);
    this.publishEvent({
      phase,
      stepId,
      retryCount,
      nodeId: `${phase}-${stepId}-${retryCount}`,
      title,
      message,
      status,
      command,
      details,
    });
  }

  private startDrive(): void {
    this.drivePromise = this.drive().catch((error) => {
      const normalizedError = toError(error);
      console.error('[workflow]', normalizedError);
    });
  }

  private publishEvent(payload: Omit<WorkflowEvent, 'eventId' | 'runId' | 'timestamp'>): void {
    const activityTrace =
      payload.activity_trace ??
      payload.activityTrace ??
      (Array.isArray(payload.details?.activity_trace) ? (payload.details.activity_trace as WorkflowActivityItem[]) : undefined);

    const event: WorkflowEvent = {
      eventId: crypto.randomUUID(),
      runId: this.snapshot.runId ?? crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...payload,
      activityTrace,
      activity_trace: activityTrace,
    };

    this.publish({
      event,
      snapshot: this.snapshot,
    });
  }

  private refreshSnapshot(overrides: Partial<WorkflowSnapshot>): void {
    this.snapshot = {
      ...this.snapshot,
      ...overrides,
      runId: this.context?.runId ?? this.snapshot.runId,
      executionSubState:
        overrides.executionSubState !== undefined
          ? overrides.executionSubState
          : this.context?.executionSubState ?? this.snapshot.executionSubState,
      stepRepairAttempts: overrides.stepRepairAttempts ?? this.context?.stepRepairAttempts ?? this.snapshot.stepRepairAttempts,
      totalRepairAttempts: overrides.totalRepairAttempts ?? this.context?.totalRepairAttempts ?? this.snapshot.totalRepairAttempts,
      maxRepairAttemptsPerStep: overrides.maxRepairAttemptsPerStep ?? this.snapshot.maxRepairAttemptsPerStep,
      maxTotalRepairAttempts: overrides.maxTotalRepairAttempts ?? this.snapshot.maxTotalRepairAttempts,
      passingScore: overrides.passingScore ?? this.snapshot.passingScore,
      lastVerificationScore:
        overrides.lastVerificationScore !== undefined
          ? overrides.lastVerificationScore
          : this.context?.lastVerificationScore ?? this.snapshot.lastVerificationScore,
      executionSettings: overrides.executionSettings ?? this.snapshot.executionSettings,
      budget: overrides.budget ?? this.buildBudgetSummary(),
      plan: this.context?.plan ?? this.snapshot.plan,
      userPrompt: this.context?.userPrompt ?? this.snapshot.userPrompt,
      lastExecutionSummary: this.context?.lastExecutionSummary ?? this.snapshot.lastExecutionSummary,
      lastVerification: this.context?.lastVerification ?? this.snapshot.lastVerification,
      collaboration:
        typeof overrides.collaboration !== 'undefined'
          ? overrides.collaboration
          : this.collaboration.getSession(this.context?.collaborationSessionId),
      manualInterventionRequired:
        overrides.manualInterventionRequired ?? this.context?.manualInterventionRequired ?? this.snapshot.manualInterventionRequired,
      circuitBreaker: overrides.circuitBreaker ?? this.context?.circuitBreaker ?? this.snapshot.circuitBreaker,
      updatedAt: new Date().toISOString(),
    };
  }

  private buildBudgetSummary(capUsd: number | null = this.snapshot.budget.capUsd): WorkflowBudgetSummary {
    const spentUsd = this.context?.sessionCostUsd ?? this.snapshot.budget.spentUsd;
    const lastStepCostUsd = this.context?.lastStepCostUsd ?? this.snapshot.budget.lastStepCostUsd;
    const remainingUsd = capUsd == null ? null : Math.max(0, capUsd - spentUsd);

    return {
      capUsd,
      spentUsd,
      remainingUsd,
      exceeded: capUsd == null ? false : spentUsd >= capUsd,
      lastStepCostUsd,
    };
  }

  private mergePlanSteps(nextPlan: PlanStep[]): PlanStep[] {
    const previousSteps = new Map(this.context?.plan.map((step) => [step.step_id, step]));

    return nextPlan.map((step) => {
      const previous = previousSteps.get(step.step_id);
      return {
        ...previous,
        step_id: step.step_id,
        description: step.description,
      };
    });
  }

  private syncPlanStatuses(): void {
    if (!this.context) {
      return;
    }

    const context = this.context;

    context.plan = context.plan.map((step, index) => {
      if (step.status === 'skipped') {
        return step;
      }

      let status: PlanStepStatus = 'pending';

      if (index < context.currentStepIndex || (this.snapshot.lifecycle === 'completed' && index <= context.currentStepIndex)) {
        status = 'completed';
      } else if (index === context.currentStepIndex && context.currentPhase !== 'completed') {
        status = 'active';
      }

      return {
        ...step,
        status,
      };
    });
  }

  private getCurrentStep(): PlanStep | null {
    if (!this.context || this.context.plan.length === 0) {
      return null;
    }

    return this.context.plan[this.context.currentStepIndex] ?? null;
  }

  private getRequiredCurrentStep(): PlanStep {
    const currentStep = this.getCurrentStep();

    if (!currentStep) {
      throw new Error('The workflow does not have a current step.');
    }

    return currentStep;
  }

  private findStepIndex(stepId: number): number {
    if (!this.context) {
      return -1;
    }

    return this.context.plan.findIndex((step) => step.step_id === stepId);
  }

  private findNextActionableStepIndex(startIndex: number): number {
    if (!this.context) {
      return -1;
    }

    for (let index = startIndex; index < this.context.plan.length; index += 1) {
      if (this.context.plan[index].status !== 'skipped') {
        return index;
      }
    }

    return -1;
  }

  private getMetrics(phase: WorkflowPhase, stepId: number): PhaseMetrics {
    const key = `${phase}:${stepId}`;
    const existing = this.phaseMetrics.get(key);

    if (existing) {
      return existing;
    }

    const created: PhaseMetrics = {
      nextAttempt: 1,
      failureStreak: 0,
    };
    this.phaseMetrics.set(key, created);
    return created;
  }

  private nextRetryCount(phase: WorkflowPhase, stepId: number): number {
    const metrics = this.getMetrics(phase, stepId);
    const retryCount = metrics.nextAttempt;
    metrics.nextAttempt += 1;
    return retryCount;
  }

  private registerFailure(phase: RetriablePhase, stepId: number): void {
    const metrics = this.getMetrics(phase, stepId);
    metrics.failureStreak += 1;
  }

  private resetFailureStreak(phase: RetriablePhase, stepId: number): void {
    const metrics = this.getMetrics(phase, stepId);
    metrics.failureStreak = 0;
  }

  private titleForPhase(phase: WorkflowPhase): string {
    switch (phase) {
      case 'planning':
        return 'OpenCode 规划中';
      case 'execution':
        return 'Claude 执行中';
      case 'verification':
        return 'OpenCode 验收中';
      case 'decision':
        return '路由决策中';
      case 'circuit-breaker':
        return '熔断保护';
      case 'completed':
        return '工作流完成';
      default:
        return '工作流事件';
    }
  }

  private extractCommand(error: unknown): string | undefined {
    if (error instanceof ProcessExecutionError || error instanceof StructuredOutputError) {
      return error.command;
    }

    return undefined;
  }

  private extractRawOutput(error: unknown): string | undefined {
    if (error instanceof StructuredOutputError) {
      return excerpt(error.rawOutput, 3_000);
    }

    if (error instanceof ProcessExecutionError) {
      return excerpt(`${error.stdout}\n${error.stderr}`.trim(), 3_000);
    }

    return undefined;
  }
}