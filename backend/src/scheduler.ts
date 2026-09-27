import cron, { ScheduledTask } from 'node-cron';
import { logger } from './logger.js';
import { AUTO_SYNC_ENABLED, AUTO_SYNC_CRON, AUTO_SYNC_TIMEZONE } from './config.js';
import { runKiaSync, KiaSyncResult } from './kia_sync_service.js';

let scheduledTask: ScheduledTask | null = null;

export type SyncSuccessCallback = (syncData: any) => Promise<void> | void;
const syncSuccessListeners: SyncSuccessCallback[] = [];

/**
 * Register a listener to be called whenever a Kia sync completes successfully.
 * Useful for automated charge suggestion detection or data analytics.
 */
export function registerSyncSuccessListener(listener: SyncSuccessCallback): void {
  syncSuccessListeners.push(listener);
}

/**
 * Dispatches sync success to all registered listeners.
 */
export async function notifySyncSuccess(syncData: any): Promise<void> {
  for (const listener of syncSuccessListeners) {
    try {
      await listener(syncData);
    } catch (e: any) {
      logger.error('[Scheduler] Fehler in SyncSuccess-Listener:', e.message);
    }
  }
}

/**
 * Executes the scheduled sync (cache query, no force refresh, quelle = 'auto_sync').
 * Protected against exceptions so the backend process never crashes.
 */
export async function executeScheduledSync(): Promise<KiaSyncResult> {
  logger.info('[Scheduler] Automatischer Kia-Sync (07:00 / 20:00 Uhr) gestartet...');
  try {
    const result = await runKiaSync({
      force: false,
      quelle: 'auto_sync',
    });

    if (result.success) {
      logger.info('[Scheduler] Automatischer Kia-Sync erfolgreich abgeschlossen.');
      await notifySyncSuccess(result.data);
    } else {
      logger.warn('[Scheduler] Automatischer Kia-Sync meldet Problem:', result.error);
    }

    return result;
  } catch (err: any) {
    logger.error('[Scheduler] Unerwarteter Fehler im automatischen Sync:', err.message);
    return {
      success: false,
      error: err.message,
    };
  }
}

/**
 * Initializes and starts the cron scheduler.
 */
export function initScheduler(): ScheduledTask | null {
  if (!AUTO_SYNC_ENABLED) {
    logger.info('[Scheduler] Automatischer Kia-Sync ist deaktiviert (AUTO_SYNC_ENABLED=false).');
    return null;
  }

  // Validate cron expression
  if (!cron.validate(AUTO_SYNC_CRON)) {
    logger.error(`[Scheduler] Ungültiges Cron-Muster "${AUTO_SYNC_CRON}". Scheduler wird nicht gestartet.`);
    return null;
  }

  logger.info(
    `[Scheduler] Starte automatischen Kia-Sync mit Zeitplan: "${AUTO_SYNC_CRON}" (Zeitzone: ${AUTO_SYNC_TIMEZONE})`
  );

  scheduledTask = cron.schedule(
    AUTO_SYNC_CRON,
    () => {
      executeScheduledSync().catch((err) => {
        logger.error('[Scheduler] Unbehandelter Fehler im Cron-Task:', err);
      });
    },
    {
      timezone: AUTO_SYNC_TIMEZONE,
    }
  );

  return scheduledTask;
}

/**
 * Returns current status of the scheduler.
 */
export function getSchedulerStatus() {
  return {
    enabled: AUTO_SYNC_ENABLED,
    cron: AUTO_SYNC_CRON,
    timezone: AUTO_SYNC_TIMEZONE,
    running: scheduledTask !== null,
  };
}
