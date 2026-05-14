import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { CollaborationSessionSnapshot, WorkflowSessionRecord } from '../shared/ipc';
import type { WorkflowTemplate } from '../shared/schema';
import { cloneJson } from './cloneUtils';
import { getWorkflowConfig } from './configManager';
import type { WorkflowPersistedContext, WorkflowPersistedPhaseMetric } from './workflowRuntimeTypes';

export interface PersistedWorkflowSessionRecord extends WorkflowSessionRecord {
  context: WorkflowPersistedContext | null;
  phaseMetrics: WorkflowPersistedPhaseMetric[];
  collaborationSession: CollaborationSessionSnapshot | null;
}

export interface PersistedWorkflowManagerState {
  activeSessionId: string | null;
  queuedSessionIds: string[];
  scheduledSessionIds: string[];
  sessions: PersistedWorkflowSessionRecord[];
}

interface PersistedWorkflowManagerIndex {
  activeSessionId: string | null;
  queuedSessionIds: string[];
  scheduledSessionIds: string[];
}

type PersistedWorkflowSessionDocument = Omit<PersistedWorkflowSessionRecord, 'events'>;

const defaultState = (): PersistedWorkflowManagerState => ({
  activeSessionId: null,
  queuedSessionIds: [],
  scheduledSessionIds: [],
  sessions: [],
});

const VALID_LIFECYCLES = new Set(['idle', 'queued', 'running', 'paused', 'needs_review', 'completed', 'failed']);
const VALID_EXECUTION_STATES = new Set(['idle', 'queued', 'scheduled', 'active']);

const validateSessionRecord = (parsed: PersistedWorkflowSessionDocument, sessionId: string): PersistedWorkflowSessionDocument | null => {
  if (!parsed || typeof parsed !== 'object') {
    console.warn(`[WorkflowSessionStore] session ${sessionId}: not an object, skipping.`);
    return null;
  }

  const record = parsed as Record<string, unknown>;

  if (typeof record.sessionId !== 'string' || record.sessionId.length === 0) {
    console.warn(`[WorkflowSessionStore] session ${sessionId}: missing sessionId, skipping.`);
    return null;
  }

  if (!record.snapshot || typeof record.snapshot !== 'object') {
    console.warn(`[WorkflowSessionStore] session ${sessionId}: missing snapshot, skipping.`);
    return null;
  }

  // Repair missing or invalid fields
  const now = new Date().toISOString();

  if (typeof record.updatedAt !== 'string') {
    record.updatedAt = now;
  }

  if (typeof record.createdAt !== 'string') {
    record.createdAt = record.updatedAt;
  }

  if (typeof record.title !== 'string' || record.title.length === 0) {
    record.title = 'Recovered Session';
  }

  if (typeof record.promptPreview !== 'string') {
    record.promptPreview = '';
  }

  if (!VALID_LIFECYCLES.has(record.lifecycle as string)) {
    record.lifecycle = 'failed';
  }

  if (!VALID_EXECUTION_STATES.has(record.executionState as string)) {
    record.executionState = 'idle';
  }

  if (typeof record.currentStepId !== 'number' || !Number.isFinite(record.currentStepId)) {
    record.currentStepId = 0;
  }

  if (typeof record.currentPhase !== 'string') {
    record.currentPhase = 'workflow';
  }

  if (typeof record.manualInterventionRequired !== 'boolean') {
    record.manualInterventionRequired = false;
  }

  if (typeof record.latestMessage !== 'string') {
    record.latestMessage = '';
  }

  if (!record.metrics || typeof record.metrics !== 'object') {
    record.metrics = {
      eventCount: 0,
      warningCount: 0,
      errorCount: 0,
      retryCount: 0,
      totalCostUsd: 0,
      startedAt: null,
      completedAt: null,
      updatedAt: record.updatedAt,
    };
  }

  return parsed as PersistedWorkflowSessionDocument;
};

export const clonePersistedState = cloneJson;

const defaultIndex = (): PersistedWorkflowManagerIndex => ({
  activeSessionId: null,
  queuedSessionIds: [],
  scheduledSessionIds: [],
});

const isExpiredSession = (
  record: PersistedWorkflowSessionRecord,
  cutoffTime: number,
  activeSessionId: string | null,
  queuedSessionIds: string[],
  scheduledSessionIds: string[],
): boolean => {
  if (record.sessionId === activeSessionId) {
    return false;
  }

  if (queuedSessionIds.includes(record.sessionId) || scheduledSessionIds.includes(record.sessionId)) {
    return false;
  }

  if (record.manualInterventionRequired) {
    return false;
  }

  if (record.lifecycle !== 'completed' && record.lifecycle !== 'failed') {
    return false;
  }

  const updatedAt = Date.parse(record.updatedAt);

  return Number.isFinite(updatedAt) && updatedAt < cutoffTime;
};

export class WorkflowSessionStore {
  private readonly baseDir: string;
  private readonly statePath: string;
  private readonly sessionsDir: string;
  private readonly legacyStatePath: string;
  private readonly templatesPath: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    this.statePath = path.join(baseDir, 'workflow-manager-state.json');
    this.sessionsDir = path.join(baseDir, 'sessions');
    this.legacyStatePath = path.join(baseDir, 'workflow-sessions.json');
    this.templatesPath = path.join(baseDir, 'templates.jsonl');
  }

  load(): PersistedWorkflowManagerState {
    if (!existsSync(this.sessionsDir)) {
      return this.loadLegacyState();
    }

    const state = {
      ...defaultState(),
      ...this.readManagerIndex(),
      sessions: this.readSessionRecords(),
    };

    this.normalizeState(state);
    this.cleanupExpiredSessions(state);
    return state;
  }

  save(state: PersistedWorkflowManagerState): void {
    mkdirSync(this.baseDir, { recursive: true });
    mkdirSync(this.sessionsDir, { recursive: true });
    this.cleanupExpiredSessions(state);
    this.normalizeState(state);

    for (const record of state.sessions) {
      this.writeSessionRecord(record);
    }

    const persistedIds = new Set(state.sessions.map((record) => record.sessionId));

    for (const sessionId of this.listSessionDirectories()) {
      if (!persistedIds.has(sessionId)) {
        rmSync(this.getSessionDir(sessionId), { recursive: true, force: true });
      }
    }

    writeFileSync(
      this.statePath,
      `${JSON.stringify(
        {
          activeSessionId: state.activeSessionId,
          queuedSessionIds: state.queuedSessionIds,
          scheduledSessionIds: state.scheduledSessionIds,
        } satisfies PersistedWorkflowManagerIndex,
        null,
        2,
      )}\n`,
      'utf8',
    );
  }

  saveTemplate(template: WorkflowTemplate): void {
    mkdirSync(this.baseDir, { recursive: true });

    try {
      appendFileSync(this.templatesPath, JSON.stringify(template) + '\n');
    } catch (error) {
      throw new Error('Failed to save template: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  deleteTemplate(templateId: string): void {
    const templates = this.loadTemplates().filter((t) => t.id !== templateId);
    try {
      writeFileSync(this.templatesPath, '', 'utf-8');
    } catch (error) {
      throw new Error('Failed to clear templates file: ' + (error instanceof Error ? error.message : String(error)));
    }
    for (const template of templates) {
      this.saveTemplate(template);
    }
  }

  loadTemplates(): WorkflowTemplate[] {
    if (!existsSync(this.templatesPath)) {
      return [];
    }

    try {
      return readFileSync(this.templatesPath, 'utf8')
        .split(/\r?\n/gu)
        .map((line) => line.trim())
        .filter(Boolean)
        .flatMap((line) => {
          try {
            return [JSON.parse(line) as WorkflowTemplate];
          } catch {
            console.warn(`[WorkflowSessionStore] failed to parse template line, skipping: ${line.slice(0, 80)}`);
            return [];
          }
        });
    } catch (error) {
      console.warn('[WorkflowSessionStore] failed to load templates, returning empty list.', error);
      return [];
    }
  }

  private loadLegacyState(): PersistedWorkflowManagerState {
    if (!existsSync(this.legacyStatePath)) {
      return defaultState();
    }

    try {
      const raw = readFileSync(this.legacyStatePath, 'utf8');
      const parsed = JSON.parse(raw) as PersistedWorkflowManagerState;

      return {
        activeSessionId: parsed.activeSessionId ?? null,
        queuedSessionIds: Array.isArray(parsed.queuedSessionIds) ? parsed.queuedSessionIds : [],
        scheduledSessionIds: Array.isArray(parsed.scheduledSessionIds) ? parsed.scheduledSessionIds : [],
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      };
    } catch (error) {
      console.warn('[WorkflowSessionStore] failed to load legacy state, using defaults.', error);
      return defaultState();
    }
  }

  private readManagerIndex(): PersistedWorkflowManagerIndex {
    if (!existsSync(this.statePath)) {
      return defaultIndex();
    }

    try {
      const raw = readFileSync(this.statePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedWorkflowManagerIndex>;

      return {
        activeSessionId: typeof parsed.activeSessionId === 'string' ? parsed.activeSessionId : null,
        queuedSessionIds: Array.isArray(parsed.queuedSessionIds) ? parsed.queuedSessionIds.filter((value): value is string => typeof value === 'string') : [],
        scheduledSessionIds: Array.isArray(parsed.scheduledSessionIds)
          ? parsed.scheduledSessionIds.filter((value): value is string => typeof value === 'string')
          : [],
      };
    } catch (error) {
      console.warn('[WorkflowSessionStore] failed to read manager index, using defaults.', error);
      return defaultIndex();
    }
  }

  private readSessionRecords(): PersistedWorkflowSessionRecord[] {
    return this.listSessionDirectories()
      .map((sessionId) => this.readSessionRecord(sessionId))
      .filter((record): record is PersistedWorkflowSessionRecord => Boolean(record))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  private readSessionRecord(sessionId: string): PersistedWorkflowSessionRecord | null {
    const sessionPath = path.join(this.getSessionDir(sessionId), 'session.json');

    if (!existsSync(sessionPath)) {
      return null;
    }

    try {
      const raw = readFileSync(sessionPath, 'utf8');
      const parsed = JSON.parse(raw) as PersistedWorkflowSessionDocument;
      const validated = validateSessionRecord(parsed, sessionId);

      if (!validated) {
        return null;
      }

      return {
        ...validated,
        events: this.readSessionEvents(sessionId),
      };
    } catch (error) {
      console.warn(`[WorkflowSessionStore] session ${sessionId}: parse error, skipping.`, error);
      return null;
    }
  }

  private readSessionEvents(sessionId: string) {
    const eventsPath = path.join(this.getSessionDir(sessionId), 'events.jsonl');

    if (!existsSync(eventsPath)) {
      return [];
    }

    return readFileSync(eventsPath, 'utf8')
      .split(/\r?\n/gu)
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          console.warn(`[WorkflowSessionStore] failed to parse event line, skipping: ${line.slice(0, 80)}`);
          return [];
        }
      });
  }

  private writeSessionRecord(record: PersistedWorkflowSessionRecord): void {
    const sessionDir = this.getSessionDir(record.sessionId);
    const sessionPath = path.join(sessionDir, 'session.json');
    const eventsPath = path.join(sessionDir, 'events.jsonl');
    const { events, ...sessionDocument } = clonePersistedState(record);

    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(sessionPath, `${JSON.stringify(sessionDocument satisfies PersistedWorkflowSessionDocument, null, 2)}\n`, 'utf8');
    writeFileSync(eventsPath, events.map((event) => JSON.stringify(event)).join('\n'), 'utf8');
  }

  private normalizeState(state: PersistedWorkflowManagerState): void {
    const existingIds = new Set(state.sessions.map((record) => record.sessionId));
    const queuedFallback = state.sessions
      .filter((record) => record.executionState === 'queued')
      .sort((left, right) => (left.queuePosition ?? Number.MAX_SAFE_INTEGER) - (right.queuePosition ?? Number.MAX_SAFE_INTEGER))
      .map((record) => record.sessionId);
    const scheduledFallback = state.sessions.filter((record) => record.executionState === 'scheduled').map((record) => record.sessionId);

    if (!state.activeSessionId || !existingIds.has(state.activeSessionId)) {
      state.activeSessionId = state.sessions.find((record) => record.executionState === 'active')?.sessionId ?? null;
    }

    state.queuedSessionIds = (state.queuedSessionIds.length > 0 ? state.queuedSessionIds : queuedFallback).filter(
      (sessionId) => existingIds.has(sessionId) && sessionId !== state.activeSessionId,
    );
    state.scheduledSessionIds = (state.scheduledSessionIds.length > 0 ? state.scheduledSessionIds : scheduledFallback).filter(
      (sessionId) => existingIds.has(sessionId) && sessionId !== state.activeSessionId && !state.queuedSessionIds.includes(sessionId),
    );
  }

  private cleanupExpiredSessions(state: PersistedWorkflowManagerState): void {
    const cutoffTime = Date.now() - getWorkflowConfig().cleanupPeriodDays * 24 * 60 * 60 * 1_000;
    const expiredIds = new Set(
      state.sessions
        .filter((record) => isExpiredSession(record, cutoffTime, state.activeSessionId, state.queuedSessionIds, state.scheduledSessionIds))
        .map((record) => record.sessionId),
    );

    if (expiredIds.size === 0) {
      return;
    }

    state.sessions = state.sessions.filter((record) => !expiredIds.has(record.sessionId));
    state.queuedSessionIds = state.queuedSessionIds.filter((sessionId) => !expiredIds.has(sessionId));
    state.scheduledSessionIds = state.scheduledSessionIds.filter((sessionId) => !expiredIds.has(sessionId));

    if (state.activeSessionId && expiredIds.has(state.activeSessionId)) {
      state.activeSessionId = null;
    }

    for (const sessionId of expiredIds) {
      rmSync(this.getSessionDir(sessionId), { recursive: true, force: true });
    }

    for (const sessionId of this.listSessionDirectories()) {
      if (expiredIds.has(sessionId)) {
        continue;
      }

      if (state.sessions.some((record) => record.sessionId === sessionId)) {
        continue;
      }

      try {
        const stats = statSync(this.getSessionDir(sessionId));

        if (stats.mtimeMs < cutoffTime) {
          rmSync(this.getSessionDir(sessionId), { recursive: true, force: true });
        }
      } catch {
        // Ignore orphan cleanup races and keep loading other sessions.
      }
    }
  }

  private listSessionDirectories(): string[] {
    if (!existsSync(this.sessionsDir)) {
      return [];
    }

    return readdirSync(this.sessionsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  }

  private getSessionDir(sessionId: string): string {
    return path.join(this.sessionsDir, sessionId);
  }
}