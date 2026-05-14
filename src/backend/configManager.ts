import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type {
  ClaudeExecutionEffort,
  OpencodeVariant,
  WorkflowPromptTemplates,
} from '../shared/ipc';
import { workflowRuntimeConfigSchema, workflowRuntimeConfigUpdateSchema } from '../shared/schema';
import {
  DEFAULT_TOOL_RUNTIME_CONFIGS,
  type ExtendedWorkflowConfigSnapshot,
  type ExtendedWorkflowRuntimeConfig,
  type ExtendedWorkflowRuntimeConfigUpdate,
  type WorkflowToolKind,
  type WorkflowToolRuntimeConfig,
  type WorkflowToolRuntimeConfigUpdate,
  normalizeOptionalConfigString,
  stringifyToolEnvironmentEntries,
  withToolRuntimeSnapshot,
} from '../shared/toolRuntimeConfig';

const workflowToolRuntimeConfigSchema = z.object({
  cliPath: z.string().trim().min(1).nullable(),
  apiKey: z.string().trim().min(1).nullable(),
  apiKeyEnvName: z.string().trim().min(1).nullable(),
  configContent: z.string().trim().min(1).nullable(),
  extraEnv: z.string().trim().min(1).nullable(),
});

const workflowToolRuntimeConfigUpdateSchema = z.object({
  cliPath: z.string().trim().min(1).nullable().optional(),
  apiKey: z.string().trim().min(1).nullable().optional(),
  apiKeyEnvName: z.string().trim().min(1).nullable().optional(),
  configContent: z.string().trim().min(1).nullable().optional(),
  extraEnv: z.string().trim().min(1).nullable().optional(),
});

const workflowRuntimeConfigWithToolsSchema = (workflowRuntimeConfigSchema as z.AnyZodObject).extend({
  toolRuntimes: z.object({
    opencode: workflowToolRuntimeConfigSchema,
    claude: workflowToolRuntimeConfigSchema,
  }),
});

const workflowRuntimeConfigWithToolsUpdateSchema = (workflowRuntimeConfigUpdateSchema as z.AnyZodObject).extend({
  toolRuntimes: z.object({
    opencode: workflowToolRuntimeConfigUpdateSchema.optional(),
    claude: workflowToolRuntimeConfigUpdateSchema.optional(),
  }).partial().optional(),
});

const DEFAULT_PROMPT_TEMPLATES: WorkflowPromptTemplates = {
  planningInitial: [
    '{{planningGuardrails}}',
    '',
    '用户需求（仅供分析，禁止执行）：',
    '{{userPrompt}}',
    '',
    '请根据需求生成详细的原子步骤计划。',
    '每个步骤必须满足以下要求：',
    '1. 只做一件事——一个独立的、可单独验证的改动',
    '2. 有明确的完成标准——具体到文件路径、函数名、预期行为',
    '3. 禁止模糊描述——不允许"优化代码"、"完善逻辑"等，必须写明具体改什么、改到什么程度',
    '4. 步骤之间尽量解耦——每步完成后代码应处于可编译可运行状态',
    '',
    '步骤数量建议：简单需求 5-10 步，中等需求 10-20 步，复杂需求 20+ 步。宁可多拆不要少拆。',
    '',
    '为当前需要执行的第一步生成极度详尽的扩写提示词。',
    '如果当前步骤适合 Claude Coordinator 组织多 agent 执行，也请返回 collaboration_hints。',
    '',
    '{{planningSchemaBlock}}',
  ].join('\n'),
  planningStep: [
    '{{planningGuardrails}}',
    '',
    '原始需求（仅供分析，禁止执行）：',
    '{{userPrompt}}',
    '',
    '已确定计划：{{planJson}}',
    '',
    '当前需要执行的 step_id 为 {{currentStepId}}，步骤描述为：{{currentStepDescription}}',
    '请保留 plan 不变，只为当前步骤生成 expanded_prompt_for_current_step，并返回 current_step_id。',
    '如果当前步骤适合 Claude Coordinator 组织多 agent 执行，也请返回 collaboration_hints。',
    '',
    '{{planningSchemaBlock}}',
  ].join('\n'),
  verification: [
    '你当前处于验收模式。',
    '你可以读取文件并运行验证命令，但严禁修改任何文件，严禁调用写入类工具。',
    '你的唯一任务是检查当前代码状态，并输出严格 JSON。',
    '',
    '当前验收步骤：{{stepId}} - {{stepDescription}}',
    '',
    '{{scoringRubric}}',
    '',
    '依据刚才的执行摘要，检查代码修改，运行测试命令进行验证。',
    '你必须实际运行测试/编译/lint 命令来验证，不能只看代码就判断。',
    '根据评分标准给出 1-10 分的 score，并据此设置 status。',
    '',
    'Claude 执行摘要：',
    '{{lastExecutionSummary}}',
    '',
    '{{verificationSchemaBlock}}',
  ].join('\n'),
  fallbackExecution: [
    '原始需求：{{userPrompt}}',
    '当前步骤：{{stepId}} - {{stepDescription}}',
    '请直接在当前仓库中完成该步骤，并总结代码修改与验证结果。',
  ].join('\n'),
  repair: [
    '原始需求：{{userPrompt}}',
    '当前步骤：{{stepId}} - {{stepDescription}}',
    '',
    '上一轮 Claude 执行摘要：',
    '{{lastExecutionSummary}}',
    '',
    'OpenCode 验收未通过。请根据以下反馈直接修复代码，并再次总结修改与测试情况：',
    '{{failedReasons}}',
    '',
    '下一步修改指令：{{nextInstruction}}',
  ].join('\n'),
  coordinatorExecution: [
    '你当前以 Claude Code Coordinator 的身份运行。',
    '你的职责是协调 Claude Code 的多 agent 执行能力，并与 OpenCode 规划/验收结果保持一致。',
    '如果当前环境支持多 agent、子任务分派或并行协作，请优先使用；如果不支持，则以单 agent 方式完成，但仍要保持协调者口吻与交接结构。',
    '严禁重新规划产品方向；必须严格围绕 OpenCode 给出的当前步骤执行。',
    '',
    '协作会话: {{sessionId}}',
    '原始需求: {{userPrompt}}',
    '当前步骤: {{stepId}} - {{stepDescription}}',
    '建议子角色: {{suggestedRoles}}',
    'OpenCode 协作提示: {{coordinationNotes}}',
    '',
    '请完成以下执行指令，并在输出中面向 OpenCode 返回清晰的执行摘要：',
    '{{executionPrompt}}',
    '',
    '输出要求：',
    '1. 明确说明完成了哪些代码修改。',
    '2. 如有验证动作，说明验证结果。',
    '3. 如存在未完成项或风险，直接列出。',
    '4. 输出必须适合回流给 OpenCode 作为后续验收输入。',
  ].join('\n'),
  coordinatorDispatch: [
    '你当前以 Claude Code Coordinator（包工头）的身份运行。',
    '你的唯一职责是：评估当前目标，决定是自己完成任务，还是派发给子代理。',
    '',
    '重要规则：',
    '1. 严禁自行修改代码或调用工具',
    '2. 你只能输出严格的 JSON 指令，不要输出任何其他内容',
    '3. 不要假装有多个角色——你只是决策者',
    '',
    '协作会话: {{sessionId}}',
    '原始需求: {{userPrompt}}',
    '当前步骤: {{stepId}} - {{stepDescription}}',
    'OpenCode 协作提示: {{coordinationNotes}}',
    '',
    '{{executionHistoryBlock}}',
    '',
    '{{memoryBlock}}',
    '',
    '请评估当前状态并决定下一步行动。输出格式要求：',
    '',
    '如果需要派发子任务（单个）：',
    '{"action": "delegate", "role": "角色名", "task_description": "详细任务描述", "context_summary": "可选上下文摘要"}',
    '',
    '如果需要并发派发多个独立子任务（确保任务间无文件冲突）：',
    '{"action": "delegate", "tasks": [{"role": "frontend_coder", "task_description": "..."}, {"role": "backend_coder", "task_description": "..."}]}',
    '',
    '如果所有子任务均已完成，准备提交总结：',
    '{"action": "complete", "summary": "最终执行摘要，适合回流给验收层", "all_tasks_completed": true}',
    '',
    '如果自己完成任务（适用于简单任务）：',
    '{"action": "complete", "summary": "执行摘要", "all_tasks_completed": true}',
    '',
    '你可以在完成时通过 saveMemories 字段保存关键发现，供后续步骤使用：',
    '{"action": "complete", "summary": "...", "all_tasks_completed": true, "saveMemories": [{"key": "发现名", "value": "发现内容"}]}',
    '',
    '只输出上述 JSON 之一，不要输出 Markdown 代码块或任何额外说明。',
  ].join('\n'),
  subAgentTask: [
    '你是 Claude Code 子代理，角色为：{{subAgentRole}}',
    '你收到的任务：{{taskDescription}}',
    '',
    '{{contextSummary}}',
    '',
    '{{memoryBlock}}',
    '',
    '协作会话上下文：{{userPrompt}}',
    '当前步骤：{{stepId}} - {{stepDescription}}',
    '',
    '请严格按照任务描述完成代码修改，并在完成后输出简洁的执行摘要。',
    '摘要必须包含：',
    '1. 完成了哪些代码修改（列出文件路径和关键改动）',
    '2. 是否运行了验证命令及结果',
    '3. 任何未完成项或风险点',
  ].join('\n'),
};

const DEFAULT_WORKFLOW_CONFIG: ExtendedWorkflowRuntimeConfig = {
  claudeEffort: 'max',
  opencodeVariant: 'max',
  budgetCapUsd: null,
  commandTimeoutMs: 10 * 60 * 1000,
  healthTimeoutMs: 15_000,
  opencodeTimeoutMs: 10 * 60 * 1000,
  backoffBaseMs: 2_000,
  backoffMaxMs: 60_000,
  jsonRepairRetries: 3,
  processRetries: 3,
  executionRetries: 3,
  maxRepairAttemptsPerStep: 3,
  maxTotalRepairAttempts: 10,
  passingScore: 9,
  cleanupPeriodDays: 30,
  collaborationEnabled: true,
  maxPlanSteps: 8,
  toolRuntimes: DEFAULT_TOOL_RUNTIME_CONFIGS,
  promptTemplates: DEFAULT_PROMPT_TEMPLATES,
};

let cachedSnapshot: ExtendedWorkflowConfigSnapshot | null = null;
let cachedUserOverride: ExtendedWorkflowRuntimeConfigUpdate | null = null;

const resolveUserConfigPath = (): string =>
  process.env.AI_FSM_CONFIG_PATH ?? path.join(os.homedir(), '.ai-fsm-desktop', 'config.json');

const resolveProjectConfigPath = (): string =>
  process.env.AI_FSM_PROJECT_CONFIG_PATH ?? path.join(process.cwd(), '.ai-fsm-desktop', 'config.json');

const readOptionalTextFile = (filePath: string): string | null => {
  if (!existsSync(filePath)) {
    return null;
  }

  const raw = readFileSync(filePath, 'utf8').trim();
  return raw.length > 0 ? raw : null;
};

const findNearestAncestorFile = (startDir: string, fileNames: string[]): string | null => {
  let currentDir = path.resolve(startDir);

  while (true) {
    for (const fileName of fileNames) {
      const candidate = path.join(currentDir, fileName);

      if (existsSync(candidate)) {
        return candidate;
      }
    }

    const parentDir = path.dirname(currentDir);

    if (parentDir === currentDir) {
      return null;
    }

    currentDir = parentDir;
  }
};

const readImportedOpenCodeConfig = (): string | null => {
  const envConfiguredPath = normalizeOptionalConfigString(process.env.OPENCODE_CONFIG);

  if (envConfiguredPath && existsSync(envConfiguredPath)) {
    return readOptionalTextFile(envConfiguredPath);
  }

  const projectConfigPath = findNearestAncestorFile(process.cwd(), ['opencode.json', 'opencode.jsonc']);

  if (projectConfigPath) {
    return readOptionalTextFile(projectConfigPath);
  }

  for (const candidate of [
    path.join(os.homedir(), '.config', 'opencode', 'opencode.json'),
    path.join(os.homedir(), '.config', 'opencode', 'opencode.jsonc'),
  ]) {
    if (existsSync(candidate)) {
      return readOptionalTextFile(candidate);
    }
  }

  return null;
};

const readImportedClaudeExtraEnv = (): string | null => {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  const raw = readOptionalTextFile(settingsPath);

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as {
      env?: Record<string, unknown>;
      model?: unknown;
    };
    const envEntries: Array<{ key: string; value: string }> = [];

    if (parsed.env && typeof parsed.env === 'object') {
      for (const [key, value] of Object.entries(parsed.env)) {
        if (typeof value === 'undefined' || value === null) {
          continue;
        }

        envEntries.push({ key, value: String(value) });
      }
    }

    const configuredModel = normalizeOptionalConfigString(typeof parsed.model === 'string' ? parsed.model : null);

    if (configuredModel && !envEntries.some((entry) => entry.key === 'ANTHROPIC_MODEL')) {
      envEntries.push({ key: 'ANTHROPIC_MODEL', value: configuredModel });
    }

    return stringifyToolEnvironmentEntries(envEntries);
  } catch {
    return null;
  }
};

const buildImportedUserOverride = (): ExtendedWorkflowRuntimeConfigUpdate | null => {
  const toolRuntimes: Partial<Record<WorkflowToolKind, WorkflowToolRuntimeConfigUpdate>> = {};
  const opencodeConfigContent = readImportedOpenCodeConfig();
  const claudeExtraEnv = readImportedClaudeExtraEnv();

  if (opencodeConfigContent) {
    toolRuntimes.opencode = {
      configContent: opencodeConfigContent,
    };
  }

  if (claudeExtraEnv) {
    toolRuntimes.claude = {
      extraEnv: claudeExtraEnv,
    };
  }

  return Object.keys(toolRuntimes).length > 0 ? { toolRuntimes } : null;
};

const readConfigOverride = (filePath: string): ExtendedWorkflowRuntimeConfigUpdate | null => {
  if (!existsSync(filePath)) {
    return null;
  }

  const raw = readFileSync(filePath, 'utf8').trim();

  if (!raw) {
    return null;
  }

  return workflowRuntimeConfigWithToolsUpdateSchema.parse(JSON.parse(raw)) as ExtendedWorkflowRuntimeConfigUpdate;
};

const resolveUserOverride = (userConfigPath: string): ExtendedWorkflowRuntimeConfigUpdate | null => {
  const existingOverride = readConfigOverride(userConfigPath);

  if (existingOverride) {
    return existingOverride;
  }

  const importedOverride = buildImportedUserOverride();

  if (!importedOverride) {
    return null;
  }

  mkdirSync(path.dirname(userConfigPath), { recursive: true });
  writeFileSync(userConfigPath, `${JSON.stringify(importedOverride, null, 2)}\n`, 'utf8');

  return importedOverride;
};

const mergeToolRuntimeConfig = (
  base: Record<WorkflowToolKind, WorkflowToolRuntimeConfig>,
  update?: Partial<Record<WorkflowToolKind, WorkflowToolRuntimeConfigUpdate>>,
): Record<WorkflowToolKind, WorkflowToolRuntimeConfig> => ({
  opencode: {
    ...base.opencode,
    ...(update?.opencode ?? {}),
  },
  claude: {
    ...base.claude,
    ...(update?.claude ?? {}),
  },
});

const mergeConfig = (
  base: ExtendedWorkflowRuntimeConfig,
  update?: ExtendedWorkflowRuntimeConfigUpdate | null,
): ExtendedWorkflowRuntimeConfig => {
  if (!update) {
    return base;
  }

  return workflowRuntimeConfigWithToolsSchema.parse({
    ...base,
    ...update,
    maxRepairAttemptsPerStep: update.maxRepairAttemptsPerStep ?? base.maxRepairAttemptsPerStep,
    maxTotalRepairAttempts: update.maxTotalRepairAttempts ?? base.maxTotalRepairAttempts,
    passingScore: update.passingScore ?? base.passingScore,
    cleanupPeriodDays: update.cleanupPeriodDays ?? base.cleanupPeriodDays,
    maxPlanSteps: update.maxPlanSteps ?? base.maxPlanSteps,
    toolRuntimes: mergeToolRuntimeConfig(base.toolRuntimes, update.toolRuntimes),
    promptTemplates: {
      ...base.promptTemplates,
      ...(update.promptTemplates ?? {}),
    },
  }) as ExtendedWorkflowRuntimeConfig;
};

const mergeConfigUpdate = (
  base: ExtendedWorkflowRuntimeConfigUpdate | null | undefined,
  update: ExtendedWorkflowRuntimeConfigUpdate,
): ExtendedWorkflowRuntimeConfigUpdate => ({
  ...(base ?? {}),
  ...update,
  toolRuntimes: {
    opencode: {
      ...((base?.toolRuntimes?.opencode ?? {}) as WorkflowToolRuntimeConfigUpdate),
      ...((update.toolRuntimes?.opencode ?? {}) as WorkflowToolRuntimeConfigUpdate),
    },
    claude: {
      ...((base?.toolRuntimes?.claude ?? {}) as WorkflowToolRuntimeConfigUpdate),
      ...((update.toolRuntimes?.claude ?? {}) as WorkflowToolRuntimeConfigUpdate),
    },
  },
  promptTemplates: {
    ...((base?.promptTemplates ?? {}) as Partial<WorkflowPromptTemplates>),
    ...((update.promptTemplates ?? {}) as Partial<WorkflowPromptTemplates>),
  },
});

const buildEnvOverrides = (): { update: ExtendedWorkflowRuntimeConfigUpdate; keys: string[] } => {
  const keys: string[] = [];
  const update: ExtendedWorkflowRuntimeConfigUpdate = {};
  const assignNumber = (
    key: string,
    field: keyof Omit<ExtendedWorkflowRuntimeConfigUpdate, 'promptTemplates' | 'collaborationEnabled' | 'toolRuntimes'>,
  ): void => {
    const raw = process.env[key];

    if (typeof raw === 'undefined') {
      return;
    }

    const parsed = Number(raw);

    if (!Number.isFinite(parsed) || parsed <= 0) {
      return;
    }

    keys.push(key);
    update[field] = parsed as never;
  };

  const assignEnum = <T extends ClaudeExecutionEffort | OpencodeVariant>(
    key: string,
    allowed: readonly T[],
    field: keyof Pick<ExtendedWorkflowRuntimeConfigUpdate, 'claudeEffort' | 'opencodeVariant'>,
  ): void => {
    const raw = process.env[key]?.trim().toLowerCase();

    if (!raw || !allowed.includes(raw as T)) {
      return;
    }

    keys.push(key);
    update[field] = raw as never;
  };

  assignNumber('AI_FSM_COMMAND_TIMEOUT_MS', 'commandTimeoutMs');
  assignNumber('AI_FSM_HEALTH_TIMEOUT_MS', 'healthTimeoutMs');
  assignNumber('AI_FSM_OPENCODE_TIMEOUT_MS', 'opencodeTimeoutMs');
  assignNumber('AI_FSM_BACKOFF_BASE_MS', 'backoffBaseMs');
  assignNumber('AI_FSM_BACKOFF_MAX_MS', 'backoffMaxMs');
  assignNumber('AI_FSM_JSON_REPAIR_RETRIES', 'jsonRepairRetries');
  assignNumber('AI_FSM_PROCESS_RETRIES', 'processRetries');
  assignNumber('AI_FSM_EXECUTION_RETRIES', 'executionRetries');
  assignEnum('AI_FSM_CLAUDE_EFFORT', ['low', 'medium', 'high', 'max'], 'claudeEffort');
  assignEnum('AI_FSM_OPENCODE_VARIANT', ['low', 'medium', 'high', 'max'], 'opencodeVariant');

  if (typeof process.env.AI_FSM_BUDGET_CAP_USD !== 'undefined') {
    const raw = process.env.AI_FSM_BUDGET_CAP_USD.trim().toLowerCase();

    if (raw === '' || raw === 'null' || raw === 'none') {
      keys.push('AI_FSM_BUDGET_CAP_USD');
      update.budgetCapUsd = null;
    } else {
      const parsed = Number(raw);

      if (Number.isFinite(parsed) && parsed > 0) {
        keys.push('AI_FSM_BUDGET_CAP_USD');
        update.budgetCapUsd = parsed;
      }
    }
  }

  if (typeof process.env.AI_FSM_COLLABORATION_ENABLED !== 'undefined') {
    keys.push('AI_FSM_COLLABORATION_ENABLED');
    update.collaborationEnabled = process.env.AI_FSM_COLLABORATION_ENABLED !== '0';
  }

  const assignToolRuntimeString = (
    key: string,
    tool: WorkflowToolKind,
    field: keyof WorkflowToolRuntimeConfigUpdate,
  ): void => {
    const raw = process.env[key];

    if (typeof raw === 'undefined') {
      return;
    }

    keys.push(key);
    update.toolRuntimes = update.toolRuntimes ?? {};
    update.toolRuntimes[tool] = {
      ...(update.toolRuntimes[tool] ?? {}),
      [field]: raw.trim() || null,
    };
  };

  assignToolRuntimeString('AI_FSM_OPENCODE_CLI_PATH', 'opencode', 'cliPath');
  assignToolRuntimeString('AI_FSM_OPENCODE_API_KEY', 'opencode', 'apiKey');
  assignToolRuntimeString('AI_FSM_OPENCODE_API_KEY_ENV_NAME', 'opencode', 'apiKeyEnvName');
  assignToolRuntimeString('AI_FSM_OPENCODE_CONFIG_CONTENT', 'opencode', 'configContent');
  assignToolRuntimeString('AI_FSM_OPENCODE_EXTRA_ENV', 'opencode', 'extraEnv');
  assignToolRuntimeString('AI_FSM_CLAUDE_CLI_PATH', 'claude', 'cliPath');
  assignToolRuntimeString('AI_FSM_CLAUDE_API_KEY', 'claude', 'apiKey');
  assignToolRuntimeString('AI_FSM_CLAUDE_API_KEY_ENV_NAME', 'claude', 'apiKeyEnvName');
  assignToolRuntimeString('AI_FSM_CLAUDE_EXTRA_ENV', 'claude', 'extraEnv');

  return {
    update,
    keys,
  };
};

const loadConfigSnapshot = (): ExtendedWorkflowConfigSnapshot => {
  const userConfigPath = resolveUserConfigPath();
  const projectConfigPath = resolveProjectConfigPath();
  const projectOverride = readConfigOverride(projectConfigPath);
  const userOverride = resolveUserOverride(userConfigPath);
  const envOverrides = buildEnvOverrides();

  cachedUserOverride = userOverride;

  const config = mergeConfig(
    mergeConfig(mergeConfig(DEFAULT_WORKFLOW_CONFIG, projectOverride), userOverride),
    envOverrides.update,
  );

  cachedSnapshot = withToolRuntimeSnapshot({
    config,
    sources: {
      userConfigPath,
      projectConfigPath,
      loadedFromUserConfig: Boolean(userOverride),
      loadedFromProjectConfig: Boolean(projectOverride),
      envOverrides: envOverrides.keys,
      updatedAt: new Date().toISOString(),
    },
  });

  return cachedSnapshot;
};

export const getWorkflowConfigSnapshot = (): ExtendedWorkflowConfigSnapshot => cachedSnapshot ?? loadConfigSnapshot();

export const getWorkflowConfig = (): ExtendedWorkflowRuntimeConfig => getWorkflowConfigSnapshot().config;

export const reloadWorkflowConfig = (): ExtendedWorkflowConfigSnapshot => loadConfigSnapshot();

export const updateWorkflowConfig = (update: ExtendedWorkflowRuntimeConfigUpdate): ExtendedWorkflowConfigSnapshot => {
  const parsedUpdate = workflowRuntimeConfigWithToolsUpdateSchema.parse(update) as ExtendedWorkflowRuntimeConfigUpdate;
  const nextUserOverride = mergeConfigUpdate(cachedUserOverride ?? readConfigOverride(resolveUserConfigPath()), parsedUpdate);
  const userConfigPath = resolveUserConfigPath();

  mkdirSync(path.dirname(userConfigPath), { recursive: true });
  writeFileSync(userConfigPath, `${JSON.stringify(nextUserOverride, null, 2)}\n`, 'utf8');

  cachedSnapshot = null;
  cachedUserOverride = nextUserOverride;
  return loadConfigSnapshot();
};

export const renderPromptTemplate = (template: string, variables: Record<string, string>): string =>
  template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/gu, (_match, key: string) => variables[key] ?? '');

export const getDefaultWorkflowConfig = (): ExtendedWorkflowRuntimeConfig => DEFAULT_WORKFLOW_CONFIG;