import { runCommandWithStdin } from './processRunner';
import { parseJsonObject } from './streamUtils';
import { buildToolLaunchSpec } from './toolRuntimeConfig';
import type { SummarizedSubAgentResult } from '../shared/ipc';

const SHORT_OUTPUT_THRESHOLD = 500;
const DEFAULT_MAX_RAW_INPUT_CHARS = 6_000;

const SUMMARIZER_PROMPT_TEMPLATE = [
  '你是一个执行摘要生成器。请将以下子代理的执行输出压缩为结构化摘要。',
  '只输出严格 JSON，不要 Markdown 代码块。',
  '',
  '任务描述：{{taskDescription}}',
  '角色：{{role}}',
  '',
  '执行输出（已预截断）：',
  '{{truncatedOutput}}',
  '',
  '输出格式：',
  '{',
  '  "summary": "80字以内的精炼执行摘要",',
  '  "keyFindings": ["关键发现1", "关键发现2"],',
  '  "errorPatterns": ["错误模式1"],',
  '  "modifiedFiles": ["src/file.ts", "package.json"]',
  '}',
].join('\n');

const extractJsonFromClaudeOutput = (raw: string): unknown => {
  try {
    return parseJsonObject(raw);
  } catch {
    return null;
  }
};

function preTruncate(raw: string, maxChars: number): string {
  if (raw.length <= maxChars) {
    return raw;
  }

  const headLen = Math.floor(maxChars * 0.6);
  const tailLen = Math.floor(maxChars * 0.4);
  const head = raw.slice(0, headLen);
  const tail = raw.slice(-tailLen);

  const errorLines = raw
    .split(/\r?\n/gu)
    .filter((line) => /^(Error|FAIL|exception|AssertionError|npm ERR|Build failed|FAIL\s+)/iu.test(line.trim()));

  return `${head}\n\n[...${raw.length - headLen - tailLen} chars omitted...]\n\n${errorLines.join('\n')}\n${tail}`;
}

function extractFilePaths(raw: string): string[] {
  const matches = [...raw.matchAll(/\b[\w/\\-]+\.(ts|tsx|js|jsx|json|py|md)\b/gu)];
  return [...new Set(matches.map((m) => m[0]))];
}

export async function summarizeSubAgentOutput(
  rawOutput: string,
  taskDescription: string,
  role: string,
  opts?: { maxRawInputChars?: number; effort?: 'low' | 'medium' },
): Promise<SummarizedSubAgentResult> {
  const maxRawInputChars = opts?.maxRawInputChars ?? DEFAULT_MAX_RAW_INPUT_CHARS;
  const effort = opts?.effort ?? 'low';

  // Short output: local extraction only, skip LLM
  if (rawOutput.length <= SHORT_OUTPUT_THRESHOLD) {
    return {
      summary: rawOutput,
      keyFindings: [],
      errorPatterns: [],
      modifiedFiles: extractFilePaths(rawOutput),
    };
  }

  const truncated = preTruncate(rawOutput, maxRawInputChars);

  // Attempt LLM summarization
  try {
    const prompt = SUMMARIZER_PROMPT_TEMPLATE
      .replace('{{taskDescription}}', taskDescription)
      .replace('{{role}}', role)
      .replace('{{truncatedOutput}}', truncated);
    const launch = buildToolLaunchSpec('claude');

    const result = await runCommandWithStdin({
      bin: launch.bin,
      args: ['-p', '--verbose', '--output-format', 'stream-json', '--dangerously-skip-permissions', '--effort', effort],
      env: launch.env,
    }, prompt);

    const parsed = extractJsonFromClaudeOutput(result.stdout);
    if (parsed && typeof (parsed as Record<string, unknown>).summary === 'string') {
      const p = parsed as Record<string, unknown>;
      return {
        summary: String(p.summary),
        keyFindings: Array.isArray(p.keyFindings) ? p.keyFindings.filter((v): v is string => typeof v === 'string') : [],
        errorPatterns: Array.isArray(p.errorPatterns) ? p.errorPatterns.filter((v): v is string => typeof v === 'string') : [],
        modifiedFiles: Array.isArray(p.modifiedFiles) ? p.modifiedFiles.filter((v): v is string => typeof v === 'string') : [],
      };
    }
  } catch {
    // Fallback to local truncation
  }

  // Local fallback
  const localSummary = rawOutput.length > SHORT_OUTPUT_THRESHOLD ? `${rawOutput.slice(0, SHORT_OUTPUT_THRESHOLD)}...` : rawOutput;

  return {
    summary: `[本地摘要] ${localSummary}`,
    keyFindings: [],
    errorPatterns: [],
    modifiedFiles: extractFilePaths(rawOutput),
  };
}
