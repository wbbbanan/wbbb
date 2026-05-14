import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { WebpackPlugin } from '@electron-forge/plugin-webpack';
import { mainConfig } from './webpack.main.config';
import { preloadConfig } from './webpack.preload.config';
import { rendererConfig } from './webpack.renderer.config';

const electronVersion = require('electron/package.json').version as string;
const nodePtyRuntimeDir = path.join(__dirname, 'build-resources', 'node-pty-runtime');
const forgeOutDir = process.env.AI_FSM_FORGE_OUT_DIR?.trim() || 'forge-out';
const packagedLocaleAllowList = new Set(
  (process.env.AI_FSM_PACKAGED_LOCALES?.split(',') ?? ['en-US', 'en-GB', 'zh-CN', 'zh-TW'])
    .map((locale) => locale.trim())
    .filter(Boolean),
);

const findLocalElectronZipDir = (): string | undefined => {
  const localAppData = process.env.LOCALAPPDATA;

  if (!localAppData) {
    return undefined;
  }

  const cacheRoot = path.join(localAppData, 'electron', 'Cache');
  const zipFileName = `electron-v${electronVersion}-win32-x64.zip`;

  if (!existsSync(cacheRoot)) {
    return undefined;
  }

  for (const entry of readdirSync(cacheRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const candidateDir = path.join(cacheRoot, entry.name);

    if (existsSync(path.join(candidateDir, zipFileName))) {
      return candidateDir;
    }
  }

  return undefined;
};

const localElectronZipDir = findLocalElectronZipDir();
const changelogPath = path.join(__dirname, 'CHANGELOG.md');
const extraResources = [
  ...(existsSync(nodePtyRuntimeDir) ? [nodePtyRuntimeDir] : []),
  ...(existsSync(changelogPath) ? [changelogPath] : []),
];

const squirrelConfig = {
  name: 'ai_fsm_desktop',
  exe: 'AiFsmDesktop.exe',
  setupExe: 'AiFsmDesktopSetup.exe',
  authors: 'GitHub Copilot',
  description: 'Visual workflow orchestrator for OpenCode and Claude Code CLI.',
  noMsi: true,
  createDesktopShortcut: true,
} as unknown as ConstructorParameters<typeof MakerSquirrel>[0];

const config: ForgeConfig = {
  outDir: forgeOutDir,
  packagerConfig: {
    asar: true,
    executableName: 'AiFsmDesktop',
    ...(extraResources.length > 0 ? { extraResource: extraResources } : {}),
    ...(localElectronZipDir ? { electronZipDir: localElectronZipDir } : {}),
  },
  rebuildConfig: {},
  hooks: {
    postPackage: async (_forgeConfig, packageResult) => {
      for (const outputPath of packageResult.outputPaths) {
        const localesDir = path.join(outputPath, 'locales');

        if (!existsSync(localesDir)) {
          continue;
        }

        for (const entry of readdirSync(localesDir, { withFileTypes: true })) {
          if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.pak') {
            continue;
          }

          const locale = path.basename(entry.name, '.pak');

          if (packagedLocaleAllowList.has(locale)) {
            continue;
          }

          rmSync(path.join(localesDir, entry.name), { force: true });
        }
      }
    },
  },
  makers: [
    new MakerSquirrel(squirrelConfig),
    new MakerZIP({}, ['win32']),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new WebpackPlugin({
      mainConfig,
      devContentSecurityPolicy:
        "default-src 'self' 'unsafe-inline' data:; script-src 'self' 'unsafe-inline' data:; connect-src 'self' ws: http: https:;",
      renderer: {
        config: rendererConfig,
        entryPoints: [
          {
            html: './src/index.html',
            js: './src/renderer.tsx',
            name: 'main_window',
            preload: {
              config: preloadConfig,
              js: './src/preload.ts',
            },
          },
        ],
      },
    }),
  ],
};

export default config;