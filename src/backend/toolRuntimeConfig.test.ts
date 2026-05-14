import { describe, expect, it } from 'vitest';
import {
  buildToolEnvironment,
  buildToolLaunchSpec,
  resolveToolApiKeyEnvName,
  resolveToolCommandBin,
} from './toolRuntimeConfig';
import type { ExtendedWorkflowRuntimeConfig } from '../shared/toolRuntimeConfig';

const createConfig = (overrides?: Partial<ExtendedWorkflowRuntimeConfig>): ExtendedWorkflowRuntimeConfig => ({
  claudeEffort: 'medium',
  opencodeVariant: 'medium',
  budgetCapUsd: null,
  commandTimeoutMs: 60_000,
  healthTimeoutMs: 15_000,
  opencodeTimeoutMs: 60_000,
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
  toolRuntimes: {
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
  },
  promptTemplates: {
    planningInitial: 'a',
    planningStep: 'b',
    verification: 'c',
    fallbackExecution: 'd',
    repair: 'e',
    coordinatorExecution: 'f',
    coordinatorDispatch: 'g',
    subAgentTask: 'h',
  },
  ...overrides,
});

describe('toolRuntimeConfig', () => {
  it('falls back to default binaries when no custom CLI path is configured', () => {
    const config = createConfig();

    expect(resolveToolCommandBin('opencode', config)).toBe('opencode');
    expect(resolveToolCommandBin('claude', config)).toBe('claude');
  });

  it('prefers configured CLI paths', () => {
    const config = createConfig({
      toolRuntimes: {
        opencode: {
          cliPath: 'C:/tools/opencode.exe',
          apiKey: null,
          apiKeyEnvName: 'OPENCODE_API_KEY',
          configContent: null,
          extraEnv: null,
        },
        claude: {
          cliPath: 'C:/tools/claude.exe',
          apiKey: null,
          apiKeyEnvName: 'ANTHROPIC_API_KEY',
          configContent: null,
          extraEnv: null,
        },
      },
    });

    expect(resolveToolCommandBin('opencode', config)).toBe('C:/tools/opencode.exe');
    expect(resolveToolCommandBin('claude', config)).toBe('C:/tools/claude.exe');
  });

  it('injects the API key into the configured environment variable name', () => {
    const config = createConfig({
      toolRuntimes: {
        opencode: {
          cliPath: null,
          apiKey: 'open-key',
          apiKeyEnvName: 'OPENCODE_TOKEN',
          configContent: null,
          extraEnv: null,
        },
        claude: {
          cliPath: null,
          apiKey: 'claude-key',
          apiKeyEnvName: 'CLAUDE_TOKEN',
          configContent: null,
          extraEnv: null,
        },
      },
    });

    expect(resolveToolApiKeyEnvName('opencode', config)).toBe('OPENCODE_TOKEN');
    expect(resolveToolApiKeyEnvName('claude', config)).toBe('CLAUDE_TOKEN');
    expect(buildToolEnvironment('opencode', config)).toEqual({ OPENCODE_TOKEN: 'open-key' });
    expect(buildToolEnvironment('claude', config)).toEqual({ CLAUDE_TOKEN: 'claude-key' });
  });

  it('omits environment overrides when no API key is configured', () => {
    const config = createConfig();

    expect(buildToolEnvironment('opencode', config)).toBeUndefined();
    expect(buildToolLaunchSpec('claude', config)).toEqual({ bin: 'claude' });
  });

  it('merges extra environment variables and OpenCode config content into launch env', () => {
    const config = createConfig({
      toolRuntimes: {
        opencode: {
          cliPath: null,
          apiKey: null,
          apiKeyEnvName: 'OPENCODE_API_KEY',
          configContent: '{"model":"mimo/mimo-v2.5-pro"}',
          extraEnv: 'OPENAI_API_KEY=open-router-key\nHTTP_PROXY=http://127.0.0.1:7890',
        },
        claude: {
          cliPath: null,
          apiKey: null,
          apiKeyEnvName: 'ANTHROPIC_API_KEY',
          configContent: null,
          extraEnv: 'ANTHROPIC_BASE_URL=https://api.example.com/anthropic\nANTHROPIC_MODEL=MiniMax-M2.7',
        },
      },
    });

    expect(buildToolEnvironment('opencode', config)).toEqual({
      OPENAI_API_KEY: 'open-router-key',
      HTTP_PROXY: 'http://127.0.0.1:7890',
      OPENCODE_CONFIG_CONTENT: '{"model":"mimo/mimo-v2.5-pro"}',
    });
    expect(buildToolLaunchSpec('claude', config)).toEqual({
      bin: 'claude',
      env: {
        ANTHROPIC_BASE_URL: 'https://api.example.com/anthropic',
        ANTHROPIC_MODEL: 'MiniMax-M2.7',
      },
    });
  });
});