import { useCallback } from 'react';
import { useAgentFlow } from './useAgentFlow';
import { useConfigStore, buildConfigUpdateFromForm } from '../store/configStore';
import { toErrorMessage } from '../lib/format';
import toast from 'react-hot-toast';

/** Hook for config load/save actions. */
export const useConfig = () => {
  const agentFlow = useAgentFlow();
  const store = useConfigStore;

  const refreshConfig = useCallback(async () => {
    if (!agentFlow) {
      store.getState().setConfigError('当前未连接到 Electron preload bridge，不能读取运行配置。');
      return;
    }
    store.getState().setConfigLoading(true);
    try {
      const snapshot = await agentFlow.getConfig();
      store.getState().applyConfigSnapshot(snapshot);
    } catch (error) {
      store.getState().setConfigError(toErrorMessage(error));
    } finally {
      store.getState().setConfigLoading(false);
    }
  }, [agentFlow]);

  const saveConfig = useCallback(async () => {
    const { configForm } = store.getState();
    if (!agentFlow || !configForm) return;
    store.getState().setConfigSaving(true);
    try {
      const update = buildConfigUpdateFromForm(configForm);
      const snapshot = await agentFlow.updateConfig(update);
      store.getState().applyConfigSnapshot(snapshot);
      toast.success('配置已保存，将对后续新工作流生效。');
    } catch (error) {
      store.getState().setConfigError(toErrorMessage(error));
      toast.error('配置保存失败');
    } finally {
      store.getState().setConfigSaving(false);
    }
  }, [agentFlow]);

  return { refreshConfig, saveConfig };
};
