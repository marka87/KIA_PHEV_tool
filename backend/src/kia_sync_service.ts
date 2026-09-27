import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { logger } from './logger.js';
import { decryptString } from './crypto.js';
import { PORT, BASIC_AUTH_USER, BASIC_AUTH_PASSWORD } from './config.js';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const kiaSyncScript = path.resolve(__dirname, '../../kia_service/sync_kia.py');
export const kiaConfigPath = path.resolve(__dirname, '../../kia_service/config.json');

export interface KiaSyncOptions {
  force?: boolean;
  quelle?: string;
  serverUrl?: string;
}

export interface KiaSyncResult {
  success: boolean;
  data?: any;
  error?: string;
}

/**
 * Executes kia_service/sync_kia.py with credentials passed via environment variables.
 * Safe against crashes and captures stderr/stdout cleanly.
 */
export async function runKiaSync(options: KiaSyncOptions = {}): Promise<KiaSyncResult> {
  const force = Boolean(options.force);
  const quelle = options.quelle || 'kia_connect';
  const serverUrl = options.serverUrl || `http://localhost:${PORT}`;

  logger.info(`[KiaSync] Starte Synchronisierung (force=${force}, quelle=${quelle})...`);

  // Read and decrypt credentials from kia_service/config.json
  let decryptedPassword = '';
  let decryptedPin = '';
  let username = '';

  if (fs.existsSync(kiaConfigPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(kiaConfigPath, 'utf-8'));
      username = cfg.username || '';
      decryptedPassword = decryptString(cfg.password || '');
      decryptedPin = decryptString(cfg.pin || '');
    } catch (e: any) {
      logger.error('[KiaSync] Konfigurationsfehler beim Lesen von config.json:', e.message);
    }
  }

  const args = [kiaSyncScript, '--json', '--server-url', serverUrl, '--quelle', quelle];
  if (force) {
    args.push('--force');
  }

  try {
    const { stdout, stderr } = await execFileAsync('python', args, {
      timeout: 90000,
      env: {
        ...process.env,
        KIA_USERNAME: username,
        KIA_PASSWORD: decryptedPassword,
        KIA_PIN: decryptedPin,
        BASIC_AUTH_USER: BASIC_AUTH_USER || '',
        BASIC_AUTH_PASSWORD: BASIC_AUTH_PASSWORD || '',
      },
    });

    const output = stdout.trim();
    let data: any;
    try {
      data = JSON.parse(output);
    } catch {
      const errDetail = output || stderr;
      logger.error('[KiaSync] Unerwartete Skript-Ausgabe:', errDetail);
      return {
        success: false,
        error: 'Unerwartete Skript-Ausgabe: ' + errDetail,
      };
    }

    if (!data.success) {
      logger.warn('[KiaSync] Synchronisation meldet Fehler:', data.error);
      return {
        success: false,
        error: data.error || 'Kia Connect Synchronisation fehlgeschlagen',
      };
    }

    logger.info(
      `[KiaSync] Synchronisation (${quelle}) erfolgreich: Tacho=${data.odometer_km ?? data.snapshot?.odometer_km} km, SoC=${data.soc_percent ?? data.snapshot?.soc_percent}%`
    );
    return {
      success: true,
      data,
    };
  } catch (err: any) {
    const errDetail = err.stderr?.trim() || err.stdout?.trim() || err.message;
    logger.error('[KiaSync] Ausführungsfehler:', errDetail);

    if (err.stdout) {
      try {
        const data = JSON.parse(err.stdout.trim());
        if (data.error) {
          return { success: false, error: data.error };
        }
      } catch {}
    }

    return {
      success: false,
      error: 'Fehler beim Ausführen von sync_kia.py: ' + errDetail,
    };
  }
}
