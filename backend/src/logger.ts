import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response, NextFunction } from 'express';
import { LOG_DIR } from './config.js';

const MAX_LOG_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB per file
const MAX_LOG_FILES = 5;

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const allLogFile = path.resolve(LOG_DIR, 'server.log');
const errorLogFile = path.resolve(LOG_DIR, 'error.log');

/**
 * Rotates a log file if it exceeds MAX_LOG_SIZE_BYTES.
 * Rotates e.g. server.log -> server.log.1 -> server.log.2 up to MAX_LOG_FILES.
 */
function rotateIfNeeded(filePath: string) {
  try {
    if (!fs.existsSync(filePath)) return;
    const stats = fs.statSync(filePath);
    if (stats.size < MAX_LOG_SIZE_BYTES) return;

    for (let i = MAX_LOG_FILES - 1; i >= 1; i--) {
      const older = `${filePath}.${i}`;
      const newer = `${filePath}.${i + 1}`;
      if (fs.existsSync(older)) {
        if (i === MAX_LOG_FILES - 1 && fs.existsSync(newer)) {
          fs.unlinkSync(newer);
        }
        fs.renameSync(older, newer);
      }
    }
    fs.renameSync(filePath, `${filePath}.1`);
  } catch (err) {
    console.error(`[Logger] Fehler bei Log-Rotation für ${filePath}:`, err);
  }
}

function writeToFile(filePath: string, line: string) {
  try {
    rotateIfNeeded(filePath);
    fs.appendFileSync(filePath, line + '\n', 'utf8');
  } catch (err) {
    console.error(`[Logger] Fehler beim Schreiben in ${filePath}:`, err);
  }
}

function formatLog(level: string, message: string, meta?: any): string {
  const timestamp = new Date().toISOString();
  let metaStr = '';
  if (meta !== undefined && meta !== null) {
    if (meta instanceof Error) {
      metaStr = ` | Stack: ${meta.stack || meta.message}`;
    } else if (typeof meta === 'object') {
      try {
        metaStr = ` | ${JSON.stringify(meta)}`;
      } catch {
        metaStr = ` | [Object]`;
      }
    } else {
      metaStr = ` | ${meta}`;
    }
  }
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
}

export const logger = {
  debug(message: string, meta?: any) {
    if (process.env.DEBUG || process.env.NODE_ENV === 'development') {
      const line = formatLog('DEBUG', message, meta);
      console.log(line);
      writeToFile(allLogFile, line);
    }
  },

  info(message: string, meta?: any) {
    const line = formatLog('INFO', message, meta);
    console.log(line);
    writeToFile(allLogFile, line);
  },

  warn(message: string, meta?: any) {
    const line = formatLog('WARN', message, meta);
    console.warn(line);
    writeToFile(allLogFile, line);
  },

  error(message: string, meta?: any) {
    const line = formatLog('ERROR', message, meta);
    console.error(line);
    writeToFile(allLogFile, line);
    writeToFile(errorLogFile, line);
  },

  /**
   * Express middleware to log incoming HTTP requests and their completion status/time.
   */
  requestMiddleware(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();
    const url = req.originalUrl || req.url;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';

    // Exclude noise like favicon or health checks from verbose logging if desired
    const isAsset = url.startsWith('/assets/') || url.endsWith('.ico') || url.endsWith('.png');

    res.on('finish', () => {
      const duration = Date.now() - startTime;
      const status = res.statusCode;
      const logLine = `[HTTP] ${req.method} ${url} ${status} - ${duration}ms (${ip})`;

      if (status >= 500) {
        logger.error(logLine);
      } else if (status >= 400) {
        logger.warn(logLine);
      } else if (!isAsset) {
        logger.info(logLine);
      }
    });

    next();
  },
};
