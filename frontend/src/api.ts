import { queueOfflineAction } from './offlineStore';

export interface Vehicle {
  id: number;
  name: string;
  marke: string;
  modell: string;
  batterie_kapazitaet_kwh: number;
  tank_kapazitaet_l: number;
  default_ev_kwh_per_100km: number;
  default_fuel_l_per_100km: number;
}

export interface ChargingSession {
  id: number;
  vehicle_id: number;
  zeitpunkt: string;
  kwh: number;
  preis_pro_kwh: number;
  gesamtkosten: number;
  quelle: string;
  odometer_km: number | null;
  ev_km: number | null;
  standort: string;
  bemerkung: string;
}

export interface FuelSession {
  id: number;
  vehicle_id: number;
  zeitpunkt: string;
  liter: number;
  preis_pro_liter: number;
  gesamtkosten: number;
  tankstelle: string;
  odometer_km: number | null;
  fuel_km: number | null;
  vollgetankt: number;
  bemerkung: string;
}

export interface VehicleSnapshot {
  id: number;
  vehicle_id: number;
  zeitpunkt: string;
  odometer_km: number;
  ev_range_km: number | null;
  fuel_range_km: number | null;
  ev_odometer_km: number | null;
  soc_percent: number | null;
  quelle: string;
}

export interface Tariff {
  id: number;
  quelle: string;
  bezeichnung: string;
  gueltig_ab: string;
  preis_pro_kwh: number;
  grundgebuehr_monat: number;
}

export interface DashboardStats {
  vehicle: Vehicle;
  evMetrics: {
    totalKwh: number;
    totalCost: number;
    totalEvKm: number;
    kwhPer100Km: number;
    costPerKm: number;
    costPer100Km: number;
    isEstimate: boolean;
  };
  fuelMetrics: {
    totalLiter: number;
    totalCost: number;
    totalFuelKm: number;
    literPer100Km: number;
    costPerKm: number;
    costPer100Km: number;
    isEstimate: boolean;
  };
  breakEven: {
    breakEvenElectricityPricePerKwh: number;
    costPer100KmEv: number;
    costPer100KmFuel: number;
    savingsPer100Km: number;
    savingsPerKm: number;
    isEvCheaper: boolean;
    evKwhPer100Km: number;
    fuelLiterPer100Km: number;
    fuelPricePerLiter: number;
    electricityPricePerKwh: number;
  };
  sessionsCount: {
    charging: number;
    fuel: number;
  };
  latestSnapshot: VehicleSnapshot | null;
}

const API_BASE = '/api';

export async function fetchDashboardStats(vehicleId: number = 1): Promise<DashboardStats> {
  const res = await fetch(`${API_BASE}/dashboard/stats?vehicleId=${vehicleId}`);
  if (!res.ok) throw new Error('Fehler beim Laden der Dashboard-Daten');
  return res.json();
}

export async function fetchVehicles(): Promise<Vehicle[]> {
  const res = await fetch(`${API_BASE}/vehicles`);
  if (!res.ok) throw new Error('Fehler beim Laden der Fahrzeuge');
  return res.json();
}

export async function fetchChargingSessions(vehicleId: number = 1): Promise<ChargingSession[]> {
  const res = await fetch(`${API_BASE}/sessions/charging?vehicleId=${vehicleId}`);
  if (!res.ok) throw new Error('Fehler beim Laden der Ladevorgänge');
  return res.json();
}

export async function fetchFuelSessions(vehicleId: number = 1): Promise<FuelSession[]> {
  const res = await fetch(`${API_BASE}/sessions/fuel?vehicleId=${vehicleId}`);
  if (!res.ok) throw new Error('Fehler beim Laden der Tankvorgänge');
  return res.json();
}

export async function fetchSnapshots(vehicleId: number = 1): Promise<VehicleSnapshot[]> {
  const res = await fetch(`${API_BASE}/snapshots?vehicleId=${vehicleId}`);
  if (!res.ok) throw new Error('Fehler beim Laden der Snapshots');
  return res.json();
}

export async function fetchTariffs(): Promise<Tariff[]> {
  const res = await fetch(`${API_BASE}/tariffs`);
  if (!res.ok) throw new Error('Fehler beim Laden der Tarife');
  return res.json();
}

/**
 * Creates a charging session. If offline, stores to IndexedDB for sync.
 */
export async function createChargingSession(data: any): Promise<{ offline?: boolean }> {
  try {
    const res = await fetch(`${API_BASE}/sessions/charging`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Netzwerkfehler' }));
      throw new Error(err.error || 'Fehler beim Speichern');
    }
    return { offline: false };
  } catch (err: any) {
    if (!navigator.onLine || err.message.includes('Failed to fetch') || err.name === 'TypeError') {
      await queueOfflineAction({
        endpoint: `${API_BASE}/sessions/charging`,
        method: 'POST',
        payload: data,
        label: `Ladevorgang (${data.kwh} kWh)`,
      });
      return { offline: true };
    }
    throw err;
  }
}

/**
 * Creates a fuel session. If offline, stores to IndexedDB for sync.
 */
export async function createFuelSession(data: any): Promise<{ offline?: boolean }> {
  try {
    const res = await fetch(`${API_BASE}/sessions/fuel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Netzwerkfehler' }));
      throw new Error(err.error || 'Fehler beim Speichern');
    }
    return { offline: false };
  } catch (err: any) {
    if (!navigator.onLine || err.message.includes('Failed to fetch') || err.name === 'TypeError') {
      await queueOfflineAction({
        endpoint: `${API_BASE}/sessions/fuel`,
        method: 'POST',
        payload: data,
        label: `Tankvorgang (${data.liter} L)`,
      });
      return { offline: true };
    }
    throw err;
  }
}

/**
 * Creates a snapshot. If offline, stores to IndexedDB.
 */
export async function createSnapshot(data: any): Promise<{ offline?: boolean }> {
  try {
    const res = await fetch(`${API_BASE}/snapshots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Netzwerkfehler' }));
      throw new Error(err.error || 'Fehler beim Speichern');
    }
    return { offline: false };
  } catch (err: any) {
    if (!navigator.onLine || err.message.includes('Failed to fetch') || err.name === 'TypeError') {
      await queueOfflineAction({
        endpoint: `${API_BASE}/snapshots`,
        method: 'POST',
        payload: data,
        label: `Snapshot (${data.odometer_km} km)`,
      });
      return { offline: true };
    }
    throw err;
  }
}

export async function deleteChargingSession(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/sessions/charging/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Fehler beim Löschen des Ladevorgangs');
}

export async function deleteFuelSession(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/sessions/fuel/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Fehler beim Löschen des Tankvorgangs');
}

export async function deleteSnapshot(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/snapshots/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Fehler beim Löschen des Snapshots');
}

export async function createTariff(data: any): Promise<void> {
  const res = await fetch(`${API_BASE}/tariffs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Fehler' }));
    throw new Error(err.error || 'Fehler beim Speichern des Tarifs');
  }
}

export async function deleteTariff(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/tariffs/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Fehler beim Löschen des Tarifs');
}

export async function triggerBackup(): Promise<string> {
  const res = await fetch(`${API_BASE}/backup`, { method: 'POST' });
  if (!res.ok) throw new Error('Backup fehlgeschlagen');
  const data = await res.json();
  return data.file;
}

export interface KiaStatus {
  configured: boolean;
  username: string | null;
  rawUsername?: string;
  region?: number;
  brand?: number;
  forceRefresh?: boolean;
  error?: string;
}

export async function getKiaStatus(): Promise<KiaStatus> {
  const res = await fetch(`${API_BASE}/kia/status`);
  if (!res.ok) throw new Error('Fehler beim Abrufen des Kia-Status');
  return res.json();
}

export async function saveKiaConfig(config: {
  username: string;
  password?: string;
  pin?: string;
  region?: number;
  brand?: number;
  force_refresh?: boolean;
}): Promise<{ message: string; configured: boolean }> {
  const res = await fetch(`${API_BASE}/kia/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Fehler beim Speichern' }));
    throw new Error(err.error || 'Fehler beim Speichern der Kia-Konfiguration');
  }
  return res.json();
}

export async function syncKiaConnect(force: boolean = false): Promise<any> {
  const res = await fetch(`${API_BASE}/kia/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Kia Connect Sync fehlgeschlagen');
  }
  return data;
}

