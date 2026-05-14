import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const WINDOWS_COMMAND_CANDIDATE_ORDER = ['.exe', '.com', '.cmd', '.bat', '.ps1', ''];

const scoreWindowsCommandCandidate = (value: string): number => {
  const extension = path.extname(value).toLowerCase();
  const index = WINDOWS_COMMAND_CANDIDATE_ORDER.indexOf(extension);

  return index === -1 ? WINDOWS_COMMAND_CANDIDATE_ORDER.length : index;
};

const resolveWindowsCommandCandidates = (bin: string): string[] => {
  if (path.isAbsolute(bin) || /[\\/]/u.test(bin) || path.extname(bin)) {
    return [bin];
  }

  const result = spawnSync('where.exe', [bin], {
    encoding: 'utf8',
    windowsHide: true,
  });

  if (result.status !== 0) {
    return [bin];
  }

  return result.stdout
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter(Boolean)
    .sort((left, right) => scoreWindowsCommandCandidate(left) - scoreWindowsCommandCandidate(right));
};

const resolveNodeShimTarget = (shimPath: string): { bin: string; args: string[] } | null => {
  try {
    const shimSource = readFileSync(shimPath, 'utf8');
    const match = shimSource.match(/"%dp0%\\([^"]+)"\s+%\*/iu);

    if (!match) {
      return null;
    }

    const scriptPath = path.resolve(path.dirname(shimPath), match[1].replace(/\\/gu, path.sep));
    const localNode = path.resolve(path.dirname(shimPath), 'node.exe');

    return {
      bin: existsSync(localNode) ? localNode : 'node',
      args: [scriptPath],
    };
  } catch {
    return null;
  }
};

export const resolveWindowsSpawnTarget = (bin: string, args: string[]): { bin: string; args: string[] } => {
  const candidate = resolveWindowsCommandCandidates(bin)[0] ?? bin;
  const extension = path.extname(candidate).toLowerCase();

  if (extension === '.cmd' || extension === '.bat') {
    const shimTarget = resolveNodeShimTarget(candidate);

    if (shimTarget) {
      return {
        bin: shimTarget.bin,
        args: [...shimTarget.args, ...args],
      };
    }
  }

  if (extension === '.ps1') {
    return {
      bin: 'powershell.exe',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', candidate, ...args],
    };
  }

  return {
    bin: candidate,
    args,
  };
};