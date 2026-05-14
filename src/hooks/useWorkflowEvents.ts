import { startTransition, useEffect, useRef } from 'react';
import { useAgentFlow } from './useAgentFlow';
import { useWorkflowStore } from '../store/workflowStore';
import { useUIStore } from '../store/uiStore';
import { useConfigStore } from '../store/configStore';
import { toErrorMessage } from '../lib/format';
import toast from 'react-hot-toast';

/**
 * Master hook that sets up the workflow event listener, fetches initial data,
 * and keeps stores synced with the backend. Should be called once in AppShell.
 */
export const useWorkflowEvents = (): void => {
  const agentFlow = useAgentFlow();

  useEffect(() => {
    if (!agentFlow) {
      toast.error('未检测到 Electron 预加载桥接。当前页面可以渲染，但无法调用本地工作流。');
      return;
    }

    // Debounced refresh callback to avoid IPC flood during fast event streams
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedRefreshSessions = (): void => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        void refreshSessions();
      }, 500);
    };

    // Subscribe to real-time workflow events
    const dispose = agentFlow.onWorkflowEvent((envelope) => {
      startTransition(() => {
        const store = useWorkflowStore.getState();
        store.setSnapshot(envelope.snapshot);
        store.addEvent(envelope.event);
      });

      // Debounced session refresh instead of on every event
      debouncedRefreshSessions();
    });

    // Fetch initial data
    void agentFlow
      .getVersion()
      .then((v) => useUIStore.getState().setVersion(v))
      .catch(() => {});

    void agentFlow
      .getSnapshot()
      .then((snapshot) => useWorkflowStore.getState().setSnapshot(snapshot))
      .catch((error) => toast.error(toErrorMessage(error)));

    void refreshConfig();
    void refreshSessions();

    return (): void => {
      if (refreshTimer) clearTimeout(refreshTimer);
      dispose();
    };
  }, [agentFlow]);

  const refreshSessions = async (): Promise<void> => {
    if (!agentFlow) return;
    try {
      const [sessions, queue] = await Promise.all([agentFlow.listSessions(), agentFlow.getQueue()]);
      const store = useWorkflowStore.getState();
      store.setSessions(sessions);
      store.setQueueSnapshot(queue);

      if (queue.activeSessionId && store.events.length === 0) {
        const activeRecord = await agentFlow.getSession(queue.activeSessionId);
        store.setActiveSessionRecord(activeRecord);
      } else if (store.events.length === 0 && sessions.length > 0) {
        const latest = sessions[0];
        const record = await agentFlow.getSession(latest.sessionId);
        store.setActiveSessionRecord(record);
      }

      const inspected = store.inspectedSession;
      if (inspected) {
        const refreshed = await agentFlow.getSession(inspected.sessionId);
        // Only update if something actually changed to prevent infinite re-render loops.
        if (
          refreshed.snapshot.updatedAt !== inspected.snapshot.updatedAt ||
          refreshed.snapshot.lifecycle !== inspected.snapshot.lifecycle ||
          refreshed.events.length !== inspected.events.length
        ) {
          store.setInspectedSession(refreshed);
        }
      }
    } catch (error) {
      toast.error(toErrorMessage(error));
    }
  };

  const refreshConfig = async (): Promise<void> => {
    if (!agentFlow) return;
    try {
      const snapshot = await agentFlow.getConfig();
      useConfigStore.getState().applyConfigSnapshot(snapshot);
    } catch (error) {
      useConfigStore.getState().setConfigError(toErrorMessage(error));
    }
  };
};
