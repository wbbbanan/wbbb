import crypto from 'node:crypto';
import type {
  CircuitBreakerState,
  WorkflowExportFormat,
  WorkflowExportPayload,
  WorkflowEvent,
  WorkflowEventEnvelope,
  WorkflowLifecycle,
  WorkflowNodeStatus,
  WorkflowPhase,
  WorkflowQueueSnapshot,
  WorkflowRecoveryDescriptor,
  WorkflowSessionMetrics,
  WorkflowSessionSummary,
  WorkflowSnapshot,
} from '../shared/ipc';
import type { WorkflowTemplate, WorkflowTemplateCreate } from '../shared/schema';
import { getWorkflowConfig } from './configManager';
import { createInterruptedRecovery } from './workflowRecovery';
import type { WorkflowStateMachinePersistedState } from './workflowRuntimeTypes';
import { WorkflowSessionStore, clonePersistedState, type PersistedWorkflowManagerState, type PersistedWorkflowSessionRecord } from './workflowSessionStore';
import { WorkflowStateMachine } from './workflowStateMachine';

const MAX_SESSION_EVENTS = 240;

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
    updatedAt: new Date(0).toISOString(),
    lastExecutionSummary: '',
    lastVerification: null,
    circuitBreaker: null,
    collaboration: null,
  };
};

const isRetriablePhase = (phase: WorkflowPhase): phase is 'planning' | 'execution' | 'verification' =>
  phase === 'planning' || phase === 'execution' || phase === 'verification';

const buildSessionTitle = (prompt: string): string => {
  const firstLine = prompt
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return (firstLine || 'Untitled Session').slice(0, 72);
};

const buildPromptPreview = (prompt: string): string => prompt.replace(/\s+/gu, ' ').trim().slice(0, 180);

const createEmptyMetrics = (updatedAt: string): WorkflowSessionMetrics => ({
  eventCount: 0,
  warningCount: 0,
  errorCount: 0,
  retryCount: 0,
  totalCostUsd: 0,
  startedAt: null,
  completedAt: null,
  updatedAt,
});

const computeMetrics = (events: WorkflowEvent[], createdAt: string, snapshot: WorkflowSnapshot): WorkflowSessionMetrics => ({
  eventCount: events.length,
  warningCount: events.filter((event) => event.status === 'warning').length,
  errorCount: events.filter((event) => event.status === 'error').length,
  retryCount: events.reduce((count, event) => count + Math.max(0, event.retryCount - 1), 0),
  totalCostUsd: snapshot.budget.spentUsd,
  startedAt: events[0]?.timestamp ?? (snapshot.lifecycle === 'idle' || snapshot.lifecycle === 'queued' ? null : createdAt),
  completedAt: snapshot.lifecycle === 'completed' || snapshot.lifecycle === 'failed' ? snapshot.updatedAt : null,
  updatedAt: snapshot.updatedAt,
});

const createQueuedSnapshot = (sessionId: string, prompt: string, updatedAt: string): WorkflowSnapshot => ({
  ...createIdleSnapshot(),
  runId: sessionId,
  lifecycle: 'queued',
  userPrompt: prompt,
  passingScore: getWorkflowConfig().passingScore,
  lastVerificationScore: null,
  updatedAt,
});

const createSyntheticEvent = (
  snapshot: WorkflowSnapshot,
  title: string,
  message: string,
  status: WorkflowNodeStatus,
  phase: WorkflowPhase = 'workflow',
): WorkflowEvent => ({
  eventId: crypto.randomUUID(),
  runId: snapshot.runId ?? crypto.randomUUID(),
  timestamp: new Date().toISOString(),
  phase,
  stepId: snapshot.currentStepId,
  retryCount: Math.max(1, snapshot.currentRetryCount),
  nodeId: `${phase}-${snapshot.currentStepId}-${Date.now()}`,
  title,
  message,
  status,
});

export class WorkflowManager {
  private readonly store: WorkflowSessionStore;
  private readonly publish: (envelope: WorkflowEventEnvelope) => void;
  private state: PersistedWorkflowManagerState;
  private stateMachine: WorkflowStateMachine | null = null;
  private readonly resumeTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(baseDir: string, publish: (envelope: WorkflowEventEnvelope) => void) {
    this.store = new WorkflowSessionStore(baseDir);
    this.publish = publish;
    this.state = this.store.load();
    this.recoverPersistedSessions();

    if (!this.state.activeSessionId && this.state.queuedSessionIds.length > 0) {
      void this.pumpQueue();
    }
  }

  getSnapshot(): WorkflowSnapshot {
    if (this.state.activeSessionId) {
      const active = this.getSessionRecord(this.state.activeSessionId);

      if (active) {
        return clonePersistedState(active.snapshot);
      }
    }

    const latest = [...this.state.sessions].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    return clonePersistedState(latest?.snapshot ?? createIdleSnapshot());
  }

  listSessions(): WorkflowSessionSummary[] {
    this.refreshQueuePositions();
    return [...this.state.sessions]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((record) => this.toSummary(record));
  }

  getSession(sessionId: string): PersistedWorkflowSessionRecord {
    const record = this.requireSessionRecord(sessionId);
    return clonePersistedState(record);
  }

  getQueue(): WorkflowQueueSnapshot {
    this.refreshQueuePositions();

    return {
      activeSessionId: this.state.activeSessionId,
      queuedSessionIds: [...this.state.queuedSessionIds],
      scheduledSessionIds: [...this.state.scheduledSessionIds],
      sessions: this.listSessions(),
    };
  }

  async start(prompt: string): Promise<WorkflowSnapshot> {
    const normalizedPrompt = prompt.trim();

    if (!normalizedPrompt) {
      throw new Error('Prompt is required.');
    }

    const sessionId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const record: PersistedWorkflowSessionRecord = {
      sessionId,
      runId: sessionId,
      title: buildSessionTitle(normalizedPrompt),
      promptPreview: buildPromptPreview(normalizedPrompt),
      createdAt,
      updatedAt: createdAt,
      lifecycle: this.state.activeSessionId ? 'queued' : 'idle',
      currentPhase: 'workflow',
      currentStepId: 0,
      queuePosition: null,
      executionState: this.state.activeSessionId ? 'queued' : 'idle',
      manualInterventionRequired: false,
      latestMessage: this.state.activeSessionId ? '等待前序 workflow 释放执行槽位。' : '等待启动。',
      metrics: createEmptyMetrics(createdAt),
      recovery: null,
      snapshot: this.state.activeSessionId ? createQueuedSnapshot(sessionId, normalizedPrompt, createdAt) : {
        ...createIdleSnapshot(),
        runId: sessionId,
        userPrompt: normalizedPrompt,
        updatedAt: createdAt,
      },
      events: [],
      context: null,
      phaseMetrics: [],
      collaborationSession: null,
    };

    this.state.sessions.push(record);

    if (this.state.activeSessionId) {
      this.enqueueSession(sessionId);
      this.appendSyntheticEvent(record, '已加入队列', '该 workflow 已进入等待队列，将在执行槽位空出后自动启动。', 'warning');
      this.saveState();
      return clonePersistedState(record.snapshot);
    }

    this.saveState();
    return this.activateSession(sessionId);
  }

  async continueSession(sessionId: string, prompt: string): Promise<WorkflowSnapshot> {
    const normalizedPrompt = prompt.trim();

    if (!normalizedPrompt) {
      throw new Error('Prompt is required.');
    }

    const record = this.requireSessionRecord(sessionId);

    if (this.state.activeSessionId && this.state.activeSessionId !== sessionId) {
      this.markSessionQueued(record, true);
      this.appendSyntheticEvent(record, '继续请求已排队', '当前有其他工作流正在执行，已加入队列。', 'warning');
      this.saveState();
      return clonePersistedState(record.snapshot);
    }

    record.promptPreview = buildPromptPreview(normalizedPrompt);
    record.title = buildSessionTitle(normalizedPrompt);
    record.updatedAt = new Date().toISOString();

    if (this.state.activeSessionId === sessionId && this.stateMachine) {
      const snapshot = await this.stateMachine.continueWorkflow(normalizedPrompt);
      this.syncRecordFromSnapshot(record, snapshot);
      this.persistRuntimeState(record);
      this.saveState();
      return clonePersistedState(snapshot);
    }

    record.snapshot.userPrompt = normalizedPrompt;
    return this.activateSession(sessionId);
  }

  async retryCurrentStep(): Promise<WorkflowSnapshot> {
    if (this.stateMachine && this.state.activeSessionId) {
      return this.stateMachine.retryCurrentStep();
    }

    const resumable = [...this.state.sessions]
      .filter((record) => record.context && record.manualInterventionRequired)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];

    if (!resumable) {
      throw new Error('No circuit-breaker checkpoint is waiting for manual retry.');
    }

    return this.resumeSession(resumable.sessionId);
  }

  pause(): WorkflowSnapshot {
    return this.runActiveSnapshotMutation((stateMachine) => stateMachine.pause(), 'No active workflow is running.');
  }

  async resumeCurrent(): Promise<WorkflowSnapshot> {
    const { stateMachine } = this.requireActiveWorkflow();

    stateMachine.applyRuntimeConfig(getWorkflowConfig());
    return stateMachine.resume();
  }

  cancel(): WorkflowSnapshot {
    return this.requireActiveWorkflow().stateMachine.cancel();
  }

  manualApprove(): WorkflowSnapshot {
    return this.requireActiveWorkflow().stateMachine.manualApprove();
  }

  manualReject(): WorkflowSnapshot {
    return this.requireActiveWorkflow().stateMachine.manualReject();
  }

  editPlanStep(stepId: number, update: { description?: string; promptOverride?: string | null; notes?: string | null }): WorkflowSnapshot {
    return this.runActiveSnapshotMutation((stateMachine) => stateMachine.editPlanStep(stepId, update));
  }

  insertPlanStep(afterStepId: number | null, input: { description: string; promptOverride?: string | null; notes?: string | null }): WorkflowSnapshot {
    return this.runActiveSnapshotMutation((stateMachine) => stateMachine.insertPlanStep(afterStepId, input));
  }

  removePlanStep(stepId: number): WorkflowSnapshot {
    return this.runActiveSnapshotMutation((stateMachine) => stateMachine.removePlanStep(stepId));
  }

  reorderPlanStep(stepId: number, targetIndex: number): WorkflowSnapshot {
    return this.runActiveSnapshotMutation((stateMachine) => stateMachine.reorderPlanStep(stepId, targetIndex));
  }

  movePlanStep(stepId: number, direction: 'up' | 'down'): WorkflowSnapshot {
    return this.runActiveSnapshotMutation((stateMachine) => stateMachine.movePlanStep(stepId, direction));
  }

  skipStep(stepId: number): WorkflowSnapshot {
    return this.runActiveSnapshotMutation((stateMachine) => stateMachine.skipStep(stepId));
  }

  sendCollaborationMessage(content: string): WorkflowSnapshot {
    return this.runActiveSnapshotMutation((stateMachine) => stateMachine.sendCollaborationMessage(content));
  }

  listTemplates(): WorkflowTemplate[] {
    return this.store.loadTemplates();
  }

  saveTemplate(template: WorkflowTemplateCreate): WorkflowTemplate {
    const fullTemplate: WorkflowTemplate = {
      ...template,
      id: crypto.randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.store.saveTemplate(fullTemplate);
    return fullTemplate;
  }

  deleteTemplate(templateId: string): void {
    this.store.deleteTemplate(templateId);
  }

  clearAllSessions(): number {
    const activeId = this.state.activeSessionId;
    const queued = new Set(this.state.queuedSessionIds);
    const scheduled = new Set(this.state.scheduledSessionIds);

    const keep = new Set<string>();
    if (activeId) keep.add(activeId);
    for (const id of queued) keep.add(id);
    for (const id of scheduled) keep.add(id);

    const before = this.state.sessions.length;
    this.state.sessions = this.state.sessions.filter((s) => keep.has(s.sessionId));
    this.state.queuedSessionIds = this.state.queuedSessionIds.filter((id) => keep.has(id));
    this.state.scheduledSessionIds = this.state.scheduledSessionIds.filter((id) => keep.has(id));

    this.saveState();
    return before - this.state.sessions.length;
  }

  exportAllSessionsZip(): { filePath: string } {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip();

    for (const record of this.state.sessions) {
      const fileName = `session-${record.sessionId.slice(0, 8)}.json`;
      const content = JSON.stringify(clonePersistedState(record), null, 2);
      zip.addFile(fileName, Buffer.from(content, 'utf8'));
    }

    const tmpDir = require('node:os').tmpdir();
    const filePath = require('node:path').join(tmpDir, `ai-fsm-sessions-${Date.now()}.zip`);
    zip.writeZip(filePath);
    return { filePath };
  }

  exportSession(sessionId: string, format: WorkflowExportFormat): WorkflowExportPayload {
    const record = this.requireSessionRecord(sessionId);

    if (format === 'json') {
      return {
        fileName: `session-${sessionId.slice(0, 8)}.json`,
        mimeType: 'application/json',
        content: `${JSON.stringify(clonePersistedState(record), null, 2)}\n`,
      };
    }

    const lines = [
      `# ${record.title}`,
      '',
      `- Session ID: ${record.sessionId}`,
      `- Lifecycle: ${record.lifecycle}`,
      `- Current Phase: ${record.currentPhase}`,
      `- Current Step: ${record.currentStepId}`,
      `- Total Cost USD: ${record.metrics.totalCostUsd.toFixed(4)}`,
      '',
      '## Prompt',
      '',
      record.snapshot.userPrompt || record.promptPreview,
      '',
      '## Plan',
      '',
      ...(record.snapshot.plan.length > 0
        ? record.snapshot.plan.map((step) => `- [${step.status ?? 'pending'}] Step ${step.step_id}: ${step.description}`)
        : ['- No plan captured.']),
      '',
      '## Events',
      '',
      ...record.events.flatMap((event) => [
        `### [${event.phase}] ${event.title}`,
        '',
        event.message,
        '',
        event.command ? `Command: ${event.command}` : '',
        '',
      ].filter(Boolean)),
    ];

    if (record.snapshot.collaboration?.messages.length) {
      lines.push('## Collaboration', '');
      for (const message of record.snapshot.collaboration.messages) {
        lines.push(`- ${message.source.label}: ${message.content}`);
      }
      lines.push('');
    }

    return {
      fileName: `session-${sessionId.slice(0, 8)}.md`,
      mimeType: 'text/markdown',
      content: `${lines.filter(Boolean).join('\n')}\n`,
    };
  }

  async resumeSession(sessionId: string): Promise<WorkflowSnapshot> {
    const record = this.requireSessionRecord(sessionId);
    this.clearScheduledResume(sessionId);

    if (this.state.activeSessionId && this.state.activeSessionId !== sessionId) {
      this.markSessionQueued(record, true);
      this.appendSyntheticEvent(record, '恢复请求已排队', '该 session 已被提到队列前列，等待当前 workflow 让出执行槽位。', 'warning');
      this.saveState();
      return clonePersistedState(record.snapshot);
    }

    return this.activateSession(sessionId);
  }

  private async activateSession(sessionId: string): Promise<WorkflowSnapshot> {
    const record = this.requireSessionRecord(sessionId);

    this.removeFromQueue(sessionId);
    this.removeFromScheduled(sessionId);
    this.state.activeSessionId = sessionId;
    record.executionState = 'active';
    record.queuePosition = null;
    this.stateMachine = new WorkflowStateMachine((envelope) => {
      this.handleEnvelope(sessionId, envelope);
    });

    let snapshot: WorkflowSnapshot;

    if (record.context) {
      const persistedSnapshot = {
        ...clonePersistedState(record.snapshot),
        passingScore: record.snapshot.passingScore ?? getWorkflowConfig().passingScore,
        lastVerificationScore: record.snapshot.lastVerificationScore ?? null,
      };

      const persistedState: WorkflowStateMachinePersistedState = {
        context: {
          ...clonePersistedState(record.context),
          lastVerificationScore: record.context.lastVerificationScore ?? persistedSnapshot.lastVerificationScore ?? null,
        },
        snapshot: persistedSnapshot,
        phaseMetrics: clonePersistedState(record.phaseMetrics),
        collaborationSession: clonePersistedState(record.collaborationSession),
      };

      this.stateMachine.hydrate(persistedState);
      this.stateMachine.applyRuntimeConfig(getWorkflowConfig());
      if (record.snapshot.lifecycle === 'needs_review') {
        snapshot = this.stateMachine.getSnapshot();
      } else {
        snapshot = record.snapshot.manualInterventionRequired && record.snapshot.circuitBreaker
          ? await this.stateMachine.retryCurrentStep()
          : await this.stateMachine.resume();
      }
    } else {
      snapshot = await this.stateMachine.start(record.snapshot.userPrompt, { runId: sessionId });
    }

    this.syncRecordFromSnapshot(record, snapshot);
    this.persistRuntimeState(record);
    this.saveState();
    return clonePersistedState(snapshot);
  }

  private handleEnvelope(sessionId: string, envelope: WorkflowEventEnvelope): void {
    const record = this.requireSessionRecord(sessionId);
    record.events = [...record.events, clonePersistedState(envelope.event)].slice(-MAX_SESSION_EVENTS);
    this.syncRecordFromSnapshot(record, envelope.snapshot, envelope.event.message);
    this.persistRuntimeState(record);
    this.saveState();
    this.publish(envelope);
    this.handleLifecycleTransition(sessionId, record, envelope.snapshot);
  }

  private handleLifecycleTransition(sessionId: string, record: PersistedWorkflowSessionRecord, snapshot: WorkflowSnapshot): void {
    if (snapshot.lifecycle === 'completed' || snapshot.lifecycle === 'failed') {
      this.releaseActiveSession(sessionId);
      void this.pumpQueue();
      return;
    }

    if (snapshot.lifecycle === 'needs_review') {
      record.executionState = 'active';
      this.saveState();
      return;
    }

    if (snapshot.lifecycle !== 'paused') {
      return;
    }

    const recovery = snapshot.circuitBreaker?.recovery ?? record.recovery;

    if (recovery?.autoRetryable) {
      this.scheduleQueuedResume(sessionId, recovery);
      return;
    }

    if (!snapshot.manualInterventionRequired) {
      record.executionState = 'active';
      this.saveState();
      return;
    }

    record.executionState = 'idle';
    this.releaseActiveSession(sessionId);
    this.saveState();
    void this.pumpQueue();
  }

  private scheduleQueuedResume(sessionId: string, recovery: WorkflowRecoveryDescriptor): void {
    const record = this.requireSessionRecord(sessionId);
    const delayMs = recovery.delayMs ?? 1_000;

    this.releaseActiveSession(sessionId);
    this.clearScheduledResume(sessionId);
    this.state.scheduledSessionIds.push(sessionId);
    record.executionState = 'scheduled';
    record.latestMessage = `${recovery.summary} 将在 ${delayMs}ms 后自动重试。`;
    this.saveState();

    const timer = setTimeout(() => {
      this.resumeTimers.delete(sessionId);
      const target = this.getSessionRecord(sessionId);

      if (!target) {
        return;
      }

      this.removeFromScheduled(sessionId);
      this.markSessionQueued(target);
      this.appendSyntheticEvent(target, '自动恢复已入队', '系统已按错误分类策略把该 session 放回执行队列。', 'warning');
      this.saveState();
      void this.pumpQueue();
    }, delayMs);

    this.resumeTimers.set(sessionId, timer);
    void this.pumpQueue();
  }

  private async pumpQueue(): Promise<void> {
    if (this.state.activeSessionId) {
      return;
    }

    const nextSessionId = this.state.queuedSessionIds.shift();

    if (!nextSessionId) {
      this.saveState();
      return;
    }

    this.saveState();
    await this.activateSession(nextSessionId);
  }

  private recoverPersistedSessions(): void {
    const config = getWorkflowConfig();
    const existingIds = new Set(this.state.sessions.map((record) => record.sessionId));
    this.state.queuedSessionIds = this.state.queuedSessionIds.filter((sessionId) => existingIds.has(sessionId));
    this.state.scheduledSessionIds = this.state.scheduledSessionIds.filter((sessionId) => existingIds.has(sessionId));

    for (const record of this.state.sessions) {
      record.events = Array.isArray(record.events) ? record.events : [];
      record.context = record.context ?? null;
      record.phaseMetrics = Array.isArray(record.phaseMetrics) ? record.phaseMetrics : [];
      record.collaborationSession = record.collaborationSession ?? record.snapshot.collaboration ?? null;
      record.snapshot.stepRepairAttempts = record.snapshot.stepRepairAttempts ?? record.context?.stepRepairAttempts ?? 0;
      record.snapshot.totalRepairAttempts = record.snapshot.totalRepairAttempts ?? record.context?.totalRepairAttempts ?? 0;
      record.snapshot.maxRepairAttemptsPerStep = record.snapshot.maxRepairAttemptsPerStep ?? config.maxRepairAttemptsPerStep;
      record.snapshot.maxTotalRepairAttempts = record.snapshot.maxTotalRepairAttempts ?? config.maxTotalRepairAttempts;
      record.snapshot.passingScore = record.snapshot.passingScore ?? config.passingScore;
      record.snapshot.lastVerificationScore = record.snapshot.lastVerificationScore ?? null;
      record.snapshot.executionSettings = record.snapshot.executionSettings ?? {
        claudeEffort: config.claudeEffort,
        opencodeVariant: config.opencodeVariant,
      };
      record.snapshot.budget = record.snapshot.budget ?? {
        capUsd: config.budgetCapUsd,
        spentUsd: record.context?.sessionCostUsd ?? 0,
        remainingUsd:
          config.budgetCapUsd == null
            ? null
            : Math.max(0, config.budgetCapUsd - (record.context?.sessionCostUsd ?? 0)),
        exceeded:
          config.budgetCapUsd == null
            ? false
            : (record.context?.sessionCostUsd ?? 0) >= config.budgetCapUsd,
        lastStepCostUsd: record.context?.lastStepCostUsd ?? null,
      };
      record.metrics = computeMetrics(record.events, record.createdAt, record.snapshot);

      if (record.context) {
        record.context.stepRepairAttempts = record.context.stepRepairAttempts ?? record.snapshot.stepRepairAttempts;
        record.context.totalRepairAttempts = record.context.totalRepairAttempts ?? record.snapshot.totalRepairAttempts;
        record.context.sessionCostUsd = record.context.sessionCostUsd ?? record.snapshot.budget.spentUsd;
        record.context.lastStepCostUsd = record.context.lastStepCostUsd ?? record.snapshot.budget.lastStepCostUsd;
        record.context.lastVerificationScore = record.context.lastVerificationScore ?? record.snapshot.lastVerificationScore;
      }

      if (record.executionState === 'scheduled') {
        record.executionState = 'queued';
        this.enqueueSession(record.sessionId);
      }

      if (record.lifecycle === 'needs_review') {
        record.manualInterventionRequired = true;
        record.snapshot.manualInterventionRequired = true;
        if (record.executionState === 'active') {
          record.executionState = 'idle';
        }
        continue;
      }

      if (record.lifecycle === 'running' || record.executionState === 'active') {
        this.markInterrupted(record);
      }
    }

    this.state.activeSessionId = null;
    this.refreshQueuePositions();
    this.saveState();
  }

  private markInterrupted(record: PersistedWorkflowSessionRecord): void {
    const recovery = createInterruptedRecovery(record.snapshot.currentPhase);
    const updatedAt = new Date().toISOString();
    const circuitBreaker = isRetriablePhase(record.snapshot.currentPhase)
      ? ({
          phase: record.snapshot.currentPhase,
          stepId: Math.max(1, record.snapshot.currentStepId),
          retryCount: Math.max(1, record.snapshot.currentRetryCount),
          reason: recovery.summary,
          recovery,
        } satisfies CircuitBreakerState)
      : null;

    record.snapshot = {
      ...record.snapshot,
      lifecycle: 'paused',
      currentPhase: circuitBreaker ? 'circuit-breaker' : record.snapshot.currentPhase,
      manualInterventionRequired: Boolean(circuitBreaker),
      circuitBreaker,
      updatedAt,
    };
    record.lifecycle = 'paused';
    record.executionState = 'idle';
    record.manualInterventionRequired = Boolean(circuitBreaker);
    record.updatedAt = updatedAt;
    record.recovery = recovery;
    record.latestMessage = recovery.summary;

    if (record.context) {
      record.context.manualInterventionRequired = Boolean(circuitBreaker);
      record.context.circuitBreaker = circuitBreaker;
    }

    this.appendSyntheticEvent(record, '检测到未完成会话', recovery.summary, 'warning');
  }

  private requireActiveWorkflow(errorMessage = 'No active workflow is loaded.'): {
    sessionId: string;
    stateMachine: WorkflowStateMachine;
  } {
    if (!this.stateMachine || !this.state.activeSessionId) {
      throw new Error(errorMessage);
    }

    return {
      sessionId: this.state.activeSessionId,
      stateMachine: this.stateMachine,
    };
  }

  private runActiveSnapshotMutation(
    mutate: (stateMachine: WorkflowStateMachine) => WorkflowSnapshot,
    errorMessage = 'No active workflow is loaded.',
  ): WorkflowSnapshot {
    const { sessionId, stateMachine } = this.requireActiveWorkflow(errorMessage);
    const snapshot = mutate(stateMachine);
    const record = this.requireSessionRecord(sessionId);

    this.syncRecordFromSnapshot(record, snapshot);
    this.persistRuntimeState(record);
    this.saveState();
    return clonePersistedState(snapshot);
  }

  private persistRuntimeState(record: PersistedWorkflowSessionRecord): void {
    if (!this.stateMachine || this.state.activeSessionId !== record.sessionId) {
      return;
    }

    const persistedState = this.stateMachine.getPersistedState();

    if (!persistedState) {
      return;
    }

    record.context = clonePersistedState(persistedState.context);
    record.phaseMetrics = clonePersistedState(persistedState.phaseMetrics);
    record.collaborationSession = clonePersistedState(persistedState.collaborationSession);
  }

  private syncRecordFromSnapshot(record: PersistedWorkflowSessionRecord, snapshot: WorkflowSnapshot, latestMessage?: string): void {
    record.snapshot = clonePersistedState(snapshot);
    record.runId = snapshot.runId;
    record.lifecycle = snapshot.lifecycle;
    record.currentPhase = snapshot.currentPhase;
    record.currentStepId = snapshot.currentStepId;
    record.manualInterventionRequired = snapshot.manualInterventionRequired;
    record.updatedAt = snapshot.updatedAt;
    record.recovery = snapshot.circuitBreaker?.recovery ?? (snapshot.lifecycle === 'completed' ? null : record.recovery);
    record.latestMessage = latestMessage ?? record.latestMessage;
    record.metrics = computeMetrics(record.events, record.createdAt, snapshot);
  }

  private appendSyntheticEvent(record: PersistedWorkflowSessionRecord, title: string, message: string, status: WorkflowNodeStatus): void {
    const event = createSyntheticEvent(record.snapshot, title, message, status);
    record.events = [...record.events, event].slice(-MAX_SESSION_EVENTS);
    record.latestMessage = message;
    record.updatedAt = event.timestamp;
    record.metrics = computeMetrics(record.events, record.createdAt, record.snapshot);
  }

  private markSessionQueued(record: PersistedWorkflowSessionRecord, toFront = false): void {
    record.executionState = 'queued';
    record.lifecycle = 'queued';
    record.snapshot = {
      ...record.snapshot,
      lifecycle: 'queued',
      updatedAt: new Date().toISOString(),
    };
    this.enqueueSession(record.sessionId, toFront);
  }

  private toSummary(record: PersistedWorkflowSessionRecord): WorkflowSessionSummary {
    return {
      sessionId: record.sessionId,
      runId: record.runId,
      title: record.title,
      promptPreview: record.promptPreview,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      lifecycle: record.lifecycle,
      currentPhase: record.currentPhase,
      currentStepId: record.currentStepId,
      queuePosition: record.queuePosition,
      executionState: record.executionState,
      manualInterventionRequired: record.manualInterventionRequired,
      latestMessage: record.latestMessage,
      metrics: record.metrics,
      recovery: record.recovery,
    };
  }

  private enqueueSession(sessionId: string, toFront = false): void {
    this.removeFromQueue(sessionId);

    if (toFront) {
      this.state.queuedSessionIds.unshift(sessionId);
    } else {
      this.state.queuedSessionIds.push(sessionId);
    }

    this.refreshQueuePositions();
  }

  private removeFromQueue(sessionId: string): void {
    this.state.queuedSessionIds = this.state.queuedSessionIds.filter((id) => id !== sessionId);
    this.refreshQueuePositions();
  }

  private removeFromScheduled(sessionId: string): void {
    this.state.scheduledSessionIds = this.state.scheduledSessionIds.filter((id) => id !== sessionId);
  }

  private clearScheduledResume(sessionId: string): void {
    const timer = this.resumeTimers.get(sessionId);

    if (timer) {
      clearTimeout(timer);
      this.resumeTimers.delete(sessionId);
    }

    this.removeFromScheduled(sessionId);
  }

  private releaseActiveSession(sessionId: string): void {
    if (this.state.activeSessionId !== sessionId) {
      return;
    }

    this.state.activeSessionId = null;
    this.stateMachine = null;
  }

  private refreshQueuePositions(): void {
    const queueIndex = new Map(this.state.queuedSessionIds.map((sessionId, index) => [sessionId, index + 1]));

    for (const record of this.state.sessions) {
      record.queuePosition = queueIndex.get(record.sessionId) ?? null;
    }
  }

  private saveState(): void {
    this.refreshQueuePositions();
    this.store.save(this.state);
  }

  private getSessionRecord(sessionId: string): PersistedWorkflowSessionRecord | undefined {
    return this.state.sessions.find((record) => record.sessionId === sessionId);
  }

  private requireSessionRecord(sessionId: string): PersistedWorkflowSessionRecord {
    const record = this.getSessionRecord(sessionId);

    if (!record) {
      throw new Error(`Unknown workflow session: ${sessionId}`);
    }

    return record;
  }
}