import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reloadWorkflowConfig } from './configManager';

describe('configManager import bootstrap', () => {
  const originalCwd = process.cwd();
  const originalConfigPath = process.env.AI_FSM_CONFIG_PATH;
  const originalProjectConfigPath = process.env.AI_FSM_PROJECT_CONFIG_PATH;
  let tempRoot: string | null = null;

  afterEach(() => {
    process.chdir(originalCwd);

    if (typeof originalConfigPath === 'undefined') {
      delete process.env.AI_FSM_CONFIG_PATH;
    } else {
      process.env.AI_FSM_CONFIG_PATH = originalConfigPath;
    }

    if (typeof originalProjectConfigPath === 'undefined') {
      delete process.env.AI_FSM_PROJECT_CONFIG_PATH;
    } else {
      process.env.AI_FSM_PROJECT_CONFIG_PATH = originalProjectConfigPath;
    }

    vi.restoreAllMocks();

    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it('imports existing OpenCode and Claude settings when app config is missing', () => {
    tempRoot = mkdtempSync(path.join(os.tmpdir(), 'ai-fsm-config-'));

    const homeDir = path.join(tempRoot, 'home');
    const workspaceDir = path.join(tempRoot, 'workspace');
    const projectDir = path.join(workspaceDir, 'project');
    const userConfigPath = path.join(homeDir, '.ai-fsm-desktop', 'config.json');
    const opencodeConfig = '{\n  "model": "mimo/mimo-v2.5-pro"\n}\n';

    mkdirSync(path.join(homeDir, '.claude'), { recursive: true });
    mkdirSync(projectDir, { recursive: true });

    writeFileSync(path.join(workspaceDir, 'opencode.json'), opencodeConfig, 'utf8');
    writeFileSync(
      path.join(homeDir, '.claude', 'settings.json'),
      `${JSON.stringify(
        {
          env: {
            ANTHROPIC_BASE_URL: 'https://api.example.com/anthropic',
            ANTHROPIC_MODEL: 'MiniMax-M2.7',
            CLAUDE_CODE_SUBAGENT_MODEL: 'MiniMax-M2.7',
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    process.env.AI_FSM_CONFIG_PATH = userConfigPath;
    process.env.AI_FSM_PROJECT_CONFIG_PATH = path.join(projectDir, '.ai-fsm-desktop', 'config.json');
    process.chdir(projectDir);
    vi.spyOn(os, 'homedir').mockReturnValue(homeDir);

    const snapshot = reloadWorkflowConfig();

    expect(snapshot.config.toolRuntimes.opencode.configContent).toBe(opencodeConfig.trim());
    expect(snapshot.config.toolRuntimes.claude.extraEnv).toContain('ANTHROPIC_BASE_URL=https://api.example.com/anthropic');
    expect(snapshot.config.toolRuntimes.claude.extraEnv).toContain('ANTHROPIC_MODEL=MiniMax-M2.7');
    expect(existsSync(userConfigPath)).toBe(true);

    const savedConfig = JSON.parse(readFileSync(userConfigPath, 'utf8')) as {
      toolRuntimes?: {
        opencode?: { configContent?: string | null };
        claude?: { extraEnv?: string | null };
      };
    };

    expect(savedConfig.toolRuntimes?.opencode?.configContent).toBe(opencodeConfig.trim());
    expect(savedConfig.toolRuntimes?.claude?.extraEnv).toContain('CLAUDE_CODE_SUBAGENT_MODEL=MiniMax-M2.7');
  });
});