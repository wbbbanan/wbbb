import { existsSync, readdirSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RuntimeHealthCheck, RuntimeHealthSnapshot, RuntimeHealthStatus } from '../shared/ipc';
import { getWorkflowConfigSnapshot } from './configManager';
import { runCommand } from './processRunner';
import { buildToolLaunchSpec, resolveToolApiKeyEnvName } from './toolRuntimeConfig';
import {
  normalizeOptionalConfigString,
  parseToolEnvironmentEntries,
  type ExtendedWorkflowRuntimeConfig,
  type WorkflowToolKind,
} from '../shared/toolRuntimeConfig';

const OPENCODE_ENV_KEYS = ['OPENCODE_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'];
const CLAUDE_ENV_KEYS = ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'];

const toLines = (value: string): string[] =>
  value
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter(Boolean);

const listDirectoryEntries = (dirPath: string, limit = 8): string[] => {
  if (!existsSync(dirPath)) {
    return [];
  }

  return readdirSync(dirPath, { withFileTypes: true })
    .slice(0, limit)
    .map((entry) => `${entry.name}${entry.isDirectory() ? '/' : ''}`);
};

const getConfiguredExtraEnvKeys = (value: string | null | undefined): string[] => {
  try {
    return parseToolEnvironmentEntries(value).map((entry) => entry.key);
  } catch {
    return [];
  }
};

const looksLikeCommandPath = (command: string): boolean => command.includes('/') || command.includes('\\') || path.isAbsolute(command);

const resolveCommandPaths = async (command: string): Promise<string[]> => {
  if (looksLikeCommandPath(command)) {
    return existsSync(command) ? [command] : [];
  }

  const locator = process.platform === 'win32' ? 'where' : 'which';
  const result = await runCommand({
    bin: locator,
    args: [command],
    timeoutMs: getWorkflowConfigSnapshot().config.healthTimeoutMs,
  });

  return toLines(result.stdout);
};

const runVersionCheck = async (command: string): Promise<string> => {
  const result = await runCommand({
    bin: command,
    args: ['--version'],
    timeoutMs: getWorkflowConfigSnapshot().config.healthTimeoutMs,
  });

  const lines = toLines(`${result.stdout}\n${result.stderr}`);
  return lines[0] ?? 'version output unavailable';
};

const createCommandCheck = async (
  id: string,
  label: string,
  tool: WorkflowToolKind,
  config: ExtendedWorkflowRuntimeConfig,
): Promise<RuntimeHealthCheck> => {
  const launch = buildToolLaunchSpec(tool, config);
  const configuredCliPath = normalizeOptionalConfigString(config.toolRuntimes[tool].cliPath);

  try {
    const [paths, version] = await Promise.all([resolveCommandPaths(launch.bin), runVersionCheck(launch.bin)]);

    return {
      id,
      label,
      status: 'healthy',
      summary: `${label} 可执行，版本检查通过。`,
      details: [
        `command: ${launch.bin}`,
        `version: ${version}`,
        `cli-source: ${configuredCliPath ? 'app-config' : 'path-default'}`,
        ...(configuredCliPath ? [`configured-cli: ${configuredCliPath}`] : []),
        ...(paths.length > 0 ? [`path: ${paths[0]}`, ...paths.slice(1).map((item) => `alt-path: ${item}`)] : []),
      ],
    };
  } catch (error) {
    return {
      id,
      label,
      status: 'error',
      summary: `${label} 不可用或无法执行。`,
      details: [
        `command: ${launch.bin}`,
        `cli-source: ${configuredCliPath ? 'app-config' : 'path-default'}`,
        ...(configuredCliPath ? [`configured-cli: ${configuredCliPath}`] : []),
        error instanceof Error ? error.message : String(error),
      ],
    };
  }
};

const createOpenCodeApiCheck = (config: ExtendedWorkflowRuntimeConfig): RuntimeHealthCheck => {
  const configuredApiKey = normalizeOptionalConfigString(config.toolRuntimes.opencode.apiKey);
  const configuredConfigContent = normalizeOptionalConfigString(config.toolRuntimes.opencode.configContent);
  const configuredExtraEnvKeys = getConfiguredExtraEnvKeys(config.toolRuntimes.opencode.extraEnv);
  const configuredEnvName = resolveToolApiKeyEnvName('opencode', config);
  const envKeysToCheck = [...new Set([configuredEnvName, ...OPENCODE_ENV_KEYS])];
  const presentEnvKeys = envKeysToCheck.filter((name) => Boolean(process.env[name]));
  const homeDir = os.homedir();
  const configDirs = [path.join(homeDir, '.opencode'), path.join(homeDir, '.config', 'opencode')].filter((dirPath) => existsSync(dirPath));
  const configEntries = configDirs.flatMap((dirPath) => listDirectoryEntries(dirPath).map((entry) => `${dirPath}: ${entry}`));

  if (configuredApiKey || configuredConfigContent || configuredExtraEnvKeys.length > 0) {
    return {
      id: 'opencode-api',
      label: 'OpenCode API',
      status: 'healthy',
      summary: '检测到应用配置中的 OpenCode 第三方模型/鉴权设置。',
      details: [
        `env-target: ${configuredEnvName}`,
        ...(configuredApiKey ? ['api-key-source: app-config'] : []),
        ...(configuredConfigContent ? ['config-content: app-config'] : []),
        ...(configuredExtraEnvKeys.length > 0 ? [`extra-env: ${configuredExtraEnvKeys.join(', ')}`] : []),
        ...configDirs.map((dirPath) => `config-dir: ${dirPath}`),
        ...configEntries.slice(0, 6),
      ],
    };
  }

  if (presentEnvKeys.length > 0) {
    return {
      id: 'opencode-api',
      label: 'OpenCode API',
      status: 'healthy',
      summary: '检测到可供 OpenCode 使用的模型/API 环境变量。',
      details: [`env: ${presentEnvKeys.join(', ')}`, `env-target: ${configuredEnvName}`, ...configDirs.map((dirPath) => `config-dir: ${dirPath}`), ...configEntries.slice(0, 6)],
    };
  }

  if (configDirs.length > 0) {
    return {
      id: 'opencode-api',
      label: 'OpenCode API',
      status: 'warning',
      summary: '发现 OpenCode 本地配置目录，但当前进程未见常见 API 环境变量。',
      details: [...configDirs.map((dirPath) => `config-dir: ${dirPath}`), ...configEntries.slice(0, 6)],
    };
  }

  return {
    id: 'opencode-api',
    label: 'OpenCode API',
    status: 'error',
    summary: '未检测到 OpenCode API 环境变量，也未发现本地配置目录。',
    details: [`checked-env: ${envKeysToCheck.join(', ')}`],
  };
};

const createClaudeAuthCheck = (config: ExtendedWorkflowRuntimeConfig): RuntimeHealthCheck => {
  const configuredApiKey = normalizeOptionalConfigString(config.toolRuntimes.claude.apiKey);
  const configuredExtraEnvKeys = getConfiguredExtraEnvKeys(config.toolRuntimes.claude.extraEnv);
  const configuredEnvName = resolveToolApiKeyEnvName('claude', config);
  const envKeysToCheck = [...new Set([configuredEnvName, ...CLAUDE_ENV_KEYS])];
  const presentEnvKeys = envKeysToCheck.filter((name) => Boolean(process.env[name]));
  const claudeDir = path.join(os.homedir(), '.claude');
  const entries = listDirectoryEntries(claudeDir);

  if (configuredApiKey || configuredExtraEnvKeys.length > 0) {
    return {
      id: 'claude-auth',
      label: 'Claude 鉴权',
      status: 'healthy',
      summary: '检测到应用配置中的 Claude 第三方模型/鉴权设置。',
      details: [
        `env-target: ${configuredEnvName}`,
        ...(configuredApiKey ? ['api-key-source: app-config'] : []),
        ...(configuredExtraEnvKeys.length > 0 ? [`extra-env: ${configuredExtraEnvKeys.join(', ')}`] : []),
      ],
    };
  }

  if (presentEnvKeys.length > 0) {
    return {
      id: 'claude-auth',
      label: 'Claude 鉴权',
      status: 'healthy',
      summary: '检测到 Claude 相关环境变量。',
      details: [`env: ${presentEnvKeys.join(', ')}`, `env-target: ${configuredEnvName}`],
    };
  }

  if (entries.length > 0) {
    return {
      id: 'claude-auth',
      label: 'Claude 鉴权',
      status: 'healthy',
      summary: '检测到 Claude 本地配置/登录痕迹。',
      details: [`config-dir: ${claudeDir}`, ...entries.map((entry) => `entry: ${entry}`)],
    };
  }

  if (existsSync(claudeDir)) {
    return {
      id: 'claude-auth',
      label: 'Claude 鉴权',
      status: 'warning',
      summary: 'Claude 配置目录存在，但未发现可见配置项。',
      details: [`config-dir: ${claudeDir}`, `checked-env: ${envKeysToCheck.join(', ')}`],
    };
  }

  return {
    id: 'claude-auth',
    label: 'Claude 鉴权',
    status: 'error',
    summary: '未检测到 Claude 环境变量或本地登录配置。',
    details: [`expected-dir: ${claudeDir}`, `checked-env: ${envKeysToCheck.join(', ')}`],
  };
};

const createConfigCheck = (): RuntimeHealthCheck => {
  const snapshot = getWorkflowConfigSnapshot();
  const opencodeCli = normalizeOptionalConfigString(snapshot.config.toolRuntimes.opencode.cliPath) ?? 'PATH: opencode';
  const claudeCli = normalizeOptionalConfigString(snapshot.config.toolRuntimes.claude.cliPath) ?? 'PATH: claude';
  const opencodeEnv = resolveToolApiKeyEnvName('opencode', snapshot.config);
  const claudeEnv = resolveToolApiKeyEnvName('claude', snapshot.config);
  const opencodeExtraEnvKeys = getConfiguredExtraEnvKeys(snapshot.config.toolRuntimes.opencode.extraEnv);
  const claudeExtraEnvKeys = getConfiguredExtraEnvKeys(snapshot.config.toolRuntimes.claude.extraEnv);
  const opencodeConfigContent = normalizeOptionalConfigString(snapshot.config.toolRuntimes.opencode.configContent);

  return {
    id: 'runtime-config',
    label: '运行配置',
    status: snapshot.sources.envOverrides.length > 0 ? 'warning' : 'healthy',
    summary:
      snapshot.sources.envOverrides.length > 0
        ? '当前存在环境变量覆盖，运行参数可能与本地配置文件不同。'
        : '当前运行参数已从默认值和本地配置成功解析。',
    details: [
      `user-config: ${snapshot.sources.userConfigPath}`,
      `project-config: ${snapshot.sources.projectConfigPath}`,
      `loaded-user: ${snapshot.sources.loadedFromUserConfig}`,
      `loaded-project: ${snapshot.sources.loadedFromProjectConfig}`,
      `env-overrides: ${snapshot.sources.envOverrides.length > 0 ? snapshot.sources.envOverrides.join(', ') : 'none'}`,
      `command-timeout-ms: ${snapshot.config.commandTimeoutMs}`,
      `opencode-timeout-ms: ${snapshot.config.opencodeTimeoutMs}`,
      `execution-retries: ${snapshot.config.executionRetries}`,
      `opencode-cli: ${opencodeCli}`,
      `opencode-api-env: ${opencodeEnv}`,
      `opencode-config-content: ${opencodeConfigContent ? 'configured' : 'none'}`,
      `opencode-extra-env: ${opencodeExtraEnvKeys.length > 0 ? opencodeExtraEnvKeys.join(', ') : 'none'}`,
      `claude-cli: ${claudeCli}`,
      `claude-api-env: ${claudeEnv}`,
      `claude-extra-env: ${claudeExtraEnvKeys.length > 0 ? claudeExtraEnvKeys.join(', ') : 'none'}`,
    ],
  };
};

const createNodePtyCheck = (): RuntimeHealthCheck => {
  const candidates = [
    typeof process.resourcesPath === 'string'
      ? path.join(process.resourcesPath, 'node-pty-runtime', 'lib', 'index.js')
      : null,
    path.resolve(process.cwd(), 'node_modules', 'node-pty', 'lib', 'index.js'),
  ].filter((candidate): candidate is string => typeof candidate === 'string');

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return {
        id: 'node-pty',
        label: 'node-pty',
        status: 'healthy',
        summary: 'node-pty 运行时已定位。',
        details: [`path: ${candidate}`],
      };
    }
  }

  return {
    id: 'node-pty',
    label: 'node-pty',
    status: 'error',
    summary: 'node-pty 运行时未找到，PTY 进程管理将不可用。',
    details: [`checked: ${candidates.join(', ')}`],
  };
};

const createWorkspaceCheck = (workspaceDir: string): RuntimeHealthCheck => {
  const testDir = path.join(workspaceDir, '.health-probe');

  try {
    mkdirSync(testDir, { recursive: true });
    const testFile = path.join(testDir, 'probe.txt');
    writeFileSync(testFile, 'ok', 'utf8');
    rmSync(testDir, { recursive: true, force: true });

    return {
      id: 'workspace-writable',
      label: '工作目录可写',
      status: 'healthy',
      summary: '工作目录可正常读写。',
      details: [`path: ${workspaceDir}`],
    };
  } catch (error) {
    return {
      id: 'workspace-writable',
      label: '工作目录可写',
      status: 'error',
      summary: '工作目录无法写入，session 持久化可能失败。',
      details: [`path: ${workspaceDir}`, error instanceof Error ? error.message : String(error)],
    };
  }
};

const summarizeOverallStatus = (checks: RuntimeHealthCheck[]): RuntimeHealthStatus => {
  if (checks.some((check) => check.status === 'error')) {
    return 'error';
  }

  if (checks.some((check) => check.status === 'warning')) {
    return 'warning';
  }

  return 'healthy';
};

export const getRuntimeHealthSnapshot = async (workspaceDir?: string): Promise<RuntimeHealthSnapshot> => {
  const config = getWorkflowConfigSnapshot().config;
  const checks = await Promise.all([
    createCommandCheck('opencode-cli', 'OpenCode CLI', 'opencode', config),
    Promise.resolve(createOpenCodeApiCheck(config)),
    createCommandCheck('claude-cli', 'Claude CLI', 'claude', config),
    Promise.resolve(createClaudeAuthCheck(config)),
    Promise.resolve(createConfigCheck()),
    Promise.resolve(createNodePtyCheck()),
    Promise.resolve(createWorkspaceCheck(workspaceDir ?? path.join(os.homedir(), '.ai-fsm-desktop'))),
  ]);

  return {
    checkedAt: new Date().toISOString(),
    overallStatus: summarizeOverallStatus(checks),
    checks,
  };
};