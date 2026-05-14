import type { WorkflowRuntimeConfig } from '../shared/ipc';
import {
  parseToolEnvironmentEntries,
  type WorkflowToolKind,
  type WorkflowToolRuntimeConfig,
  withToolRuntimeConfig,
} from '../shared/toolRuntimeConfig';
import { getWorkflowConfig } from './configManager';

const DEFAULT_TOOL_BINS: Record<WorkflowToolKind, string> = {
  opencode: 'opencode',
  claude: 'claude',
};

const DEFAULT_API_KEY_ENV_NAMES: Record<WorkflowToolKind, string> = {
  opencode: 'OPENCODE_API_KEY',
  claude: 'ANTHROPIC_API_KEY',
};

const normalizeOptionalValue = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

export const getToolRuntimeConfig = (
  tool: WorkflowToolKind,
  config: WorkflowRuntimeConfig = getWorkflowConfig(),
): WorkflowToolRuntimeConfig => withToolRuntimeConfig(config).toolRuntimes[tool];

export const resolveToolCommandBin = (
  tool: WorkflowToolKind,
  config: WorkflowRuntimeConfig = getWorkflowConfig(),
): string => normalizeOptionalValue(getToolRuntimeConfig(tool, config).cliPath) ?? DEFAULT_TOOL_BINS[tool];

export const resolveToolApiKeyEnvName = (
  tool: WorkflowToolKind,
  config: WorkflowRuntimeConfig = getWorkflowConfig(),
): string => normalizeOptionalValue(getToolRuntimeConfig(tool, config).apiKeyEnvName) ?? DEFAULT_API_KEY_ENV_NAMES[tool];

export const buildToolEnvironment = (
  tool: WorkflowToolKind,
  config: WorkflowRuntimeConfig = getWorkflowConfig(),
): NodeJS.ProcessEnv | undefined => {
  const runtime = getToolRuntimeConfig(tool, config);
  const apiKey = normalizeOptionalValue(runtime.apiKey);
  const env: NodeJS.ProcessEnv = {};

  for (const entry of parseToolEnvironmentEntries(runtime.extraEnv)) {
    env[entry.key] = entry.value;
  }

  if (apiKey) {
    env[resolveToolApiKeyEnvName(tool, config)] = apiKey;
  }

  if (tool === 'opencode') {
    const configContent = normalizeOptionalValue(runtime.configContent);

    if (configContent) {
      env.OPENCODE_CONFIG_CONTENT = configContent;
    }
  }

  return Object.keys(env).length > 0 ? env : undefined;
};

export const buildToolLaunchSpec = (
  tool: WorkflowToolKind,
  config: WorkflowRuntimeConfig = getWorkflowConfig(),
): { bin: string; env?: NodeJS.ProcessEnv } => {
  const env = buildToolEnvironment(tool, config);

  return {
    bin: resolveToolCommandBin(tool, config),
    ...(env ? { env } : {}),
  };
};