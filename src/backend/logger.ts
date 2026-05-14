type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const ENV_LEVEL = (process.env.AI_FSM_LOG_LEVEL?.trim().toLowerCase() as LogLevel | undefined) ?? 'info';
const MIN_LEVEL = LEVEL_PRIORITY[ENV_LEVEL] ?? LEVEL_PRIORITY.info;

const formatTimestamp = (): string => new Date().toISOString();

const shouldLog = (level: LogLevel): boolean => LEVEL_PRIORITY[level] >= MIN_LEVEL;

export const createLogger = (module: string) => ({
  debug: (message: string, ...args: unknown[]): void => {
    if (shouldLog('debug')) {
      console.debug(`[${formatTimestamp()}] [${module}] ${message}`, ...args);
    }
  },
  info: (message: string, ...args: unknown[]): void => {
    if (shouldLog('info')) {
      console.log(`[${formatTimestamp()}] [${module}] ${message}`, ...args);
    }
  },
  warn: (message: string, ...args: unknown[]): void => {
    if (shouldLog('warn')) {
      console.warn(`[${formatTimestamp()}] [${module}] ${message}`, ...args);
    }
  },
  error: (message: string, ...args: unknown[]): void => {
    if (shouldLog('error')) {
      console.error(`[${formatTimestamp()}] [${module}] ${message}`, ...args);
    }
  },
});

export type Logger = ReturnType<typeof createLogger>;
