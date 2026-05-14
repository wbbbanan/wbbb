import type { WorkflowPhase, WorkflowRecoveryDescriptor } from '../shared/ipc';
import { getWorkflowConfig } from './configManager';
import { ProcessExecutionError } from './processRunner';

const AUTHENTICATION_PATTERN = /token|auth|credential|login|unauthorized|forbidden|api[ -]?key|permission/i;
const TRANSIENT_PATTERN = /ECONN|ENOTFOUND|fetch failed|network|socket|gateway timeout|temporar/i;
const VALIDATION_PATTERN = /current_step_id|schema|validation|zod/i;
const EMPTY_OUTPUT_PATTERN = /输出为空|不可读|empty|no useful summary/i;
const OOM_PATTERN = /heap|out of memory|allocation failed|javascript heap|ENOMEM/i;
const DISK_PATTERN = /ENOSPC|disk full|no space left|write error/i;
const PERMISSION_PATTERN = /EPERM|EACCES|access denied|permission denied/i;

const buildDelayMs = (retryCount: number): number => {
  const config = getWorkflowConfig();
  return Math.min(config.backoffMaxMs, config.backoffBaseMs * Math.max(1, retryCount));
};

const createDescriptor = (descriptor: Omit<WorkflowRecoveryDescriptor, 'classifiedAt'>): WorkflowRecoveryDescriptor => ({
  ...descriptor,
  classifiedAt: new Date().toISOString(),
});

export const classifyWorkflowError = (error: unknown, phase: WorkflowPhase, retryCount: number): WorkflowRecoveryDescriptor => {
  const message = error instanceof Error ? error.message : String(error);
  const delayMs = buildDelayMs(retryCount);

  if (error instanceof ProcessExecutionError && error.timedOut) {
    return createDescriptor({
      category: 'timeout',
      action: 'queued-retry',
      summary: `${phase} 阶段命令超时，已转入可自动恢复队列。`,
      autoRetryable: true,
      delayMs,
    });
  }

  // OOM: exit code 137 or heap-related keywords → transient, auto-retryable
  if (
    (error instanceof ProcessExecutionError && error.exitCode === 137) ||
    OOM_PATTERN.test(message)
  ) {
    return createDescriptor({
      category: 'transient-infrastructure',
      action: 'queued-retry',
      summary: `${phase} 阶段疑似内存不足（exit 137 / OOM），稍后自动恢复。`,
      autoRetryable: true,
      delayMs: delayMs * 2,
    });
  }

  // Segfault: exit code 139 → manual review (likely code bug)
  if (error instanceof ProcessExecutionError && error.exitCode === 139) {
    return createDescriptor({
      category: 'unknown',
      action: 'manual-review',
      summary: `${phase} 阶段子进程段错误（exit 139），需要人工排查。`,
      autoRetryable: false,
    });
  }

  // Disk space issues → manual review
  if (DISK_PATTERN.test(message)) {
    return createDescriptor({
      category: 'transient-infrastructure',
      action: 'manual-review',
      summary: `${phase} 阶段磁盘空间不足，需要人工清理后重试。`,
      autoRetryable: false,
    });
  }

  // File permission issues → manual review
  if (PERMISSION_PATTERN.test(message)) {
    return createDescriptor({
      category: 'transient-infrastructure',
      action: 'manual-review',
      summary: `${phase} 阶段遇到文件权限问题，需要人工处理。`,
      autoRetryable: false,
    });
  }

  if (error instanceof Error && error.name === 'StructuredOutputError') {
    return createDescriptor({
      category: 'structured-output',
      action: 'queued-retry',
      summary: `${phase} 阶段收到损坏的结构化输出，适合延迟后自动重跑。`,
      autoRetryable: true,
      delayMs,
    });
  }

  if (TRANSIENT_PATTERN.test(message)) {
    return createDescriptor({
      category: 'transient-infrastructure',
      action: 'queued-retry',
      summary: `${phase} 阶段遇到临时基础设施异常，稍后自动恢复。`,
      autoRetryable: true,
      delayMs,
    });
  }

  if (AUTHENTICATION_PATTERN.test(message)) {
    return createDescriptor({
      category: 'authentication',
      action: 'manual-review',
      summary: `${phase} 阶段疑似缺少凭据或权限，需要人工处理。`,
      autoRetryable: false,
    });
  }

  if (VALIDATION_PATTERN.test(message)) {
    return createDescriptor({
      category: 'validation',
      action: 'manual-review',
      summary: `${phase} 阶段输出结构或校验不满足预期，需要人工确认。`,
      autoRetryable: false,
    });
  }

  if (EMPTY_OUTPUT_PATTERN.test(message)) {
    return createDescriptor({
      category: 'empty-output',
      action: 'queued-retry',
      summary: `${phase} 阶段返回了空结果，可从断点再次尝试。`,
      autoRetryable: true,
      delayMs,
    });
  }

  return createDescriptor({
    category: 'unknown',
    action: 'manual-review',
    summary: `${phase} 阶段出现未知错误，已保留现场等待人工恢复。`,
    autoRetryable: false,
  });
};

export const createInterruptedRecovery = (phase: WorkflowPhase): WorkflowRecoveryDescriptor =>
  createDescriptor({
    category: 'interrupted',
    action: 'resume-from-checkpoint',
    summary: `应用在 ${phase} 阶段异常退出，可从最近断点恢复。`,
    autoRetryable: false,
  });