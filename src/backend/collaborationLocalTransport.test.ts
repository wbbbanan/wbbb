import { describe, expect, it } from 'vitest';
import type { CollaborationSessionSnapshot } from '../shared/ipc';
import { CollaborationLocalTransport } from './collaborationLocalTransport';

const createSession = (): CollaborationSessionSnapshot => ({
  sessionId: 'session-1',
  runId: 'run-1',
  mode: 'local-direct',
  status: 'active',
  goal: 'Ship a fix',
  createdAt: '2026-05-13T00:00:00.000Z',
  updatedAt: '2026-05-13T00:00:00.000Z',
  activeAgentId: null,
  latestSummary: '',
  agents: [
    {
      agentId: 'agent-1',
      role: 'operator',
      label: 'Operator',
      status: 'idle',
    },
  ],
  messages: [
    {
      messageId: 'message-1',
      kind: 'operator',
      source: {
        agentId: 'agent-1',
        role: 'operator',
        label: 'Operator',
      },
      content: 'Check the latest diff',
      createdAt: '2026-05-13T00:00:00.000Z',
      details: {
        step_id: 1,
      },
      metadata: {
        channel: 'ui',
      },
    },
  ],
  pendingPermissionRequests: [
    {
      requestId: 'request-1',
      agentId: 'agent-1',
      toolName: 'Read',
      reason: 'Need file context',
      status: 'pending',
      createdAt: '2026-05-13T00:00:00.000Z',
      updatedAt: '2026-05-13T00:00:00.000Z',
    },
  ],
});

describe('CollaborationLocalTransport', () => {
  it('preserves nested session fields and returns isolated clones', () => {
    const transport = new CollaborationLocalTransport();
    const hydrated = transport.hydrateSession(createSession());

    hydrated.pendingPermissionRequests![0].status = 'approved';
    hydrated.messages[0].source.label = 'Mutated';
    hydrated.messages[0].details = { step_id: 2 };
    hydrated.messages[0].metadata = { channel: 'mutated' };

    const stored = transport.getSession(hydrated.sessionId)!;

    expect(stored.pendingPermissionRequests).toEqual([
      {
        requestId: 'request-1',
        agentId: 'agent-1',
        toolName: 'Read',
        reason: 'Need file context',
        status: 'pending',
        createdAt: '2026-05-13T00:00:00.000Z',
        updatedAt: '2026-05-13T00:00:00.000Z',
      },
    ]);
    expect(stored.messages[0].source.label).toBe('Operator');
    expect(stored.messages[0].details).toEqual({ step_id: 1 });
    expect(stored.messages[0].metadata).toEqual({ channel: 'ui' });
  });
});