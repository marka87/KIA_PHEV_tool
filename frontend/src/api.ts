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
  car_12v_percent?: number | null;
  is_charging?: number | boolean | null;
  is_plugged_in?: number | boolean | null;
  is_locked?: number | boolean | null;
  doors_open_json?: string | null;
  windows_open_json?: string | null;
  climate_status_json?: string | null;
  charge_remaining_min?: number | null;
  charge_port_open?: number | boolean | null;
  location_lat?: number | null;
  location_lon?: number | null;
  tire_pressure_warning?: number | boolean | null;
  washer_fluid_warning?: number | boolean | null;
  smart_key_warning?: number | boolean | null;
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

export interface BreakEvenSettings {
  electricityPricePerKwh: number | null;
  fuelPricePerLiter: number | null;
}

export async function fetchBreakEvenSettings(vehicleId: number = 1): Promise<BreakEvenSettings> {
  const res = await fetch(`${API_BASE}/settings/break-even?vehicleId=${vehicleId}`);
  if (!res.ok) throw new Error('Fehler beim Laden der Break-Even-Einstellungen');
  return res.json();
}

export async function saveBreakEvenSettings(
  electricityPricePerKwh: number,
  fuelPricePerLiter: number,
  vehicleId: number = 1,
): Promise<void> {
  const res = await fetch(`${API_BASE}/settings/break-even`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vehicleId, electricityPricePerKwh, fuelPricePerLiter }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Fehler beim Speichern der Break-Even-Einstellungen' }));
    throw new Error(error.error);
  }
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

async function postWithOfflineQueue<T>(url: string, payload: T, label: string): Promise<{ offline: boolean }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Netzwerkfehler' }));
      throw new Error(err.error || 'Fehler beim Speichern');
    }
    return { offline: false };
  } catch (err: any) {
    if (!navigator.onLine || err.message.includes('Failed to fetch') || err.name === 'TypeError') {
      await queueOfflineAction({
        endpoint: url,
        method: 'POST',
        payload,
        label,
      });
      return { offline: true };
    }
    throw err;
  }
}

export function createChargingSession<T>(data: T): Promise<{ offline: boolean }> {
  return postWithOfflineQueue(
    `${API_BASE}/sessions/charging`,
    data,
    `Ladevorgang (${(data as { kwh?: unknown }).kwh} kWh)`,
  );
}

export function createFuelSession<T>(data: T): Promise<{ offline: boolean }> {
  return postWithOfflineQueue(
    `${API_BASE}/sessions/fuel`,
    data,
    `Tankvorgang (${(data as { liter?: unknown }).liter} L)`,
  );
}

export function createSnapshot<T>(data: T): Promise<{ offline: boolean }> {
  return postWithOfflineQueue(
    `${API_BASE}/snapshots`,
    data,
    `Snapshot (${(data as { odometer_km?: unknown }).odometer_km} km)`,
  );
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

export interface KiaControlPayload {
  action: 'lock' | 'unlock' | 'start_climate' | 'stop_climate' | 'start_charge' | 'stop_charge';
  temp?: number;
  duration?: number;
  defrost?: boolean;
  steering_wheel?: boolean;
}

export async function sendKiaRemoteControl(payload: KiaControlPayload): Promise<{ success: boolean; message: string; action: string; api_result?: string }> {
  const res = await fetch(`${API_BASE}/kia/control`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || `Remote-Befehl '${payload.action}' fehlgeschlagen`);
  }
  return data;
}

export interface ChargeSuggestion {
  id: number;
  vehicle_id: number;
  from_snapshot_id: number | null;
  to_snapshot_id: number | null;
  from_zeitpunkt: string;
  to_zeitpunkt: string;
  from_soc_percent: number;
  to_soc_percent: number;
  soc_diff_percent: number;
  estimated_kwh: number;
  status: 'pending' | 'confirmed' | 'dismissed';
  charging_session_id: number | null;
  created_at: string;
}

export async function fetchPendingChargeSuggestions(vehicleId: number = 1): Promise<ChargeSuggestion[]> {
  const res = await fetch(`${API_BASE}/charge-suggestions/pending?vehicleId=${vehicleId}`);
  if (!res.ok) throw new Error('Fehler beim Abrufen offener Ladevorschläge');
  return res.json();
}

export async function confirmChargeSuggestion(
  id: number,
  data: {
    preis_pro_kwh?: number | string;
    quelle?: string;
    kwh?: number | string;
    zeitpunkt?: string;
    odometer_km?: number | string;
    standort?: string;
    bemerkung?: string;
  }
): Promise<{ success: boolean; charging_session: any; suggestion_id: number }> {
  const res = await fetch(`${API_BASE}/charge-suggestions/${id}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Fehler beim Bestätigen des Ladevorschlags' }));
    throw new Error(err.error || 'Fehler beim Bestätigen des Ladevorschlags');
  }
  return res.json();
}

export async function dismissChargeSuggestion(id: number): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/charge-suggestions/${id}/dismiss`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Fehler beim Verwerfen des Ladevorschlags' }));
    throw new Error(err.error || 'Fehler beim Verwerfen des Ladevorschlags');
  }
  return res.json();
}
