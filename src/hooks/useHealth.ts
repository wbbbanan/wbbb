import { useState, useCallback } from 'react';
import { useAgentFlow } from './useAgentFlow';
import type { RuntimeHealthSnapshot } from '../shared/ipc';
import { toErrorMessage } from '../lib/format';
import toast from 'react-hot-toast';

/** Hook for runtime health check data and refresh action. */
export const useHealth = () => {
  const agentFlow = useAgentFlow();
  const [runtimeHealth, setRuntimeHealth] = useState<RuntimeHealthSnapshot | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);

  const refreshRuntimeHealth = useCallback(async () => {
    if (!agentFlow) {
      setHealthError('当前未连接到 Electron preload bridge，不能执行本机健康检查。');
      return;
    }
    setHealthLoading(true);
    try {
      const health = await agentFlow.getRuntimeHealth();
      setRuntimeHealth(health);
      setHealthError(null);
    } catch (error) {
      setHealthError(toErrorMessage(error));
      toast.error('健康检查失败');
    } finally {
      setHealthLoading(false);
    }
  }, [agentFlow]);

  return { runtimeHealth, healthLoading, healthError, refreshRuntimeHealth };
};
