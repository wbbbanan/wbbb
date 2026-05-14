import type { WorkflowConfigSnapshot, WorkflowRuntimeConfig, WorkflowRuntimeConfigUpdate } from './ipc';

export type WorkflowToolKind = 'opencode' | 'claude';

export interface WorkflowToolRuntimeConfig {
  cliPath: string | null;
  apiKey: string | null;
  apiKeyEnvName: string | null;
  configContent: string | null;
  extraEnv: string | null;
}

export interface WorkflowToolRuntimeConfigUpdate {
  cliPath?: string | null;
  apiKey?: string | null;
  apiKeyEnvName?: string | null;
  configContent?: string | null;
  extraEnv?: string | null;
}

export interface ExtendedWorkflowRuntimeConfig extends WorkflowRuntimeConfig {
  maxPlanSteps: number;
  toolRuntimes: Record<WorkflowToolKind, WorkflowToolRuntimeConfig>;
}

export interface ExtendedWorkflowRuntimeConfigUpdate extends WorkflowRuntimeConfigUpdate {
  maxPlanSteps?: number;
  toolRuntimes?: Partial<Record<WorkflowToolKind, WorkflowToolRuntimeConfigUpdate>>;
}

export interface ExtendedWorkflowConfigSnapshot extends Omit<WorkflowConfigSnapshot, 'config'> {
  config: ExtendedWorkflowRuntimeConfig;
}

export const DEFAULT_TOOL_RUNTIME_CONFIGS: Record<WorkflowToolKind, WorkflowToolRuntimeConfig> = {
  opencode: {
    cliPath: null,
    apiKey: null,
    apiKeyEnvName: 'OPENCODE_API_KEY',
    configContent: null,
    extraEnv: null,
  },
  claude: {
    cliPath: null,
    apiKey: null,
    apiKeyEnvName: 'ANTHROPIC_API_KEY',
    configContent: null,
    extraEnv: null,
  },
};

const ENVIRONMENT_ASSIGNMENT_PATTERN = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u;

export interface WorkflowToolEnvironmentEntry {
  key: string;
  value: string;
}

export const normalizeOptionalConfigString = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

export const parseToolEnvironmentEntries = (value: string | null | undefined): WorkflowToolEnvironmentEntry[] => {
  const normalized = normalizeOptionalConfigString(value);

  if (!normalized) {
    return [];
  }

  return normalized.split(/\r?\n/gu).reduce<WorkflowToolEnvironmentEntry[]>((entries, rawLine, index) => {
    const line = rawLine.trim();

    if (!line || line.startsWith('#')) {
      return entries;
    }

    const match = ENVIRONMENT_ASSIGNMENT_PATTERN.exec(line);

    if (!match) {
      throw new Error(`第 ${index + 1} 行不是有效的 KEY=VALUE 配置。`);
    }

    const [, key, rawValue] = match;
    const valueText =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) || (rawValue.startsWith("'") && rawValue.endsWith("'"))
        ? rawValue.slice(1, -1)
        : rawValue;

    entries.push({ key, value: valueText });
    return entries;
  }, []);
};

export const stringifyToolEnvironmentEntries = (
  entries: Iterable<{ key: string; value: string }>,
): string | null => {
  const lines: string[] = [];

  for (const entry of entries) {
    const key = normalizeOptionalConfigString(entry.key);

    if (!key) {
      continue;
    }

    lines.push(`${key}=${entry.value}`);
  }

  return lines.length > 0 ? lines.join('\n') : null;
};

const normalizeToolRuntimeConfig = (value: unknown, fallback: WorkflowToolRuntimeConfig): WorkflowToolRuntimeConfig => {
  if (!value || typeof value !== 'object') {
    return { ...fallback };
  }

  const candidate = value as Partial<WorkflowToolRuntimeConfig>;

  return {
    cliPath: normalizeOptionalConfigString(candidate.cliPath) ?? fallback.cliPath,
    apiKey: normalizeOptionalConfigString(candidate.apiKey) ?? fallback.apiKey,
    apiKeyEnvName: normalizeOptionalConfigString(candidate.apiKeyEnvName) ?? fallback.apiKeyEnvName,
    configContent: normalizeOptionalConfigString(candidate.configContent) ?? fallback.configContent,
    extraEnv: normalizeOptionalConfigString(candidate.extraEnv) ?? fallback.extraEnv,
  };
};

export const withToolRuntimeConfig = (config: WorkflowRuntimeConfig): ExtendedWorkflowRuntimeConfig => {
  const candidate = config as WorkflowRuntimeConfig & {
    toolRuntimes?: Partial<Record<WorkflowToolKind, WorkflowToolRuntimeConfig>>;
  };

  return {
    ...config,
    toolRuntimes: {
      opencode: normalizeToolRuntimeConfig(candidate.toolRuntimes?.opencode, DEFAULT_TOOL_RUNTIME_CONFIGS.opencode),
      claude: normalizeToolRuntimeConfig(candidate.toolRuntimes?.claude, DEFAULT_TOOL_RUNTIME_CONFIGS.claude),
    },
  };
};

export const withToolRuntimeSnapshot = (snapshot: WorkflowConfigSnapshot): ExtendedWorkflowConfigSnapshot => ({
  ...snapshot,
  config: withToolRuntimeConfig(snapshot.config),
});