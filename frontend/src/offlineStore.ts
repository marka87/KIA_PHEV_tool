/**
 * Minimalist Offline Storage & Sync Manager using native IndexedDB.
 */

export interface PendingAction {
  id?: number;
  timestamp: number;
  endpoint: string;
  method: string;
  payload: any;
  label: string;
}

const DB_NAME = 'phev_offline_db';
const DB_VERSION = 1;
const STORE_NAME = 'pending_actions';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function queueOfflineAction(action: Omit<PendingAction, 'id' | 'timestamp'>): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const item: PendingAction = {
      ...action,
      timestamp: Date.now(),
    };
    const req = store.add(item);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getPendingActions(): Promise<PendingAction[]> {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error('Fehler beim Laden der Offline-Aktionen:', err);
    return [];
  }
}

export async function removePendingAction(id: number): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function syncPendingActions(onProgress?: (synced: number, remaining: number) => void): Promise<number> {
  const actions = await getPendingActions();
  if (actions.length === 0) return 0;

  let syncedCount = 0;
  for (const action of actions) {
    try {
      const res = await fetch(action.endpoint, {
        method: action.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action.payload),
      });

      if (res.ok) {
        if (action.id !== undefined) {
          await removePendingAction(action.id);
        }
        syncedCount++;
        if (onProgress) {
          onProgress(syncedCount, actions.length - syncedCount);
        }
      } else {
        // Stop syncing if server returned an error (might still be offline or invalid payload)
        console.warn('Sync failed for item:', action, await res.text());
        break;
      }
    } catch (err) {
      console.warn('Netzwerkfehler beim Synchronisieren:', err);
      break; // Still offline
    }
  }

  return syncedCount;
}

// Local cache for dashboard stats
const DASHBOARD_CACHE_KEY = 'phev_cached_dashboard_stats';

export function saveCachedDashboard(data: any): void {
  try {
    localStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify(data));
  } catch {
    // Ignore localStorage write error
  }
}

export function getCachedDashboard(): any | null {
  try {
    const data = localStorage.getItem(DASHBOARD_CACHE_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}
