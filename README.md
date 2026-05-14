# AI FSM Desktop

Windows 11 desktop app built with Electron Forge, TypeScript, React, Tailwind CSS, and React Flow.

## Features

- Visual DAG-style orchestration for `opencode` and `claude`
- Planning, execution, verification, rejection routing, and manual circuit-breaker recovery
- Secure IPC bridge with `contextBridge`
- Windows Squirrel packaging with desktop shortcut creation enabled

## Prerequisites

- Node.js 20+
- `opencode` available on `PATH`
- `claude` (Claude Code CLI) available on `PATH`

## Credentials

This app does not manage model credentials by itself.

- `opencode` uses the current machine's local CLI environment, typically `OPENCODE_API_KEY`.
- `claude` uses the current machine's local Claude Code login/session state, typically under the current user's home directory.

If you move to a different Windows machine, the Electron app will not automatically import credentials from the previous computer. It only sees what is configured for the current local user environment.

## Run

```powershell
npm install
npm run lint
npm start
```

## Package

```powershell
npm run package
```

Packaged app output is written under `forge-out/AI FSM Desktop-win32-x64`.

Create distributable installers and archives:

```powershell
npm run make
```

Both `npm run package` and `npm run make` now refresh the desktop and Start Menu shortcut so it points at the latest packaged executable under `forge-out/AI FSM Desktop-win32-x64/AiFsmDesktop.exe`.
If an `AI FSM Desktop` taskbar pin already exists, the same sync step updates that pinned shortcut as well.
Installed Squirrel builds also self-heal the shortcut target on install, update, and packaged launch.

If a matching Electron zip is already present under `%LOCALAPPDATA%\electron\Cache`, packaging will reuse that local cache instead of forcing a fresh download.
The legacy default `out/` folder may still exist from older runs, but Forge no longer depends on it.

## Diagnostics

Development diagnostics are off by default. To enable the main-process startup and bridge probe log for a dev run:

```powershell
$env:AI_FSM_DEV_DIAGNOSTICS = '1'
npm start
```

When enabled, the log is written to Electron's `userData` directory as `electron-dev-diagnostics.log` instead of the project root.

## License

MIT. See `LICENSE`.