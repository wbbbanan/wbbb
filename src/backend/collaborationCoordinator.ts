import { formatCommand, runCommandWithStdin } from './processRunner';
import { getWorkflowConfig, renderPromptTemplate } from './configManager';
import { buildToolLaunchSpec } from './toolRuntimeConfig';
import type {
  ClaudeExecutionEffort,
  CollaborationHints,
  CollaborationSessionSnapshot,
  PlanStep,
  PlanningResponse,
  VerificationResponse,
} from '../shared/ipc';
import { CollaborationLocalTransport } from './collaborationLocalTransport';

const COORDINATOR_AGENT_ID = 'claude-coordinator';
const DEFAULT_AGENT_ROLES = ['researcher', 'implementer', 'reviewer'];

export interface CollaborationExecutionResult {
  command: string;
  prompt: string;
  rawOutput: string;
  session: CollaborationSessionSnapshot | null;
}

export class CollaborationCoordinator {
  private readonly transport = new CollaborationLocalTransport();

  get enabled(): boolean {
    return getWorkflowConfig().collaborationEnabled;
  }

  createWorkflowSession(runId: string, userPrompt: string): CollaborationSessionSnapshot | null {
    if (!this.enabled) {
      return null;
    }

    const session = this.transport.createSession({
      runId,
      goal: userPrompt,
    });

    this.transport.upsertAgent(session.sessionId, {
      agentId: 'opencode-planner',
      role: 'planner',
      label: 'OpenCode Planner',
      status: 'idle',
      summary: '等待结构化计划。',
    });
    this.transport.upsertAgent(session.sessionId, {
      agentId: COORDINATOR_AGENT_ID,
      role: 'coordinator',
      label: 'Claude Coordinator',
      status: 'idle',
      summary: '等待接收执行任务。',
    });
    this.transport.upsertAgent(session.sessionId, {
      agentId: 'opencode-verifier',
      role: 'verifier',
      label: 'OpenCode Verifier',
      status: 'idle',
      summary: '等待验收任务。',
    });
    this.transport.appendMessage(session.sessionId, {
      source: { agentId: 'system', role: 'system', label: 'System' },
      kind: 'session',
      content: '多 agent 协作会话已创建，将由 Claude Coordinator 协调执行，OpenCode 负责规划与验收。',
      details: {
        mode: session.mode,
      },
    });

    return this.getSession(session.sessionId);
  }

  getSession(sessionId: string | null | undefined): CollaborationSessionSnapshot | null {
    if (!sessionId) {
      return null;
    }

    return this.transport.getSession(sessionId);
  }

  hydrateSession(session: CollaborationSessionSnapshot | null | undefined): CollaborationSessionSnapshot | null {
    if (!session) {
      return null;
    }

    return this.transport.hydrateSession(session);
  }

  recordPlanningTurn(sessionId: string | null | undefined, step: PlanStep, response: PlanningResponse): CollaborationSessionSnapshot | null {
    const session = this.getSession(sessionId);

    if (!session) {
      return null;
    }

    this.transport.upsertAgent(session.sessionId, {
      agentId: 'opencode-planner',
      role: 'planner',
      label: 'OpenCode Planner',
      status: 'completed',
      summary: `已为步骤 ${step.step_id} 生成扩写提示词。`,
    });

    for (const role of this.resolveSuggestedRoles(response.collaboration_hints)) {
      this.transport.upsertAgent(session.sessionId, {
        agentId: `claude-${role}`,
        role,
        label: `Claude ${role}`,
        status: 'idle',
        summary: '等待协调者分派。',
      });
    }

    this.transport.appendMessage(session.sessionId, {
      source: { agentId: 'opencode-planner', role: 'planner', label: 'OpenCode Planner' },
      kind: 'plan',
      content: `OpenCode 已完成步骤 ${step.step_id} 的规划与扩写提示词生成。`,
      details: {
        current_step_id: response.current_step_id,
        collaboration_hints: response.collaboration_hints,
      },
    });

    return this.getSession(session.sessionId);
  }

  async executeStep(input: {
    sessionId: string | null | undefined;
    userPrompt: string;
    step: PlanStep;
    executionPrompt: string;
    collaborationHints?: CollaborationHints | null;
    claudeEffort: ClaudeExecutionEffort;
  }): Promise<CollaborationExecutionResult> {
    const session = this.getSession(input.sessionId);

    if (!session) {
      throw new Error('Collaboration session is not available.');
    }

    const prompt = this.buildCoordinatorPrompt({
      goal: session.goal,
      step: input.step,
      executionPrompt: input.executionPrompt,
      collaborationHints: input.collaborationHints ?? null,
      userPrompt: input.userPrompt,
      session,
    });
    const launch = buildToolLaunchSpec('claude');
    const args = ['-p', '--verbose', '--output-format', 'stream-json', '--dangerously-skip-permissions', '--effort', input.claudeEffort];
    const command = formatCommand(launch.bin, args);

    this.transport.updateSessionStatus(session.sessionId, 'active', {
      activeAgentId: COORDINATOR_AGENT_ID,
    });
    this.transport.upsertAgent(session.sessionId, {
      agentId: COORDINATOR_AGENT_ID,
      role: 'coordinator',
      label: 'Claude Coordinator',
      status: 'running',
      summary: `正在协调执行步骤 ${input.step.step_id}。`,
    });
    this.transport.appendMessage(session.sessionId, {
      source: { agentId: COORDINATOR_AGENT_ID, role: 'coordinator', label: 'Claude Coordinator' },
      kind: 'dispatch',
      content: `Claude Coordinator 已接手步骤 ${input.step.step_id}，将根据当前会话组织执行。`,
      details: {
        suggested_agent_roles: this.resolveSuggestedRoles(input.collaborationHints ?? null),
      },
    });

    const result = await runCommandWithStdin({
      bin: launch.bin,
      args,
      env: launch.env,
    }, prompt);

    return {
      command,
      prompt,
      rawOutput: result.stdout,
      session: this.getSession(session.sessionId),
    };
  }

  recordExecutionResult(
    sessionId: string | null | undefined,
    step: PlanStep,
    summary: string,
    metadata?: Record<string, unknown>,
  ): CollaborationSessionSnapshot | null {
    const session = this.getSession(sessionId);

    if (!session) {
      return null;
    }

    this.transport.upsertAgent(session.sessionId, {
      agentId: COORDINATOR_AGENT_ID,
      role: 'coordinator',
      label: 'Claude Coordinator',
      status: 'completed',
      summary: `步骤 ${step.step_id} 执行完成。`,
    });
    this.transport.updateSessionStatus(session.sessionId, 'active', {
      activeAgentId: null,
      latestSummary: summary,
    });
    this.transport.appendMessage(session.sessionId, {
      source: { agentId: COORDINATOR_AGENT_ID, role: 'coordinator', label: 'Claude Coordinator' },
      kind: 'assistant',
      content: summary,
      details: metadata,
    });

    return this.getSession(session.sessionId);
  }

  recordVerificationTurn(sessionId: string | null | undefined, step: PlanStep, response: VerificationResponse): CollaborationSessionSnapshot | null {
    const session = this.getSession(sessionId);

    if (!session) {
      return null;
    }

    this.transport.upsertAgent(session.sessionId, {
      agentId: 'opencode-verifier',
      role: 'verifier',
      label: 'OpenCode Verifier',
      status: response.status === 'approved' ? 'completed' : 'waiting',
      summary: response.summary,
    });
    this.transport.appendMessage(session.sessionId, {
      source: { agentId: 'opencode-verifier', role: 'verifier', label: 'OpenCode Verifier' },
      kind: 'verification',
      content: response.summary,
      details: {
        step_id: step.step_id,
        status: response.status,
        failed_reasons: response.failed_reasons,
        next_instruction: response.next_instruction,
      },
    });

    return this.getSession(session.sessionId);
  }

  appendOperatorMessage(sessionId: string | null | undefined, content: string): CollaborationSessionSnapshot | null {
    const session = this.getSession(sessionId);

    if (!session) {
      return null;
    }

    this.transport.appendMessage(session.sessionId, {
      source: { agentId: 'operator-console', role: 'operator', label: 'Operator Console' },
      kind: 'operator',
      content,
    });

    return this.getSession(session.sessionId);
  }

  recordRepairInstruction(sessionId: string | null | undefined, step: PlanStep, verification: VerificationResponse): CollaborationSessionSnapshot | null {
    const session = this.getSession(sessionId);

    if (!session) {
      return null;
    }

    this.transport.upsertAgent(session.sessionId, {
      agentId: COORDINATOR_AGENT_ID,
      role: 'coordinator',
      label: 'Claude Coordinator',
      status: 'waiting',
      summary: `等待根据 OpenCode 反馈修复步骤 ${step.step_id}。`,
    });
    this.transport.appendMessage(session.sessionId, {
      source: { agentId: 'opencode-verifier', role: 'verifier', label: 'OpenCode Verifier' },
      kind: 'repair',
      content: verification.next_instruction || '根据失败原因进行二次修复。',
      details: {
        step_id: step.step_id,
        failed_reasons: verification.failed_reasons,
      },
    });

    return this.getSession(session.sessionId);
  }

  markPaused(sessionId: string | null | undefined, reason: string): CollaborationSessionSnapshot | null {
    const session = this.getSession(sessionId);

    if (!session) {
      return null;
    }

    this.transport.updateSessionStatus(session.sessionId, 'paused', {
      activeAgentId: null,
    });
    this.transport.appendMessage(session.sessionId, {
      source: { agentId: 'system', role: 'system', label: 'System' },
      kind: 'status',
      content: `协作会话已暂停：${reason}`,
    });

    return this.getSession(session.sessionId);
  }

  markCompleted(sessionId: string | null | undefined, summary: string): CollaborationSessionSnapshot | null {
    const session = this.getSession(sessionId);

    if (!session) {
      return null;
    }

    this.transport.updateSessionStatus(session.sessionId, 'completed', {
      activeAgentId: null,
      latestSummary: summary,
    });
    this.transport.appendMessage(session.sessionId, {
      source: { agentId: 'system', role: 'system', label: 'System' },
      kind: 'result',
      content: '多 agent 协作会话已完成。',
      details: {
        final_summary: summary,
      },
    });

    return this.getSession(session.sessionId);
  }

  private resolveSuggestedRoles(hints: CollaborationHints | null | undefined): string[] {
    const roles = hints?.suggested_agent_roles?.filter((role) => role.trim().length > 0) ?? [];
    return roles.length > 0 ? roles : DEFAULT_AGENT_ROLES;
  }

  private buildCoordinatorPrompt(input: {
    goal: string;
    step: PlanStep;
    executionPrompt: string;
    collaborationHints: CollaborationHints | null;
    userPrompt: string;
    session: CollaborationSessionSnapshot;
  }): string {
    const suggestedRoles = this.resolveSuggestedRoles(input.collaborationHints).join(', ');

    return renderPromptTemplate(getWorkflowConfig().promptTemplates.coordinatorExecution, {
      sessionId: input.session.sessionId,
      userPrompt: input.userPrompt,
      stepId: String(input.step.step_id),
      stepDescription: input.step.description,
      suggestedRoles,
      coordinationNotes: input.collaborationHints?.coordination_notes || '无额外提示，请自行协调研究、实现与回顾。',
      executionPrompt: input.executionPrompt,
    });
   }
 }
