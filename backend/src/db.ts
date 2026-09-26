import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { DB_PATH, BACKUP_DIR, BACKUP_RETENTION_DAYS } from './config.js';

const dbDir = path.dirname(DB_PATH);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

export const db = new DatabaseSync(DB_PATH);

// Initialize PRAGMAs
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
`);

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      marke TEXT NOT NULL DEFAULT 'Kia',
      modell TEXT NOT NULL DEFAULT 'Ceed SW PHEV',
      batterie_kapazitaet_kwh REAL NOT NULL DEFAULT 8.9,
      tank_kapazitaet_l REAL NOT NULL DEFAULT 37.0,
      default_ev_kwh_per_100km REAL NOT NULL DEFAULT 16.0,
      default_fuel_l_per_100km REAL NOT NULL DEFAULT 5.5,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tariffs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quelle TEXT NOT NULL,
      bezeichnung TEXT NOT NULL,
      gueltig_ab TEXT NOT NULL,
      preis_pro_kwh REAL NOT NULL,
      grundgebuehr_monat REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS charging_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      zeitpunkt TEXT NOT NULL,
      kwh REAL NOT NULL,
      preis_pro_kwh REAL NOT NULL,
      gesamtkosten REAL NOT NULL,
      quelle TEXT NOT NULL,
      odometer_km REAL,
      ev_km REAL,
      standort TEXT,
      bemerkung TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS fuel_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      zeitpunkt TEXT NOT NULL,
      liter REAL NOT NULL,
      preis_pro_liter REAL NOT NULL,
      gesamtkosten REAL NOT NULL,
      tankstelle TEXT NOT NULL,
      odometer_km REAL,
      fuel_km REAL,
      vollgetankt INTEGER NOT NULL DEFAULT 1,
      bemerkung TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS vehicle_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      zeitpunkt TEXT NOT NULL,
      odometer_km REAL NOT NULL,
      ev_range_km REAL,
      fuel_range_km REAL,
      ev_odometer_km REAL,
      soc_percent REAL,
      quelle TEXT NOT NULL DEFAULT 'manuell',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_charging_sessions_vehicle ON charging_sessions(vehicle_id, zeitpunkt);
    CREATE INDEX IF NOT EXISTS idx_fuel_sessions_vehicle ON fuel_sessions(vehicle_id, zeitpunkt);
    CREATE INDEX IF NOT EXISTS idx_snapshots_vehicle ON vehicle_snapshots(vehicle_id, zeitpunkt);
    CREATE INDEX IF NOT EXISTS idx_tariffs_lookup ON tariffs(quelle, gueltig_ab);
  `);

  // Seed default vehicle if none exists
  const vehicleCountRow = db.prepare('SELECT COUNT(*) as count FROM vehicles').get() as { count: number };
  if (vehicleCountRow.count === 0) {
    db.prepare(`
      INSERT INTO vehicles (id, name, marke, modell, batterie_kapazitaet_kwh, tank_kapazitaet_l, default_ev_kwh_per_100km, default_fuel_l_per_100km)
      VALUES (1, 'Kia Ceed SW PHEV', 'Kia', 'Ceed SW PHEV', 8.9, 37.0, 16.0, 5.5)
    `).run();
  }

  // Seed standard tariffs if none exist
  const tariffCountRow = db.prepare('SELECT COUNT(*) as count FROM tariffs').get() as { count: number };
  if (tariffCountRow.count === 0) {
    const insertTariff = db.prepare(`
      INSERT INTO tariffs (quelle, bezeichnung, gueltig_ab, preis_pro_kwh, grundgebuehr_monat)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertTariff.run('zuhause', 'Haushaltsstrom zu Hause', '2024-01-01', 0.28, 0);
    insertTariff.run('vkw', 'VKW / vlotte Ladekarte', '2024-01-01', 0.39, 0);
    insertTariff.run('enbw', 'EnBW mobility+ Standard', '2024-01-01', 0.59, 0);
  }
}

/**
 * Resolves active electricity price for a given source and date.
 */
export function getTariffForSource(quelle: string, zeitpunkt: string): number | null {
  const dateStr = zeitpunkt.slice(0, 10); // 'YYYY-MM-DD'
  const row = db.prepare(`
    SELECT preis_pro_kwh FROM tariffs
    WHERE LOWER(quelle) = LOWER(?) AND gueltig_ab <= ?
    ORDER BY gueltig_ab DESC
    LIMIT 1
  `).get(quelle, dateStr) as { preis_pro_kwh: number } | undefined;

  return row ? row.preis_pro_kwh : null;
}

/**
 * Creates a backup copy of the database and purges backups older than 30 days.
 */
export function createBackup(): string {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  const backupFileName = `phev_backup_${dateStr}_${Date.now()}.db`;
  const targetPath = path.resolve(BACKUP_DIR, backupFileName);

  // Safely copy DB file
  fs.copyFileSync(DB_PATH, targetPath);

  // Purge old backups older than BACKUP_RETENTION_DAYS
  const files = fs.readdirSync(BACKUP_DIR);
  const retentionMs = BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const cutoffTime = Date.now() - retentionMs;

  for (const file of files) {
    if (file.startsWith('phev_backup_') && file.endsWith('.db')) {
      const filePath = path.resolve(BACKUP_DIR, file);
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < cutoffTime) {
        fs.unlinkSync(filePath);
      }
    }
  }

  return targetPath;
}
