import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { WorkflowStateMachine } from '../src/backend/workflowStateMachine';

const DEFAULT_PROMPT =
  '在当前工作目录中只创建一个名为 smoke-workflow.txt 的文件，文件内容必须精确为 workflow smoke ok。不要修改其他文件。完成后总结你创建了什么，并验证该文件内容。';
const DEFAULT_TIMEOUT_MS = 12 * 60 * 1000;
const POLL_INTERVAL_MS = 2_000;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const readArg = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);

  if (index === -1) {
    return undefined;
  }

  return process.argv[index + 1];
};

const toTimeoutMs = (value: string | undefined): number => {
  if (!value) {
    return DEFAULT_TIMEOUT_MS;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
};

const defaultWorkdir = path.resolve(__dirname, '..', '..', 'ai-fsm-desktop-smoke');

const main = async (): Promise<void> => {
  const workdir = path.resolve(readArg('--workdir') ?? defaultWorkdir);
  const outputPath = path.resolve(readArg('--output') ?? path.join(workdir, '.runtime-smoke-result.json'));
  const timeoutMs = toTimeoutMs(readArg('--timeout-ms'));
  const prompt = readArg('--prompt') ?? DEFAULT_PROMPT;

  mkdirSync(workdir, { recursive: true });
  rmSync(path.join(workdir, 'smoke-workflow.txt'), { force: true });
  rmSync(path.join(workdir, '.runtime-smoke-result.json'), { force: true });
  process.chdir(workdir);

  const events: Array<ReturnType<WorkflowStateMachine['getSnapshot']> extends never ? never : any> = [];
  const machine = new WorkflowStateMachine((envelope) => {
    events.push(envelope.event);

    console.log(
      `[event]${JSON.stringify({
        title: envelope.event.title,
        status: envelope.event.status,
        nodeId: envelope.event.nodeId,
        detailKeys: Object.keys(envelope.event.details ?? {}),
      })}`,
    );
  });

  await machine.start(prompt);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const snapshot = machine.getSnapshot();

    if (snapshot.lifecycle === 'completed' || snapshot.lifecycle === 'paused' || snapshot.lifecycle === 'failed') {
      break;
    }

    await delay(POLL_INTERVAL_MS);
  }

  const snapshot = machine.getSnapshot();
  const artifactPath = path.join(workdir, 'smoke-workflow.txt');
  const artifactExists = existsSync(artifactPath);
  const artifactContent = artifactExists ? readFileSync(artifactPath, 'utf8').trim() : null;
  const result = {
    prompt,
    workdir,
    outputPath,
    snapshot,
    artifact: {
      path: artifactPath,
      exists: artifactExists,
      content: artifactContent,
    },
    events,
  };

  writeFileSync(outputPath, JSON.stringify(result, null, 2));

  console.log(`[result-path]${outputPath}`);
  console.log(
    `[summary]${JSON.stringify(
      {
        lifecycle: snapshot.lifecycle,
        currentPhase: snapshot.currentPhase,
        manualInterventionRequired: snapshot.manualInterventionRequired,
        eventCount: events.length,
        artifactExists,
        artifactContent,
        detailMatrix: events.map((event) => ({
          title: event.title,
          status: event.status,
          detailKeys: Object.keys(event.details ?? {}),
        })),
      },
      null,
      2,
    )}`,
  );

  if (snapshot.lifecycle !== 'completed' || artifactContent !== 'workflow smoke ok') {
    process.exitCode = 1;
  }
};

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});