import { create } from 'zustand';

const STORAGE_KEY = 'ai-fsm-desktop.preferences';

interface KeyboardShortcut {
  id: string;
  label: string;
  defaultKeys: string;
  customKeys: string | null;
}

interface PreferencesState {
  autoScrollEnabled: boolean;
  setAutoScrollEnabled: (enabled: boolean) => void;

  shortcuts: KeyboardShortcut[];
  setShortcutKeys: (id: string, keys: string | null) => void;
  resetShortcuts: () => void;
}

const DEFAULT_SHORTCUTS: KeyboardShortcut[] = [
  { id: 'send', label: '发送消息', defaultKeys: 'Ctrl+Enter', customKeys: null },
  { id: 'newChat', label: '新建对话', defaultKeys: 'Ctrl+Shift+N', customKeys: null },
  { id: 'focusSearch', label: '聚焦搜索', defaultKeys: 'Ctrl+/', customKeys: null },
  { id: 'closePanel', label: '关闭面板', defaultKeys: 'Esc', customKeys: null },
  { id: 'toggleSidebar', label: '切换侧边栏', defaultKeys: 'Ctrl+B', customKeys: null },
  { id: 'toggleContext', label: '切换上下文面板', defaultKeys: 'Ctrl+J', customKeys: null },
];

const loadStored = (): Partial<PreferencesState> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PreferencesState>;
      return {
        autoScrollEnabled: parsed.autoScrollEnabled ?? true,
        shortcuts: parsed.shortcuts ?? DEFAULT_SHORTCUTS,
      };
    }
  } catch {
    // ignore
  }
  return { autoScrollEnabled: true, shortcuts: DEFAULT_SHORTCUTS };
};

const persist = (state: Partial<PreferencesState>): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
};

export const usePreferenceStore = create<PreferencesState>((set, get) => {
  const stored = loadStored();

  return {
    autoScrollEnabled: stored.autoScrollEnabled ?? true,
    setAutoScrollEnabled: (enabled) => {
      set({ autoScrollEnabled: enabled });
      persist({ autoScrollEnabled: enabled, shortcuts: get().shortcuts });
    },

    shortcuts: stored.shortcuts ?? DEFAULT_SHORTCUTS,
    setShortcutKeys: (id, keys) => {
      const next = get().shortcuts.map((s) => (s.id === id ? { ...s, customKeys: keys } : s));
      set({ shortcuts: next });
      persist({ autoScrollEnabled: get().autoScrollEnabled, shortcuts: next });
    },
    resetShortcuts: () => {
      set({ shortcuts: DEFAULT_SHORTCUTS });
      persist({ autoScrollEnabled: get().autoScrollEnabled, shortcuts: DEFAULT_SHORTCUTS });
    },
  };
});
