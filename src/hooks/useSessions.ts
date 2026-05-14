import { useCallback } from 'react';
import { useAgentFlow } from './useAgentFlow';
import { useWorkflowStore } from '../store/workflowStore';
import { useUIStore } from '../store/uiStore';
import { toErrorMessage } from '../lib/format';
import toast from 'react-hot-toast';

/** Hook providing session-related actions (inspect, resume, refresh). */
export const useSessions = () => {
  const agentFlow = useAgentFlow();
  const store = useWorkflowStore;

  const refreshSessions = useCallback(async (sessionIdToRefresh?: string | null) => {
    if (!agentFlow) return;
    try {
      const [sessions, queue] = await Promise.all([agentFlow.listSessions(), agentFlow.getQueue()]);
      store.getState().setSessions(sessions);
      store.getState().setQueueSnapshot(queue);

      const targetId = sessionIdToRefresh ?? store.getState().inspectedSession?.sessionId;
      if (targetId) {
        const record = await agentFlow.getSession(targetId);
        store.getState().setInspectedSession(record);
      }
    } catch (error) {
      toast.error(toErrorMessage(error));
    }
  }, [agentFlow]);

  const inspectSession = useCallback(async (sessionId: string) => {
    if (!agentFlow) return;
    try {
      const record = await agentFlow.getSession(sessionId);
      store.getState().setInspectedSession(record);
      useUIStore.getState().setHistoryDialogOpen(false);
    } catch (error) {
      toast.error(toErrorMessage(error));
    }
  }, [agentFlow]);

  const resumeSession = useCallback(async (sessionId: string) => {
    if (!agentFlow) return;
    try {
      const snapshot = await agentFlow.resumeSession(sessionId);
      await refreshSessions(sessionId);

      const record = await agentFlow.getSession(sessionId);
      store.getState().setActiveSessionRecord(record);

      if (snapshot.lifecycle === 'queued') {
        toast('该 session 已加入执行队列，等待当前 workflow 让出槽位。', { icon: '⏳' });
        return;
      }

      store.getState().setInspectedSession(null);
      store.getState().setFollowLatestNode(true);
      useUIStore.getState().setHistoryDialogOpen(false);
      toast.success('已从持久化断点恢复该 session。');
    } catch (error) {
      toast.error(toErrorMessage(error));
    }
  }, [agentFlow, refreshSessions]);

  return { refreshSessions, inspectSession, resumeSession };
};
