import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { app, shell } from 'electron';

const SHORTCUT_NAME = 'AI FSM Desktop.lnk';
const SHORTCUT_DESCRIPTION = 'AI FSM Desktop';

export const APP_USER_MODEL_ID = 'GitHubCopilot.AiFsmDesktop';

const getStartMenuProgramsDir = (): string | null => {
  const appData = process.env.APPDATA;
  return appData ? path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs') : null;
};

const getPinnedTaskbarDir = (): string | null => {
  const appData = process.env.APPDATA;
  return appData ? path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar') : null;
};

const getShortcutPaths = (): string[] => {
  const candidates = new Set<string>();
  try { candidates.add(path.join(app.getPath('desktop'), SHORTCUT_NAME)); } catch {}
  const startMenu = getStartMenuProgramsDir();
  if (startMenu) candidates.add(path.join(startMenu, SHORTCUT_NAME));
  const taskbar = getPinnedTaskbarDir();
  if (taskbar) candidates.add(path.join(taskbar, SHORTCUT_NAME));
  return [...candidates];
};

export const ensureWindowsShortcuts = (): void => {
  if (process.platform !== 'win32' || !app.isPackaged) return;

  const executablePath = process.execPath;
  const details: Electron.ShortcutDetails = {
    target: executablePath,
    cwd: path.dirname(executablePath),
    description: SHORTCUT_DESCRIPTION,
    icon: executablePath,
    iconIndex: 0,
    appUserModelId: APP_USER_MODEL_ID,
  };

  for (const shortcutPath of getShortcutPaths()) {
    const isTaskbar = shortcutPath.includes(path.join('User Pinned', 'TaskBar'));
    if (isTaskbar && !existsSync(shortcutPath)) continue;
    if (!isTaskbar) mkdirSync(path.dirname(shortcutPath), { recursive: true });
    shell.writeShortcutLink(shortcutPath, 'replace', details);
  }
};
