import { contextBridge, ipcRenderer } from 'electron';
import type {
  AgentFlowApi,
  RuntimeHealthSnapshot,
  WorkflowConfigSnapshot,
  WorkflowEventEnvelope,
  WorkflowExportFormat,
  WorkflowExportPayload,
  WorkflowQueueSnapshot,
  WorkflowRuntimeConfigUpdate,
  WorkflowSessionRecord,
  WorkflowSessionSummary,
  WorkflowSnapshot,
} from './shared/ipc';
import type { WorkflowTemplate, WorkflowTemplateCreate } from './shared/schema';

type AgentFlowBridge = AgentFlowApi & {
  insertPlanStep: (afterStepId: number | null, input: { description: string; promptOverride?: string | null; notes?: string | null }) => Promise<WorkflowSnapshot>;
  removePlanStep: (stepId: number) => Promise<WorkflowSnapshot>;
  reorderPlanStep: (stepId: number, targetIndex: number) => Promise<WorkflowSnapshot>;
  movePlanStep: (stepId: number, direction: 'up' | 'down') => Promise<WorkflowSnapshot>;
};

const api: AgentFlowBridge = {
  getVersion: async (): Promise<string> => ipcRenderer.invoke('app:version'),
  getChangelog: async (): Promise<string> => ipcRenderer.invoke('app:changelog'),
  invokeAgentFlow: async (prompt: string): Promise<WorkflowSnapshot> => ipcRenderer.invoke('workflow:start', prompt),
  continueAgentFlow: async (sessionId: string, prompt: string): Promise<WorkflowSnapshot> => ipcRenderer.invoke('workflow:continue', sessionId, prompt),
  retryCurrentStep: async (): Promise<WorkflowSnapshot> => ipcRenderer.invoke('workflow:retry'),
  pauseWorkflow: async (): Promise<WorkflowSnapshot> => ipcRenderer.invoke('workflow:pause'),
  resumeWorkflow: async (): Promise<WorkflowSnapshot> => ipcRenderer.invoke('workflow:resume'),
  cancelWorkflow: async (): Promise<WorkflowSnapshot> => ipcRenderer.invoke('workflow:cancel'),
  manualApprove: async (): Promise<WorkflowSnapshot> => ipcRenderer.invoke('workflow:manual-approve'),
  manualReject: async (): Promise<WorkflowSnapshot> => ipcRenderer.invoke('workflow:manual-reject'),
  getSnapshot: async (): Promise<WorkflowSnapshot> => ipcRenderer.invoke('workflow:snapshot'),
  listSessions: async (): Promise<WorkflowSessionSummary[]> => ipcRenderer.invoke('workflow:sessions:list'),
  getSession: async (sessionId: string): Promise<WorkflowSessionRecord> => ipcRenderer.invoke('workflow:sessions:get', sessionId),
  resumeSession: async (sessionId: string): Promise<WorkflowSnapshot> => ipcRenderer.invoke('workflow:sessions:resume', sessionId),
  getQueue: async (): Promise<WorkflowQueueSnapshot> => ipcRenderer.invoke('workflow:queue'),
  getRuntimeHealth: async (): Promise<RuntimeHealthSnapshot> => ipcRenderer.invoke('workflow:health'),
  getConfig: async (): Promise<WorkflowConfigSnapshot> => ipcRenderer.invoke('workflow:config:get'),
  updateConfig: async (update: WorkflowRuntimeConfigUpdate): Promise<WorkflowConfigSnapshot> => ipcRenderer.invoke('workflow:config:update', update),
  editPlanStep: async (stepId: number, update): Promise<WorkflowSnapshot> => ipcRenderer.invoke('workflow:plan:edit', stepId, update),
  insertPlanStep: async (afterStepId: number | null, input: { description: string; promptOverride?: string | null; notes?: string | null }): Promise<WorkflowSnapshot> => ipcRenderer.invoke('workflow:plan:insert', afterStepId, input),
  removePlanStep: async (stepId: number): Promise<WorkflowSnapshot> => ipcRenderer.invoke('workflow:plan:remove', stepId),
  reorderPlanStep: async (stepId: number, targetIndex: number): Promise<WorkflowSnapshot> => ipcRenderer.invoke('workflow:plan:reorder', stepId, targetIndex),
  movePlanStep: async (stepId: number, direction: 'up' | 'down'): Promise<WorkflowSnapshot> => ipcRenderer.invoke('workflow:plan:move', stepId, direction),
  skipStep: async (stepId: number): Promise<WorkflowSnapshot> => ipcRenderer.invoke('workflow:plan:skip', stepId),
  sendCollaborationMessage: async (content: string): Promise<WorkflowSnapshot> => ipcRenderer.invoke('workflow:collaboration:message', content),
  exportSession: async (sessionId: string, format: WorkflowExportFormat): Promise<WorkflowExportPayload> => ipcRenderer.invoke('workflow:sessions:export', sessionId, format),
  clearAllSessions: async (): Promise<number> => ipcRenderer.invoke('workflow:sessions:clear'),
  exportAllSessionsZip: async (): Promise<{ filePath: string }> => ipcRenderer.invoke('workflow:sessions:export-zip'),
  listTemplates: async (): Promise<WorkflowTemplate[]> => ipcRenderer.invoke('workflow:templates:list'),
  saveTemplate: async (template: WorkflowTemplateCreate): Promise<WorkflowTemplate> => ipcRenderer.invoke('workflow:templates:save', template),
  deleteTemplate: async (templateId: string): Promise<void> => ipcRenderer.invoke('workflow:templates:delete', templateId),
  onWorkflowEvent: (callback: (envelope: WorkflowEventEnvelope) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, envelope: WorkflowEventEnvelope): void => {
      callback(envelope);
    };

    ipcRenderer.on('workflow:event', listener);

    return (): void => {
      ipcRenderer.removeListener('workflow:event', listener);
    };
  },
};

contextBridge.exposeInMainWorld('agentFlow', api);