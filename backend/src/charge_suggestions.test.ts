import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  MIN_SOC_INCREASE_THRESHOLD_PERCENT,
  checkAndCreateChargeSuggestion,
  getPendingSuggestions,
  confirmSuggestion,
  dismissSuggestion,
} from './charge_suggestions.js';

function createTestDatabase() {
  const memDb = new DatabaseSync(':memory:');
  memDb.exec(`
    CREATE TABLE vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      batterie_kapazitaet_kwh REAL NOT NULL DEFAULT 8.9
    );

    CREATE TABLE vehicle_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL,
      zeitpunkt TEXT NOT NULL,
      odometer_km REAL NOT NULL,
      soc_percent REAL,
      quelle TEXT NOT NULL DEFAULT 'manuell'
    );

    CREATE TABLE charging_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL,
      zeitpunkt TEXT NOT NULL,
      kwh REAL NOT NULL,
      preis_pro_kwh REAL NOT NULL,
      gesamtkosten REAL NOT NULL,
      quelle TEXT NOT NULL,
      odometer_km REAL,
      standort TEXT,
      bemerkung TEXT
    );

    CREATE TABLE tariffs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quelle TEXT NOT NULL,
      bezeichnung TEXT NOT NULL,
      gueltig_ab TEXT NOT NULL,
      preis_pro_kwh REAL NOT NULL,
      grundgebuehr_monat REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE pending_charge_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL,
      from_snapshot_id INTEGER,
      to_snapshot_id INTEGER,
      from_zeitpunkt TEXT NOT NULL,
      to_zeitpunkt TEXT NOT NULL,
      from_soc_percent REAL NOT NULL,
      to_soc_percent REAL NOT NULL,
      soc_diff_percent REAL NOT NULL,
      estimated_kwh REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      charging_session_id INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );

    INSERT INTO vehicles (id, name, batterie_kapazitaet_kwh) VALUES (1, 'Kia Ceed SW PHEV', 8.9);
    INSERT INTO tariffs (quelle, bezeichnung, gueltig_ab, preis_pro_kwh) VALUES ('zuhause', 'Haushalt', '2024-01-01', 0.28);
  `);
  return memDb;
}

test('ChargeSuggestions: Threshold constant is 3.0%', () => {
  assert.equal(MIN_SOC_INCREASE_THRESHOLD_PERCENT, 3.0);
});

test('ChargeSuggestions: SOC steigt über Schwelle (z.B. von 20% auf 80%), keine Ladesession -> Vorschlag wird erzeugt', () => {
  const testDb = createTestDatabase();

  // Snapshot 1: 20% SoC
  testDb.prepare(`
    INSERT INTO vehicle_snapshots (id, vehicle_id, zeitpunkt, odometer_km, soc_percent)
    VALUES (1, 1, '2026-09-27T10:00:00.000Z', 40000, 20.0)
  `).run();

  // Snapshot 2: 80% SoC (+60% SoC)
  testDb.prepare(`
    INSERT INTO vehicle_snapshots (id, vehicle_id, zeitpunkt, odometer_km, soc_percent)
    VALUES (2, 1, '2026-09-27T14:00:00.000Z', 40000, 80.0)
  `).run();

  const suggestion = checkAndCreateChargeSuggestion(2, testDb);
  assert.ok(suggestion, 'Vorschlag sollte erzeugt werden');
  assert.equal(suggestion.from_soc_percent, 20.0);
  assert.equal(suggestion.to_soc_percent, 80.0);
  assert.equal(suggestion.soc_diff_percent, 60.0);
  // 60% of 8.9 kWh = 5.34 kWh
  assert.equal(suggestion.estimated_kwh, 5.34);
  assert.equal(suggestion.status, 'pending');

  const pending = getPendingSuggestions(1, testDb);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, suggestion.id);
});

test('ChargeSuggestions: SOC steigt, aber passende Ladesession existiert bereits -> kein Vorschlag', () => {
  const testDb = createTestDatabase();

  // Snapshot 1: 30% SoC
  testDb.prepare(`
    INSERT INTO vehicle_snapshots (id, vehicle_id, zeitpunkt, odometer_km, soc_percent)
    VALUES (1, 1, '2026-09-27T10:00:00.000Z', 40000, 30.0)
  `).run();

  // Charging session logged at 12:00
  testDb.prepare(`
    INSERT INTO charging_sessions (vehicle_id, zeitpunkt, kwh, preis_pro_kwh, gesamtkosten, quelle)
    VALUES (1, '2026-09-27T12:00:00.000Z', 5.0, 0.30, 1.50, 'zuhause')
  `).run();

  // Snapshot 2: 85% SoC
  testDb.prepare(`
    INSERT INTO vehicle_snapshots (id, vehicle_id, zeitpunkt, odometer_km, soc_percent)
    VALUES (2, 1, '2026-09-27T14:00:00.000Z', 40000, 85.0)
  `).run();

  const suggestion = checkAndCreateChargeSuggestion(2, testDb);
  assert.equal(suggestion, null, 'Sollte keinen Vorschlag erzeugen, da Session bereits vorhanden');

  const pending = getPendingSuggestions(1, testDb);
  assert.equal(pending.length, 0);
});

test('ChargeSuggestions: SOC steigt nur minimal unter Schwelle (< 3%) -> kein Vorschlag', () => {
  const testDb = createTestDatabase();

  // Snapshot 1: 50.0% SoC
  testDb.prepare(`
    INSERT INTO vehicle_snapshots (id, vehicle_id, zeitpunkt, odometer_km, soc_percent)
    VALUES (1, 1, '2026-09-27T10:00:00.000Z', 40000, 50.0)
  `).run();

  // Snapshot 2: 52.0% SoC (+2.0% Anstieg, < 3%)
  testDb.prepare(`
    INSERT INTO vehicle_snapshots (id, vehicle_id, zeitpunkt, odometer_km, soc_percent)
    VALUES (2, 1, '2026-09-27T11:00:00.000Z', 40000, 52.0)
  `).run();

  const suggestion = checkAndCreateChargeSuggestion(2, testDb);
  assert.equal(suggestion, null, 'Unter 3% sollte kein Vorschlag erzeugt werden');

  const pending = getPendingSuggestions(1, testDb);
  assert.equal(pending.length, 0);
});

test('ChargeSuggestions: Bestätigen eines Vorschlags legt korrekt eine charging_session an', () => {
  const testDb = createTestDatabase();

  // Create snapshots and suggestion
  testDb.prepare(`
    INSERT INTO vehicle_snapshots (id, vehicle_id, zeitpunkt, odometer_km, soc_percent)
    VALUES (1, 1, '2026-09-27T10:00:00.000Z', 41000, 20.0)
  `).run();
  testDb.prepare(`
    INSERT INTO vehicle_snapshots (id, vehicle_id, zeitpunkt, odometer_km, soc_percent)
    VALUES (2, 1, '2026-09-27T14:00:00.000Z', 41000, 100.0)
  `).run();

  const suggestion = checkAndCreateChargeSuggestion(2, testDb)!;
  assert.ok(suggestion);
  assert.equal(suggestion.estimated_kwh, 7.12); // 80% of 8.9 kWh

  // Confirm suggestion
  const result = confirmSuggestion(
    suggestion.id,
    {
      preis_pro_kwh: 0.28,
      quelle: 'zuhause',
      standort: 'Garage',
    },
    testDb
  );

  assert.equal(result.success, true);
  const session = result.charging_session as any;
  assert.ok(session);
  assert.equal(session.kwh, 7.12);
  assert.equal(session.preis_pro_kwh, 0.28);
  // 7.12 * 0.28 = 1.99
  assert.equal(session.gesamtkosten, 1.99);
  assert.equal(session.quelle, 'zuhause');
  assert.equal(session.odometer_km, 41000);

  // Status must now be confirmed
  const updatedSuggestion = testDb
    .prepare('SELECT * FROM pending_charge_suggestions WHERE id = ?')
    .get(suggestion.id) as any;
  assert.equal(updatedSuggestion.status, 'confirmed');
  assert.equal(updatedSuggestion.charging_session_id, session.id);

  // Pending list must now be empty
  const pending = getPendingSuggestions(1, testDb);
  assert.equal(pending.length, 0);
});

test('ChargeSuggestions: Verwerfen eines Vorschlags (dismiss) markiert Status als dismissed', () => {
  const testDb = createTestDatabase();

  testDb.prepare(`
    INSERT INTO vehicle_snapshots (id, vehicle_id, zeitpunkt, odometer_km, soc_percent)
    VALUES (1, 1, '2026-09-27T10:00:00.000Z', 41000, 20.0)
  `).run();
  testDb.prepare(`
    INSERT INTO vehicle_snapshots (id, vehicle_id, zeitpunkt, odometer_km, soc_percent)
    VALUES (2, 1, '2026-09-27T14:00:00.000Z', 41000, 70.0)
  `).run();

  const suggestion = checkAndCreateChargeSuggestion(2, testDb)!;
  const dismissResult = dismissSuggestion(suggestion.id, testDb);
  assert.equal(dismissResult.success, true);

  const updated = testDb
    .prepare('SELECT status FROM pending_charge_suggestions WHERE id = ?')
    .get(suggestion.id) as any;
  assert.equal(updated.status, 'dismissed');

  const pending = getPendingSuggestions(1, testDb);
  assert.equal(pending.length, 0);
});
