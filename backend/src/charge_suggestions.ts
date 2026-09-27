import { db, getTariffForSource } from './db.js';
import { logger } from './logger.js';
import { parseLocaleNumber } from './calculations.js';

export const MIN_SOC_INCREASE_THRESHOLD_PERCENT = 3.0;

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

export interface ConfirmSuggestionInput {
  preis_pro_kwh?: number | string;
  quelle?: string;
  kwh?: number | string;
  zeitpunkt?: string;
  odometer_km?: number | string;
  standort?: string;
  bemerkung?: string;
}

/**
 * Checks if a new snapshot indicates an unlogged charging event.
 * If SoC increased >= MIN_SOC_INCREASE_THRESHOLD_PERCENT (3%) and no matching
 * charging session exists in the interval, creates a pending suggestion.
 */
export function checkAndCreateChargeSuggestion(
  newSnapshotId: number,
  customDb: any = db
): ChargeSuggestion | null {
  const newSnapshot = customDb
    .prepare('SELECT * FROM vehicle_snapshots WHERE id = ?')
    .get(newSnapshotId) as any;

  if (!newSnapshot || newSnapshot.soc_percent === null || newSnapshot.soc_percent === undefined) {
    return null;
  }

  // Find previous snapshot with valid soc_percent for the same vehicle
  const prevSnapshot = customDb
    .prepare(
      `SELECT * FROM vehicle_snapshots 
       WHERE vehicle_id = ? AND id < ? AND soc_percent IS NOT NULL 
       ORDER BY id DESC LIMIT 1`
    )
    .get(newSnapshot.vehicle_id, newSnapshot.id) as any;

  if (!prevSnapshot) {
    return null;
  }

  const fromSoc = Number(prevSnapshot.soc_percent);
  const toSoc = Number(newSnapshot.soc_percent);
  const socDiff = Math.round((toSoc - fromSoc) * 10) / 10;

  // Only consider SoC increases >= 3% (filter out sensor drift / micro-recuperation)
  if (socDiff < MIN_SOC_INCREASE_THRESHOLD_PERCENT) {
    return null;
  }

  // Prevent duplicate suggestions for the same to_snapshot
  const existingSuggestion = customDb
    .prepare('SELECT id FROM pending_charge_suggestions WHERE to_snapshot_id = ?')
    .get(newSnapshot.id) as any;

  if (existingSuggestion) {
    return null;
  }

  // Check if a charging session already covers this time window (+/- 30 minutes tolerance)
  const fromTime = new Date(prevSnapshot.zeitpunkt).getTime() - 30 * 60 * 1000;
  const toTime = new Date(newSnapshot.zeitpunkt).getTime() + 30 * 60 * 1000;

  const candidateSessions = customDb
    .prepare(
      'SELECT id, zeitpunkt, kwh FROM charging_sessions WHERE vehicle_id = ?'
    )
    .all(newSnapshot.vehicle_id) as Array<{ id: number; zeitpunkt: string; kwh: number }>;

  const hasMatchingSession = candidateSessions.some((s) => {
    const sTime = new Date(s.zeitpunkt).getTime();
    return sTime >= fromTime && sTime <= toTime;
  });

  if (hasMatchingSession) {
    logger.debug(
      `[ChargeSuggestions] SoC Anstieg (+${socDiff}%) ignoriert, da bereits eine Ladesitzung im Zeitraum existiert.`
    );
    return null;
  }

  // Get battery capacity from vehicle record (default: 8.9 kWh for Ceed SW PHEV)
  const vehicle = customDb
    .prepare('SELECT batterie_kapazitaet_kwh FROM vehicles WHERE id = ?')
    .get(newSnapshot.vehicle_id) as any;
  const batteryCapacity = Number(vehicle?.batterie_kapazitaet_kwh) || 8.9;

  // Estimated kWh = (SoC diff / 100) * battery capacity
  const estimatedKwh = Math.round(((socDiff / 100) * batteryCapacity) * 100) / 100;

  const insertStmt = customDb.prepare(`
    INSERT INTO pending_charge_suggestions (
      vehicle_id, from_snapshot_id, to_snapshot_id, from_zeitpunkt, to_zeitpunkt,
      from_soc_percent, to_soc_percent, soc_diff_percent, estimated_kwh, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `);

  const result = insertStmt.run(
    newSnapshot.vehicle_id,
    prevSnapshot.id,
    newSnapshot.id,
    prevSnapshot.zeitpunkt,
    newSnapshot.zeitpunkt,
    fromSoc,
    toSoc,
    socDiff,
    estimatedKwh
  );

  logger.info(
    `[ChargeSuggestions] Neuer ungeloggter Ladevorgang erkannt: SoC von ${fromSoc}% auf ${toSoc}% (+${socDiff}%), geschätzt ${estimatedKwh} kWh.`
  );

  return customDb
    .prepare('SELECT * FROM pending_charge_suggestions WHERE id = ?')
    .get(result.lastInsertRowid) as ChargeSuggestion;
}

/**
 * Returns all open (pending) suggestions.
 */
export function getPendingSuggestions(
  vehicleId?: number,
  customDb: any = db
): ChargeSuggestion[] {
  if (vehicleId) {
    return customDb
      .prepare(
        `SELECT * FROM pending_charge_suggestions 
         WHERE status = 'pending' AND vehicle_id = ? 
         ORDER BY to_zeitpunkt DESC, id DESC`
      )
      .all(vehicleId) as ChargeSuggestion[];
  }

  return customDb
    .prepare(
      `SELECT * FROM pending_charge_suggestions 
       WHERE status = 'pending' 
       ORDER BY to_zeitpunkt DESC, id DESC`
    )
    .all() as ChargeSuggestion[];
}

/**
 * Confirms a pending charge suggestion, creates the real charging_session,
 * and updates the suggestion status to 'confirmed'.
 */
export function confirmSuggestion(
  suggestionId: number,
  input: ConfirmSuggestionInput,
  customDb: any = db
) {
  const suggestion = customDb
    .prepare('SELECT * FROM pending_charge_suggestions WHERE id = ?')
    .get(suggestionId) as ChargeSuggestion | undefined;

  if (!suggestion) {
    throw new Error('Ladevorschlag nicht gefunden');
  }

  if (suggestion.status !== 'pending') {
    throw new Error(`Ladevorschlag wurde bereits bearbeitet (Status: ${suggestion.status})`);
  }

  const quelle = input.quelle || 'zuhause';
  const zeitpunkt = input.zeitpunkt || suggestion.to_zeitpunkt;

  let preisProKwh: number;
  if (input.preis_pro_kwh !== undefined && input.preis_pro_kwh !== null && input.preis_pro_kwh !== '') {
    preisProKwh = parseLocaleNumber(input.preis_pro_kwh);
  } else {
    // If not supplied, fallback to tariff for source or default 0.28
    const tariffPrice = getTariffForSource(quelle, zeitpunkt);
    preisProKwh = tariffPrice !== null ? tariffPrice : 0.28;
  }

  const kwh = input.kwh !== undefined && input.kwh !== null && input.kwh !== ''
    ? parseLocaleNumber(input.kwh)
    : suggestion.estimated_kwh;

  const gesamtkosten = Math.round(kwh * preisProKwh * 100) / 100;

  // Retrieve odometer from to_snapshot if not explicitly supplied
  let odometerKm = input.odometer_km !== undefined && input.odometer_km !== null && input.odometer_km !== ''
    ? parseLocaleNumber(input.odometer_km)
    : null;

  if (odometerKm === null && suggestion.to_snapshot_id) {
    const snap = customDb
      .prepare('SELECT odometer_km FROM vehicle_snapshots WHERE id = ?')
      .get(suggestion.to_snapshot_id) as any;
    if (snap?.odometer_km) {
      odometerKm = snap.odometer_km;
    }
  }

  const bemerkung = input.bemerkung || `Automatisch erkannt aus Kia-Sync (+${suggestion.soc_diff_percent}% SoC)`;

  const insertSessionStmt = customDb.prepare(`
    INSERT INTO charging_sessions (
      vehicle_id, zeitpunkt, kwh, preis_pro_kwh, gesamtkosten, quelle, odometer_km, standort, bemerkung
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const sessionResult = insertSessionStmt.run(
    suggestion.vehicle_id,
    zeitpunkt,
    kwh,
    preisProKwh,
    gesamtkosten,
    input.quelle,
    odometerKm,
    input.standort || null,
    bemerkung
  );

  const sessionId = Number(sessionResult.lastInsertRowid);

  // Update suggestion status
  customDb
    .prepare(
      `UPDATE pending_charge_suggestions 
       SET status = 'confirmed', charging_session_id = ? 
       WHERE id = ?`
    )
    .run(sessionId, suggestionId);

  const createdSession = customDb
    .prepare('SELECT * FROM charging_sessions WHERE id = ?')
    .get(sessionId);

  logger.info(
    `[ChargeSuggestions] Vorschlag #${suggestionId} bestätigt: Ladesitzung #${sessionId} mit ${kwh} kWh für ${gesamtkosten} € angelegt.`
  );

  return {
    success: true,
    charging_session: createdSession,
    suggestion_id: suggestionId,
  };
}

/**
 * Dismisses a pending charge suggestion without creating a charging session.
 */
export function dismissSuggestion(suggestionId: number, customDb: any = db) {
  const suggestion = customDb
    .prepare('SELECT * FROM pending_charge_suggestions WHERE id = ?')
    .get(suggestionId) as ChargeSuggestion | undefined;

  if (!suggestion) {
    throw new Error('Ladevorschlag nicht gefunden');
  }

  customDb
    .prepare("UPDATE pending_charge_suggestions SET status = 'dismissed' WHERE id = ?")
    .run(suggestionId);

  logger.info(`[ChargeSuggestions] Vorschlag #${suggestionId} verworfen.`);

  return {
    success: true,
    message: 'Ladevorschlag verworfen',
    suggestion_id: suggestionId,
  };
}
