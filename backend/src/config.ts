import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');

// Attempt to load .env from process.cwd() or project root
const envPaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(projectRoot, '.env'),
  path.resolve(__dirname, '../.env'),
];

for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    try {
      if (typeof process.loadEnvFile === 'function') {
        process.loadEnvFile(envPath);
      }
      break;
    } catch (e) {
      console.warn(`[Config] Hinweis: Konnte ${envPath} nicht laden:`, e);
    }
  }
}

// 1. Network & Server
export const PORT = Number(process.env.PORT) || 3000;
export const HOST = process.env.HOST || '0.0.0.0';

// 2. Data Persistence & Paths
// Default: backend/data/phev.db, but can be set to any outside directory (e.g., C:/PHEV_Data/phev.db)
export const DB_PATH = process.env.DB_PATH
  ? (path.isAbsolute(process.env.DB_PATH) ? path.resolve(process.env.DB_PATH) : path.resolve(projectRoot, process.env.DB_PATH))
  : path.resolve(__dirname, '../data/phev.db');

export const BACKUP_DIR = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : path.resolve(path.dirname(DB_PATH), 'backups');

export const BACKUP_RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS) || 30;

// 3. Security (Basic Auth & Encryption)
export const BASIC_AUTH_USER = process.env.BASIC_AUTH_USER || '';
export const BASIC_AUTH_PASSWORD = process.env.BASIC_AUTH_PASSWORD || '';
export const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '';

// 4. Logging
export const LOG_DIR = process.env.LOG_DIR
  ? path.resolve(process.env.LOG_DIR)
  : path.resolve(projectRoot, 'logs');

// 5. Automatic Kia Sync Scheduler
export const AUTO_SYNC_ENABLED = process.env.AUTO_SYNC_ENABLED !== 'false';
export const AUTO_SYNC_CRON = process.env.AUTO_SYNC_CRON || (
  process.env.AUTO_SYNC_HOURS
    ? `0 ${process.env.AUTO_SYNC_HOURS} * * *`
    : '0 7,20 * * *'
);
export const AUTO_SYNC_TIMEZONE = process.env.AUTO_SYNC_TIMEZONE || 'Europe/Vienna';
