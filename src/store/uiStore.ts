import { create } from 'zustand';

export type ViewRoute = 'chat' | 'dag' | 'sessions' | 'config';
export type ThemeMode = 'system' | 'dark' | 'light';

const THEME_STORAGE_KEY = 'ai-fsm-desktop.theme';

const getStoredThemeMode = (): ThemeMode => {
  if (typeof window === 'undefined') {
    return 'system';
  }

  const value = window.localStorage.getItem(THEME_STORAGE_KEY);
  return value === 'dark' || value === 'light' || value === 'system' ? value : 'system';
};

interface UIState {
  // ── View routing ────────────────────────────────────────────
  route: ViewRoute;
  setRoute: (route: ViewRoute) => void;

  // ── Theme / shell ──────────────────────────────────────────
  themeMode: ThemeMode;
  setThemeMode: (themeMode: ThemeMode) => void;
  shellMenuOpen: boolean;
  setShellMenuOpen: (open: boolean) => void;

  // ── Dialog / overlay state ──────────────────────────────────
  historyDialogOpen: boolean;
  setHistoryDialogOpen: (open: boolean) => void;
  changelogOpen: boolean;
  setChangelogOpen: (open: boolean) => void;
  changelogContent: string;
  setChangelogContent: (content: string) => void;

  // ── Session search ──────────────────────────────────────────
  historyQuery: string;
  setHistoryQuery: (query: string) => void;

  // ── Sidebar ─────────────────────────────────────────────────
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  contextPanelOpen: boolean;
  setContextPanelOpen: (open: boolean) => void;

  // ── Version ─────────────────────────────────────────────────
  version: string;
  setVersion: (version: string) => void;
}

const getInitialRoute = (): ViewRoute => {
  const hash = window.location.hash.replace('#/', '').replace('#', '');
  if (['chat', 'dag', 'sessions', 'config'].includes(hash)) return hash as ViewRoute;
  return 'chat';
};

export const useUIStore = create<UIState>((set) => ({
  route: getInitialRoute(),
  setRoute: (route) => {
    window.location.hash = `#/${route}`;
    set({ route, shellMenuOpen: false });
  },

  themeMode: getStoredThemeMode(),
  setThemeMode: (themeMode) => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    }
    set({ themeMode });
  },
  shellMenuOpen: false,
  setShellMenuOpen: (open) => set({ shellMenuOpen: open }),

  historyDialogOpen: false,
  setHistoryDialogOpen: (open) => set({ historyDialogOpen: open }),
  changelogOpen: false,
  setChangelogOpen: (open) => set({ changelogOpen: open }),
  changelogContent: '',
  setChangelogContent: (content) => set({ changelogContent: content }),

  historyQuery: '',
  setHistoryQuery: (query) => set({ historyQuery: query }),

  sidebarOpen: true,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  contextPanelOpen: true,
  setContextPanelOpen: (open) => set({ contextPanelOpen: open }),

  version: '',
  setVersion: (version) => set({ version }),
}));

// Listen to hash changes for deep linking
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    const hash = window.location.hash.replace('#/', '').replace('#', '');
    if (['chat', 'dag', 'sessions', 'config'].includes(hash)) {
      useUIStore.getState().setRoute(hash as ViewRoute);
    }
  });
}
