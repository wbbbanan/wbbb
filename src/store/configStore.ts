import { create } from 'zustand';
import type {
  WorkflowConfigSnapshot,
  WorkflowPromptTemplates,
  WorkflowRuntimeConfig,
} from '../shared/ipc';
import {
  type ExtendedWorkflowConfigSnapshot,
  type ExtendedWorkflowRuntimeConfig,
  type ExtendedWorkflowRuntimeConfigUpdate,
  parseToolEnvironmentEntries,
  type WorkflowToolRuntimeConfig,
  withToolRuntimeSnapshot,
} from '../shared/toolRuntimeConfig';

interface ToolRuntimeFormState {
  cliPath: string;
  apiKey: string;
  apiKeyEnvName: string;
  configContent: string;
  extraEnv: string;
}

export interface ConfigFormState {
  claudeEffort: WorkflowRuntimeConfig['claudeEffort'];
  opencodeVariant: WorkflowRuntimeConfig['opencodeVariant'];
  budgetCapUsd: string;
  commandTimeoutMs: string;
  healthTimeoutMs: string;
  opencodeTimeoutMs: string;
  backoffBaseMs: string;
  backoffMaxMs: string;
  jsonRepairRetries: string;
  processRetries: string;
  executionRetries: string;
  maxRepairAttemptsPerStep: string;
  maxTotalRepairAttempts: string;
  passingScore: string;
  cleanupPeriodDays: string;
  maxPlanSteps: string;
  collaborationEnabled: boolean;
  toolRuntimes: {
    opencode: ToolRuntimeFormState;
    claude: ToolRuntimeFormState;
  };
  promptTemplates: WorkflowPromptTemplates;
}

const createToolRuntimeFormState = (config: WorkflowToolRuntimeConfig): ToolRuntimeFormState => ({
  cliPath: config.cliPath ?? '',
  apiKey: config.apiKey ?? '',
  apiKeyEnvName: config.apiKeyEnvName ?? '',
  configContent: config.configContent ?? '',
  extraEnv: config.extraEnv ?? '',
});

export const createConfigFormState = (config: ExtendedWorkflowRuntimeConfig): ConfigFormState => ({
  claudeEffort: config.claudeEffort,
  opencodeVariant: config.opencodeVariant,
  budgetCapUsd: config.budgetCapUsd == null ? '' : String(config.budgetCapUsd),
  commandTimeoutMs: String(config.commandTimeoutMs),
  healthTimeoutMs: String(config.healthTimeoutMs),
  opencodeTimeoutMs: String(config.opencodeTimeoutMs),
  backoffBaseMs: String(config.backoffBaseMs),
  backoffMaxMs: String(config.backoffMaxMs),
  jsonRepairRetries: String(config.jsonRepairRetries),
  processRetries: String(config.processRetries),
  executionRetries: String(config.executionRetries),
  maxRepairAttemptsPerStep: String(config.maxRepairAttemptsPerStep),
  maxTotalRepairAttempts: String(config.maxTotalRepairAttempts),
  passingScore: String(config.passingScore),
  cleanupPeriodDays: String(config.cleanupPeriodDays),
  maxPlanSteps: String(config.maxPlanSteps),
  collaborationEnabled: config.collaborationEnabled,
  toolRuntimes: {
    opencode: createToolRuntimeFormState(config.toolRuntimes.opencode),
    claude: createToolRuntimeFormState(config.toolRuntimes.claude),
  },
  promptTemplates: { ...config.promptTemplates },
});

const parsePositiveInteger = (label: string, value: string): number => {
  const parsed = Number(value.trim());
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} 必须是正整数。`);
  }
  return parsed;
};

const parseBudgetCap = (value: string): number | null => {
  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('预算上限必须是正数，或留空表示不限制。');
  }

  return parsed;
};

const parseOptionalString = (value: string): string | null => {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const parseOptionalEnvironmentBlock = (label: string, value: string): string | null => {
  const normalized = parseOptionalString(value);

  if (!normalized) {
    return null;
  }

  try {
    parseToolEnvironmentEntries(normalized);
  } catch (error) {
    throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }

  return normalized;
};

export const buildConfigUpdateFromForm = (form: ConfigFormState): ExtendedWorkflowRuntimeConfigUpdate => ({
  claudeEffort: form.claudeEffort,
  opencodeVariant: form.opencodeVariant,
  budgetCapUsd: parseBudgetCap(form.budgetCapUsd),
  commandTimeoutMs: parsePositiveInteger('命令超时', form.commandTimeoutMs),
  healthTimeoutMs: parsePositiveInteger('健康检查超时', form.healthTimeoutMs),
  opencodeTimeoutMs: parsePositiveInteger('OpenCode 超时', form.opencodeTimeoutMs),
  backoffBaseMs: parsePositiveInteger('退避基数', form.backoffBaseMs),
  backoffMaxMs: parsePositiveInteger('退避上限', form.backoffMaxMs),
  jsonRepairRetries: parsePositiveInteger('JSON 修复重试', form.jsonRepairRetries),
  processRetries: parsePositiveInteger('进程重试', form.processRetries),
  executionRetries: parsePositiveInteger('执行重试', form.executionRetries),
  maxRepairAttemptsPerStep: parsePositiveInteger('单步修复上限', form.maxRepairAttemptsPerStep),
  maxTotalRepairAttempts: parsePositiveInteger('总修复上限', form.maxTotalRepairAttempts),
  passingScore: parsePositiveInteger('验收通过分数', form.passingScore),
  cleanupPeriodDays: parsePositiveInteger('自动清理天数', form.cleanupPeriodDays),
  maxPlanSteps: parsePositiveInteger('最大计划步数', form.maxPlanSteps),
  collaborationEnabled: form.collaborationEnabled,
  toolRuntimes: {
    opencode: {
      cliPath: parseOptionalString(form.toolRuntimes.opencode.cliPath),
      apiKey: parseOptionalString(form.toolRuntimes.opencode.apiKey),
      apiKeyEnvName: parseOptionalString(form.toolRuntimes.opencode.apiKeyEnvName),
      configContent: parseOptionalString(form.toolRuntimes.opencode.configContent),
      extraEnv: parseOptionalEnvironmentBlock('OpenCode 额外环境变量', form.toolRuntimes.opencode.extraEnv),
    },
    claude: {
      cliPath: parseOptionalString(form.toolRuntimes.claude.cliPath),
      apiKey: parseOptionalString(form.toolRuntimes.claude.apiKey),
      apiKeyEnvName: parseOptionalString(form.toolRuntimes.claude.apiKeyEnvName),
      configContent: parseOptionalString(form.toolRuntimes.claude.configContent),
      extraEnv: parseOptionalEnvironmentBlock('Claude 额外环境变量', form.toolRuntimes.claude.extraEnv),
    },
  },
  promptTemplates: { ...form.promptTemplates },
});

interface ConfigState {
  configSnapshot: ExtendedWorkflowConfigSnapshot | null;
  configForm: ConfigFormState | null;
  configLoading: boolean;
  configSaving: boolean;
  configDirty: boolean;
  configError: string | null;

  setConfigSnapshot: (snapshot: WorkflowConfigSnapshot) => void;
  setConfigForm: (form: ConfigFormState | null) => void;
  setConfigLoading: (loading: boolean) => void;
  setConfigSaving: (saving: boolean) => void;
  setConfigDirty: (dirty: boolean) => void;
  setConfigError: (error: string | null) => void;

  handleFieldChange: <K extends keyof Omit<ConfigFormState, 'promptTemplates'>>(
    field: K,
    value: ConfigFormState[K],
  ) => void;

  handleToolRuntimeFieldChange: (
    tool: keyof ConfigFormState['toolRuntimes'],
    field: keyof ToolRuntimeFormState,
    value: string,
  ) => void;

  handlePromptTemplateChange: (field: keyof WorkflowPromptTemplates, value: string) => void;

  applyConfigSnapshot: (snapshot: WorkflowConfigSnapshot) => void;
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  configSnapshot: null,
  configForm: null,
  configLoading: false,
  configSaving: false,
  configDirty: false,
  configError: null,

  setConfigSnapshot: (snapshot) => set({ configSnapshot: withToolRuntimeSnapshot(snapshot) }),
  setConfigForm: (form) => set({ configForm: form }),
  setConfigLoading: (loading) => set({ configLoading: loading }),
  setConfigSaving: (saving) => set({ configSaving: saving }),
  setConfigDirty: (dirty) => set({ configDirty: dirty }),
  setConfigError: (error) => set({ configError: error }),

  handleFieldChange: (field, value) => {
    const { configForm } = get();
    if (configForm) {
      set({
        configForm: { ...configForm, [field]: value },
        configDirty: true,
      });
    }
  },

  handleToolRuntimeFieldChange: (tool, field, value) => {
    const { configForm } = get();
    if (configForm) {
      set({
        configForm: {
          ...configForm,
          toolRuntimes: {
            ...configForm.toolRuntimes,
            [tool]: {
              ...configForm.toolRuntimes[tool],
              [field]: value,
            },
          },
        },
        configDirty: true,
      });
    }
  },

  handlePromptTemplateChange: (field, value) => {
    const { configForm } = get();
    if (configForm) {
      set({
        configForm: {
          ...configForm,
          promptTemplates: { ...configForm.promptTemplates, [field]: value },
        },
        configDirty: true,
      });
    }
  },

  applyConfigSnapshot: (snapshot) => {
    const normalizedSnapshot = withToolRuntimeSnapshot(snapshot);

    return set({
      configSnapshot: normalizedSnapshot,
      configForm: createConfigFormState(normalizedSnapshot.config),
      configDirty: false,
      configError: null,
    });
  },
}));
