import { useEffect } from 'react';
import Mousetrap from 'mousetrap';
import { useUIStore } from '../store/uiStore';

/**
 * Global keyboard shortcuts.
 * Call once in AppShell.
 */
export const useKeyboard = (handlers: {
  onSend?: () => void;
}): void => {
  useEffect(() => {
    // Ctrl+Enter — send message
    Mousetrap.bind('ctrl+enter', (e) => {
      e.preventDefault();
      handlers.onSend?.();
    });

    // Esc — close any open dialog/panel
    Mousetrap.bind('escape', () => {
      const ui = useUIStore.getState();
      if (ui.historyDialogOpen) {
        ui.setHistoryDialogOpen(false);
      } else if (ui.changelogOpen) {
        ui.setChangelogOpen(false);
      }
    });

    // / — focus search (when not in input)
    Mousetrap.bind('/', (e) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      e.preventDefault();
      const searchInput = document.getElementById('session-search-input');
      if (searchInput) {
        (searchInput as HTMLInputElement).focus();
      }
    });

    // Ctrl+1/2/3/4 — route switching
    Mousetrap.bind('ctrl+1', (e) => {
      e.preventDefault();
      useUIStore.getState().setRoute('chat');
    });
    Mousetrap.bind('ctrl+2', (e) => {
      e.preventDefault();
      useUIStore.getState().setRoute('dag');
    });
    Mousetrap.bind('ctrl+3', (e) => {
      e.preventDefault();
      useUIStore.getState().setRoute('sessions');
    });
    Mousetrap.bind('ctrl+4', (e) => {
      e.preventDefault();
      useUIStore.getState().setRoute('config');
    });

    return () => {
      Mousetrap.reset();
    };
  }, [handlers.onSend]);
};
