import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const LOG_DIR = path.join(process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.codepilot'), 'logs');

let logDirEnsured = false;
function ensureLogDir(): void {
  if (logDirEnsured) return;
  fs.mkdirSync(LOG_DIR, { recursive: true });
  logDirEnsured = true;
}

function getLogFileName(prefix: string): string {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  return `${prefix}-${date}.log`;
}

interface LogEntry {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
  module: string;
  message: string;
  data?: unknown;
}

function writeLog(entry: LogEntry): void {
  try {
    ensureLogDir();
    const fileName = getLogFileName(entry.module);
    const filePath = path.join(LOG_DIR, fileName);
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(filePath, line);
  } catch {
    // 日志写入失败不影响主流程
  }
}

export interface Logger {
  info(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  debug(message: string, data?: unknown): void;
}

export function createLogger(module: string): Logger {
  return {
    info(message: string, data?: unknown): void {
      writeLog({ timestamp: new Date().toISOString(), level: 'INFO', module, message, data });
    },
    error(message: string, data?: unknown): void {
      writeLog({ timestamp: new Date().toISOString(), level: 'ERROR', module, message, data });
    },
    warn(message: string, data?: unknown): void {
      writeLog({ timestamp: new Date().toISOString(), level: 'WARN', module, message, data });
    },
    debug(message: string, data?: unknown): void {
      writeLog({ timestamp: new Date().toISOString(), level: 'DEBUG', module, message, data });
    },
  };
}

export const logger = createLogger('app');

export function getLogFilePath(prefix: string): string {
  return path.join(LOG_DIR, getLogFileName(prefix));
}

export function getLogDir(): string {
  return LOG_DIR;
}

export function listLogFiles(): string[] {
  try {
    return fs.readdirSync(LOG_DIR)
      .filter(f => f.endsWith('.log'))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export function readLogFile(fileName: string): string | null {
  try {
    return fs.readFileSync(path.join(LOG_DIR, fileName), 'utf-8');
  } catch {
    return null;
  }
}

export function exportLogFile(fileName: string, destPath: string): boolean {
  try {
    fs.copyFileSync(path.join(LOG_DIR, fileName), destPath);
    return true;
  } catch {
    return false;
  }
}
