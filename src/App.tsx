/**
 * App.tsx — Shell component.
 *
 * This file is intentionally minimal. All business logic, state management,
 * and feature-specific rendering have been extracted to:
 *
 *   - src/store/         — Zustand state management
 *   - src/hooks/         — Data fetching & preload bridge hooks
 *   - src/features/      — Feature views (chat, dag, session, config)
 *   - src/layout/        — AppShell with navigation and toast provider
 *   - src/lib/           — Pure utility functions and constants
 *   - src/components/    — Shared UI primitives
 */

import { AppShell } from './layout/AppShell';

const App = (): JSX.Element => {
  return <AppShell />;
};

export default App;