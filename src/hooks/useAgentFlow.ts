import type { AgentFlowApi } from '../shared/ipc';

type AgentFlowPlanStructureApi = {
  insertPlanStep: (afterStepId: number | null, input: { description: string; promptOverride?: string | null; notes?: string | null }) => Promise<import('../shared/ipc').WorkflowSnapshot>;
  removePlanStep: (stepId: number) => Promise<import('../shared/ipc').WorkflowSnapshot>;
  reorderPlanStep: (stepId: number, targetIndex: number) => Promise<import('../shared/ipc').WorkflowSnapshot>;
  movePlanStep: (stepId: number, direction: 'up' | 'down') => Promise<import('../shared/ipc').WorkflowSnapshot>;
};

export type AgentFlowBridge = AgentFlowApi & AgentFlowPlanStructureApi;

/** Get the preload bridge (agentFlow), or null if not available. */
export const getAgentFlowBridge = (): AgentFlowBridge | null => {
  const candidate = (window as Window & { agentFlow?: unknown }).agentFlow as Partial<AgentFlowBridge> | undefined;

  if (!candidate) return null;

  if (
    typeof candidate.getVersion !== 'function' ||
    typeof candidate.getChangelog !== 'function' ||
    typeof candidate.invokeAgentFlow !== 'function' ||
    typeof candidate.retryCurrentStep !== 'function' ||
    typeof candidate.pauseWorkflow !== 'function' ||
    typeof candidate.resumeWorkflow !== 'function' ||
    typeof candidate.cancelWorkflow !== 'function' ||
    typeof candidate.manualApprove !== 'function' ||
    typeof candidate.manualReject !== 'function' ||
    typeof candidate.getSnapshot !== 'function' ||
    typeof candidate.listSessions !== 'function' ||
    typeof candidate.getSession !== 'function' ||
    typeof candidate.resumeSession !== 'function' ||
    typeof candidate.getQueue !== 'function' ||
    typeof candidate.getRuntimeHealth !== 'function' ||
    typeof candidate.getConfig !== 'function' ||
    typeof candidate.updateConfig !== 'function' ||
    typeof candidate.editPlanStep !== 'function' ||
    typeof candidate.insertPlanStep !== 'function' ||
    typeof candidate.removePlanStep !== 'function' ||
    typeof candidate.reorderPlanStep !== 'function' ||
    typeof candidate.movePlanStep !== 'function' ||
    typeof candidate.skipStep !== 'function' ||
    typeof candidate.sendCollaborationMessage !== 'function' ||
    typeof candidate.exportSession !== 'function' ||
    typeof candidate.onWorkflowEvent !== 'function'
  ) {
    return null;
  }

  return candidate as AgentFlowBridge;
};

/** Singleton cached reference. */
let cachedBridge: AgentFlowBridge | null | undefined;

export const useAgentFlow = (): AgentFlowBridge | null => {
  if (cachedBridge === undefined) {
    cachedBridge = getAgentFlowBridge();
  }
  return cachedBridge;
};
