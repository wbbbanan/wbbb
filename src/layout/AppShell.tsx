import { useCallback, useEffect, useMemo, useState } from 'react';
import { Toaster } from 'react-hot-toast';
import {
  MessageSquare,
  GitBranch,
  History,
  Settings,
  Sun,
  Moon,
  Monitor,
  Plus,
  Menu,
  X,
} from 'lucide-react';
import { useUIStore, type ThemeMode, type ViewRoute } from '../store/uiStore';
import { useWorkflowStore } from '../store/workflowStore';
import { useWorkflowEvents } from '../hooks/useWorkflowEvents';
import { useKeyboard } from '../hooks/useKeyboard';
import { useAgentFlow } from '../hooks/useAgentFlow';
import { ChatView } from '../features/chat/ChatView';
import { DagView } from '../features/dag/DagView';
import { SessionView } from '../features/session/SessionView';
import { ConfigView } from '../features/config/ConfigView';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { ResizablePanel } from '../components/ResizablePanel';

const NAV_ITEMS: { id: ViewRoute; label: string; icon: React.ElementType; shortcut: string }[] = [
  { id: 'chat', label: '对话', icon: MessageSquare, shortcut: '⌃1' },
  { id: 'dag', label: '流程图', icon: GitBranch, shortcut: '⌃2' },
  { id: 'sessions', label: '历史', icon: History, shortcut: '⌃3' },
  { id: 'config', label: '设置', icon: Settings, shortcut: '⌃4' },
];

const THEME_ICONS: Record<ThemeMode, React.ElementType> = {
  system: Monitor,
  dark: Moon,
  light: Sun,
};

export const AppShell = (): JSX.Element => {
  const route = useUIStore((s) => s.route);
  const setRoute = useUIStore((s) => s.setRoute);
  const themeMode = useUIStore((s) => s.themeMode);
  const setThemeMode = useUIStore((s) => s.setThemeMode);
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const version = useUIStore((s) => s.version);
  const agentFlow = useAgentFlow();
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );

  useWorkflowEvents();

  const handleSend = useCallback(() => {
    const sendButton = document.querySelector('[data-send-button]') as HTMLButtonElement | null;
    sendButton?.click();
  }, []);

  useKeyboard({ onSend: handleSend });

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event: MediaQueryListEvent): void => {
      setSystemPrefersDark(event.matches);
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const resolvedTheme = useMemo(
    () => (themeMode === 'system' ? (systemPrefersDark ? 'dark' : 'light') : themeMode),
    [systemPrefersDark, themeMode]
  );

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  const handleNewChat = useCallback(() => {
    useWorkflowStore.getState().setInspectedSession(null);
    const snapshot = useWorkflowStore.getState().snapshot;
    useWorkflowStore.getState().setSnapshot({ ...snapshot, userPrompt: '' });
    useWorkflowStore.getState().setPrompt('');
    setRoute('chat');
  }, [setRoute]);

  const handleThemeCycle = useCallback(() => {
    const order: ThemeMode[] = ['system', 'light', 'dark'];
    const idx = order.indexOf(themeMode);
    setThemeMode(order[(idx + 1) % order.length]);
  }, [themeMode, setThemeMode]);

  const ThemeIcon = THEME_ICONS[themeMode];

  const sidebarContent = (
    <>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--surface-overlay)] text-[var(--text-primary)]">
          <GitBranch size={15} strokeWidth={2} />
        </div>
        <div>
          <div className="text-sm font-medium">AI FSM</div>
          {version ? <div className="text-2xs text-[var(--text-muted)]">v{version}</div> : null}
        </div>
      </div>

      {/* New Chat */}
      <div className="px-3 pb-2">
        <button
          onClick={handleNewChat}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-overlay)] px-3 py-2 text-sm text-[var(--text-primary)] transition hover:bg-[var(--surface-elevated)]"
        >
          <Plus size={15} />
          新建对话
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-2">
        <div className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = route === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setRoute(item.id);
                  setSidebarOpen(false);
                }}
                className={`group flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition ${
                  isActive
                    ? 'bg-[var(--surface-overlay)] text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)] hover:bg-[var(--surface-overlay)] hover:text-[var(--text-secondary)]'
                }`}
              >
                <Icon size={15} strokeWidth={isActive ? 2 : 1.5} />
                <span className="flex-1 text-left">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Footer */}
      <div className="border-t border-[var(--border-subtle)] px-3 py-3">
        <div className="flex items-center justify-between">
          <button
            onClick={handleThemeCycle}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-[var(--text-muted)] transition hover:bg-[var(--surface-overlay)] hover:text-[var(--text-secondary)]"
          >
            <ThemeIcon size={13} />
            <span className="capitalize">{themeMode}</span>
          </button>
          {!agentFlow ? (
            <span className="rounded-md bg-[var(--surface-overlay)] px-2 py-0.5 text-3xs text-[var(--text-muted)]">
              离线
            </span>
          ) : (
            <span className="rounded-md bg-[var(--surface-overlay)] px-2 py-0.5 text-3xs text-[var(--text-secondary)]">
              在线
            </span>
          )}
        </div>
      </div>
    </>
  );

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg-base)] text-[var(--text-primary)]">
      {/* Mobile sidebar overlay */}
      {sidebarOpen ? (
        <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setSidebarOpen(false)} />
      ) : null}

      {/* Mobile Sidebar — fixed, non-resizable */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[260px] flex-col border-r border-[var(--border-subtle)] bg-[var(--surface-sidebar)] transition-transform duration-300 md:hidden ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {sidebarContent}
      </aside>

      {/* Desktop Sidebar — resizable */}
      <div className="hidden md:flex shrink-0">
        <ResizablePanel side="left" defaultSize={260} minSize={180} maxSize={400} storageKey="app-shell-sidebar-width">
          <aside className="flex h-full w-full flex-col border-r border-[var(--border-subtle)] bg-[var(--surface-sidebar)]">
            {sidebarContent}
          </aside>
        </ResizablePanel>
      </div>

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-hidden bg-[var(--bg-base)]">
        <div className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-2.5 md:hidden">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="rounded-md p-2 text-[var(--text-muted)] transition hover:bg-[var(--surface-elevated)]"
          >
            {sidebarOpen ? <X size={16} /> : <Menu size={16} />}
          </button>
          <span className="text-sm font-medium">{NAV_ITEMS.find((n) => n.id === route)?.label}</span>
        </div>

        <ErrorBoundary>
          {route === 'chat' ? <ChatView /> : null}
          {route === 'dag' ? <DagView /> : null}
          {route === 'sessions' ? <SessionView /> : null}
          {route === 'config' ? <ConfigView /> : null}
        </ErrorBoundary>
      </main>

      <Toaster
        position="bottom-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: 'var(--surface-elevated)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '8px',
            fontSize: '13px',
          },
        }}
      />
    </div>
  );
};
