import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron';
import type {
  RuntimeHealthSnapshot,
  WorkflowConfigSnapshot,
  WorkflowEventEnvelope,
  WorkflowExportFormat,
  WorkflowExportPayload,
  WorkflowQueueSnapshot,
  WorkflowRuntimeConfigUpdate,
  WorkflowSessionRecord,
  WorkflowSessionSummary,
  WorkflowSnapshot,
} from './shared/ipc';
import { getWorkflowConfigSnapshot, updateWorkflowConfig } from './backend/configManager';
import { registerCleanup, runAllCleanups } from './backend/cleanupRegistry';
import { killAllTrackedProcesses } from './backend/processRunner';
import { getRuntimeHealthSnapshot } from './backend/runtimeHealth';
import { WorkflowManager } from './backend/workflowManager';
import { APP_USER_MODEL_ID, ensureWindowsShortcuts } from './windowsShortcutManager';

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

let mainWindow: BrowserWindow | null = null;
let workflowManager: WorkflowManager | null = null;

app.setAppUserModelId(APP_USER_MODEL_ID);

const devDiagnosticsEnabled = !app.isPackaged && process.env.AI_FSM_DEV_DIAGNOSTICS === '1';

const getDevDiagnosticsPath = (): string => path.join(app.getPath('userData'), 'electron-dev-diagnostics.log');

const formatDevDiagnostic = (details: unknown): string => {
  if (typeof details === 'undefined') {
    return '';
  }

  if (details instanceof Error) {
    return JSON.stringify({
      message: details.message,
      name: details.name,
      stack: details.stack,
    });
  }

  if (typeof details === 'string') {
    return details;
  }

  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
};

const writeDevDiagnostic = (message: string, details?: unknown): void => {
  if (!devDiagnosticsEnabled) {
    return;
  }

  const suffix = typeof details === 'undefined' ? '' : ` ${formatDevDiagnostic(details)}`;
  appendFileSync(getDevDiagnosticsPath(), `[${new Date().toISOString()}] ${message}${suffix}\n`);
};

const registerDevWindowDiagnostics = (window: BrowserWindow): void => {
  if (app.isPackaged) {
    return;
  }

  writeDevDiagnostic('creating BrowserWindow', {
    entry: MAIN_WINDOW_WEBPACK_ENTRY,
    preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
  });

  window.webContents.on('console-message', (details) => {
    writeDevDiagnostic(`renderer:${details.level}`, {
      line: details.lineNumber,
      message: details.message,
      sourceId: details.sourceId,
    });
  });

  window.webContents.on('dom-ready', () => {
    writeDevDiagnostic('renderer dom-ready');
  });

  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    writeDevDiagnostic('renderer did-fail-load', {
      errorCode,
      errorDescription,
      isMainFrame,
      validatedURL,
    });
  });

  window.webContents.on('did-finish-load', () => {
    writeDevDiagnostic('renderer did-finish-load');

    void window.webContents
      .executeJavaScript(
        `(async () => {
          const bridge = window.agentFlow;
          const snapshot = typeof bridge?.getSnapshot === 'function'
            ? await bridge.getSnapshot()
            : null;

          return JSON.stringify({
            href: window.location.href,
            hasAgentFlow: typeof bridge !== 'undefined',
            agentFlowType: typeof bridge,
            canGetSnapshot: typeof bridge?.getSnapshot === 'function',
            snapshotLifecycle: snapshot?.lifecycle ?? null,
            snapshotPhase: snapshot?.currentPhase ?? null,
          });
        })()`,
        true,
      )
      .then((probeResult) => {
        writeDevDiagnostic('bridge probe', probeResult);
      })
      .catch((error: unknown) => {
        writeDevDiagnostic('bridge probe failed', error);
      });
  });
};

const createWindow = (): void => {
  const version = app.getVersion();
  const title = `AI FSM Desktop v${version}`;

  mainWindow = new BrowserWindow({
    width: 1_680,
    height: 980,
    minWidth: 1_280,
    minHeight: 800,
    title,
    backgroundColor: '#14110f',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  registerDevWindowDiagnostics(mainWindow);

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  void mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
};

const getWorkflowManager = (): WorkflowManager => {
  if (!workflowManager) {
    workflowManager = new WorkflowManager(app.getPath('userData'), (envelope: WorkflowEventEnvelope) => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }

      mainWindow.webContents.send('workflow:event', envelope);
    });
  }

  return workflowManager;
};

const registerIpc = (): void => {
  ipcMain.handle('app:version', async (): Promise<string> => app.getVersion());
  ipcMain.handle('app:changelog', async (): Promise<string> => {
    const devPath = path.join(app.getAppPath(), 'CHANGELOG.md');
    const prodPath = path.join(process.resourcesPath, 'CHANGELOG.md');
    const changelogPath = app.isPackaged ? prodPath : devPath;
    try {
      return readFileSync(changelogPath, 'utf-8');
    } catch {
      return '';
    }
  });
  ipcMain.handle('workflow:start', async (_event, prompt: string): Promise<WorkflowSnapshot> => getWorkflowManager().start(prompt));
  ipcMain.handle('workflow:continue', async (_event, sessionId: string, prompt: string): Promise<WorkflowSnapshot> => getWorkflowManager().continueSession(sessionId, prompt));
  ipcMain.handle('workflow:retry', async (): Promise<WorkflowSnapshot> => getWorkflowManager().retryCurrentStep());
  ipcMain.handle('workflow:pause', async (): Promise<WorkflowSnapshot> => getWorkflowManager().pause());
  ipcMain.handle('workflow:resume', async (): Promise<WorkflowSnapshot> => getWorkflowManager().resumeCurrent());
  ipcMain.handle('workflow:cancel', async (): Promise<WorkflowSnapshot> => getWorkflowManager().cancel());
  ipcMain.handle('workflow:manual-approve', async (): Promise<WorkflowSnapshot> => getWorkflowManager().manualApprove());
  ipcMain.handle('workflow:manual-reject', async (): Promise<WorkflowSnapshot> => getWorkflowManager().manualReject());
  ipcMain.handle('workflow:snapshot', async (): Promise<WorkflowSnapshot> => getWorkflowManager().getSnapshot());
  ipcMain.handle('workflow:sessions:list', async (): Promise<WorkflowSessionSummary[]> => getWorkflowManager().listSessions());
  ipcMain.handle('workflow:sessions:get', async (_event, sessionId: string): Promise<WorkflowSessionRecord> => getWorkflowManager().getSession(sessionId));
  ipcMain.handle('workflow:sessions:resume', async (_event, sessionId: string): Promise<WorkflowSnapshot> => getWorkflowManager().resumeSession(sessionId));
  ipcMain.handle('workflow:sessions:export', async (_event, sessionId: string, format: WorkflowExportFormat): Promise<WorkflowExportPayload> => getWorkflowManager().exportSession(sessionId, format));
  ipcMain.handle('workflow:sessions:clear', async (): Promise<number> => getWorkflowManager().clearAllSessions());
  ipcMain.handle('workflow:sessions:export-zip', async (): Promise<{ filePath: string }> => getWorkflowManager().exportAllSessionsZip());
  ipcMain.handle('workflow:queue', async (): Promise<WorkflowQueueSnapshot> => getWorkflowManager().getQueue());
  ipcMain.handle('workflow:health', async (): Promise<RuntimeHealthSnapshot> => getRuntimeHealthSnapshot(app.getPath('userData')));
  ipcMain.handle('workflow:config:get', async (): Promise<WorkflowConfigSnapshot> => getWorkflowConfigSnapshot());
  ipcMain.handle('workflow:config:update', async (_event, update: WorkflowRuntimeConfigUpdate): Promise<WorkflowConfigSnapshot> => updateWorkflowConfig(update));
  ipcMain.handle('workflow:plan:edit', async (_event, stepId: number, update: { description?: string; promptOverride?: string | null; notes?: string | null }): Promise<WorkflowSnapshot> => getWorkflowManager().editPlanStep(stepId, update));
  ipcMain.handle('workflow:plan:skip', async (_event, stepId: number): Promise<WorkflowSnapshot> => getWorkflowManager().skipStep(stepId));
  ipcMain.handle('workflow:collaboration:message', async (_event, content: string): Promise<WorkflowSnapshot> => getWorkflowManager().sendCollaborationMessage(content));
  ipcMain.handle('workflow:templates:list', async (): Promise<import('./shared/schema').WorkflowTemplate[]> => getWorkflowManager().listTemplates());
  ipcMain.handle('workflow:templates:save', async (_event, template: import('./shared/schema').WorkflowTemplateCreate): Promise<import('./shared/schema').WorkflowTemplate> => getWorkflowManager().saveTemplate(template));
  ipcMain.handle('workflow:templates:delete', async (_event, templateId: string): Promise<void> => getWorkflowManager().deleteTemplate(templateId));
};

app.whenReady().then(() => {
    nativeTheme.themeSource = 'system';

    if (devDiagnosticsEnabled) {
      writeFileSync(getDevDiagnosticsPath(), '');
    }

    ensureWindowsShortcuts();
    createWindow();
    registerIpc();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  registerCleanup('process-registry', killAllTrackedProcesses);

  app.on('before-quit', () => {
    void runAllCleanups();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });