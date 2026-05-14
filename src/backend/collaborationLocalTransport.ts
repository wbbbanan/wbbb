import crypto from 'node:crypto';
import type {
  CollaborationAgent,
  CollaborationMessage,
  CollaborationSessionSnapshot,
  CollaborationSessionStatus,
} from '../shared/ipc';
import { cloneCollaborationSession } from './cloneUtils';

const MAX_SESSION_MESSAGES = 120;

export interface CreateCollaborationSessionInput {
  runId: string;
  goal: string;
}

export interface AppendCollaborationMessageInput extends Omit<CollaborationMessage, 'messageId' | 'createdAt'> {}

export interface UpsertCollaborationAgentInput extends Omit<CollaborationAgent, 'lastUpdatedAt'> {
  lastUpdatedAt?: string;
}

export class CollaborationLocalTransport {
  private readonly sessions = new Map<string, CollaborationSessionSnapshot>();

  hydrateSession(session: CollaborationSessionSnapshot): CollaborationSessionSnapshot {
    const nextSession = cloneCollaborationSession(session);
    this.sessions.set(nextSession.sessionId, nextSession);
    return cloneCollaborationSession(nextSession);
  }

  createSession(input: CreateCollaborationSessionInput): CollaborationSessionSnapshot {
    const timestamp = new Date().toISOString();
    const session: CollaborationSessionSnapshot = {
      sessionId: crypto.randomUUID(),
      runId: input.runId,
      mode: 'local-direct',
      status: 'active',
      goal: input.goal,
      createdAt: timestamp,
      updatedAt: timestamp,
      activeAgentId: null,
      latestSummary: '',
      agents: [],
      messages: [],
    };

    this.sessions.set(session.sessionId, session);
    return cloneCollaborationSession(session);
  }

  getSession(sessionId: string): CollaborationSessionSnapshot | null {
    const session = this.sessions.get(sessionId);
    return session ? cloneCollaborationSession(session) : null;
  }

  upsertAgent(sessionId: string, input: UpsertCollaborationAgentInput): CollaborationSessionSnapshot | null {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return null;
    }

    const timestamp = input.lastUpdatedAt ?? new Date().toISOString();
    const nextAgent: CollaborationAgent = {
      agentId: input.agentId,
      role: input.role,
      label: input.label,
      status: input.status,
      summary: input.summary,
      lastUpdatedAt: timestamp,
    };

    const existingIndex = session.agents.findIndex((agent) => agent.agentId === input.agentId);

    if (existingIndex >= 0) {
      session.agents[existingIndex] = nextAgent;
    } else {
      session.agents.push(nextAgent);
    }

    session.updatedAt = timestamp;
    return cloneCollaborationSession(session);
  }

  appendMessage(sessionId: string, input: AppendCollaborationMessageInput): CollaborationSessionSnapshot | null {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return null;
    }

    const timestamp = new Date().toISOString();
    const message: CollaborationMessage = {
      messageId: crypto.randomUUID(),
      createdAt: timestamp,
      ...input,
      metadata: input.metadata ? { ...input.metadata } : undefined,
    };

    session.messages = [...session.messages, message].slice(-MAX_SESSION_MESSAGES);
    session.updatedAt = timestamp;
    return cloneCollaborationSession(session);
  }

  updateSessionStatus(
    sessionId: string,
    status: CollaborationSessionStatus,
    options?: { activeAgentId?: string | null; latestSummary?: string },
  ): CollaborationSessionSnapshot | null {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return null;
    }

    session.status = status;
    session.updatedAt = new Date().toISOString();

    if (typeof options?.activeAgentId !== 'undefined') {
      session.activeAgentId = options.activeAgentId;
    }

    if (typeof options?.latestSummary === 'string') {
      session.latestSummary = options.latestSummary;
    }

    return cloneCollaborationSession(session);
  }
}
