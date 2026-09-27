// Einmalige historische Datenmigration, archiviert am 2026-09-27. Nur manuell mit ts-node ausführbar, kein Teil des laufenden Betriebs.

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.resolve(__dirname, '../data/phev.db');

const db = new DatabaseSync(dbPath);

interface RawEntry {
  datum: string; // 'DD.MM.YYYY'
  time?: string;
  odometer: number;
  distanz: number | null;
  menge: number;
  type: 'E10' | 'EV';
  eur: number;
}

const entries: RawEntry[] = [
  { datum: '15.05.2026', time: '10:00', odometer: 32829, distanz: null, menge: 7.65, type: 'EV', eur: 3.43 },
  { datum: '30.05.2026', time: '11:00', odometer: 33244, distanz: null, menge: 11.69, type: 'E10', eur: 20.87 },
  { datum: '31.05.2026', time: '16:00', odometer: 33749, distanz: 505.0, menge: 19.96, type: 'E10', eur: 37.31 },
  { datum: '01.06.2026', time: '09:00', odometer: 34291, distanz: 1462.0, menge: 6.89, type: 'EV', eur: 2.57 },
  { datum: '03.06.2026', time: '14:30', odometer: 34376, distanz: 86.0, menge: 0.59, type: 'EV', eur: 0.21 },
  { datum: '04.06.2026', time: '17:00', odometer: 34518, distanz: 769.0, menge: 31.68, type: 'E10', eur: 53.35 },
  { datum: '05.06.2026', time: '08:00', odometer: 34597, distanz: 221.0, menge: 3.06, type: 'EV', eur: 1.37 },
  { datum: '05.06.2026', time: '12:00', odometer: 34617, distanz: 20.0, menge: 0.92, type: 'EV', eur: 0.41 },
  { datum: '05.06.2026', time: '18:00', odometer: 34639, distanz: 22.0, menge: 7.35, type: 'EV', eur: 1.47 },
  { datum: '11.06.2026', time: '09:00', odometer: 34739, distanz: 100.0, menge: 1.26, type: 'EV', eur: 0.56 },
  { datum: '11.06.2026', time: '16:00', odometer: 34755, distanz: 16.0, menge: 7.39, type: 'EV', eur: 3.31 },
  { datum: '12.06.2026', time: '14:00', odometer: 34813, distanz: 58.0, menge: 8.05, type: 'EV', eur: 3.61 },
  { datum: '14.06.2026', time: '15:30', odometer: 35341, distanz: 823.0, menge: 28.56, type: 'E10', eur: 47.64 },
  { datum: '16.06.2026', time: '09:00', odometer: 35382, distanz: 569.0, menge: 2.38, type: 'EV', eur: 1.07 },
  { datum: '16.06.2026', time: '17:00', odometer: 35390, distanz: 8.0, menge: 6.40, type: 'EV', eur: 1.41 },
  { datum: '18.06.2026', time: '13:00', odometer: 35427, distanz: 37.0, menge: 1.74, type: 'EV', eur: 0.78 },
  { datum: '19.06.2026', time: '18:00', odometer: 35497, distanz: 70.0, menge: 7.57, type: 'EV', eur: 3.39 },
  { datum: '22.06.2026', time: '10:00', odometer: 35546, distanz: 49.0, menge: 8.34, type: 'EV', eur: 1.58 },
  { datum: '27.06.2026', time: '11:00', odometer: 35627, distanz: 81.0, menge: 8.72, type: 'EV', eur: 1.66 },
  { datum: '01.07.2026', time: '08:30', odometer: 35710, distanz: 83.0, menge: 8.08, type: 'EV', eur: 1.78 },
  { datum: '04.07.2026', time: '12:00', odometer: 35889, distanz: 179.0, menge: 7.53, type: 'EV', eur: 1.66 },
  { datum: '08.07.2026', time: '15:00', odometer: 36142, distanz: 253.0, menge: 1.51, type: 'EV', eur: 0.29 },
  { datum: '09.07.2026', time: '17:00', odometer: 36158, distanz: 16.0, menge: 8.52, type: 'EV', eur: 1.87 },
  { datum: '10.07.2026', time: '16:00', odometer: 36270, distanz: 112.0, menge: 8.79, type: 'EV', eur: 3.94 },
  { datum: '16.07.2026', time: '14:00', odometer: 36334, distanz: 64.0, menge: 3.74, type: 'EV', eur: 1.67 },
  { datum: '18.07.2026', time: '11:00', odometer: 36391, distanz: 57.0, menge: 8.92, type: 'EV', eur: 1.96 },
  { datum: '21.07.2026', time: '09:00', odometer: 36444, distanz: 53.0, menge: 6.50, type: 'EV', eur: 1.43 },
  { datum: '23.07.2026', time: '16:30', odometer: 36464, distanz: 20.0, menge: 2.40, type: 'EV', eur: 0.53 },
  { datum: '24.07.2026', time: '18:00', odometer: 36522, distanz: 58.0, menge: 8.50, type: 'EV', eur: 1.87 },
  { datum: '25.07.2026', time: '13:00', odometer: 36538, distanz: 1197.0, menge: 29.07, type: 'E10', eur: 54.04 },
  { datum: '06.08.2026', time: '10:00', odometer: 36822, distanz: 284.0, menge: 8.91, type: 'E10', eur: 18.75 },
  { datum: '07.08.2026', time: '16:00', odometer: 37414, distanz: 592.0, menge: 26.43, type: 'E10', eur: 44.56 },
  { datum: '12.08.2026', time: '11:30', odometer: 38235, distanz: 821.0, menge: 29.70, type: 'E10', eur: 46.97 },
  { datum: '21.08.2026', time: '15:00', odometer: 38988, distanz: 753.0, menge: 24.59, type: 'E10', eur: 44.70 },
  { datum: '22.08.2026', time: '17:30', odometer: 39624, distanz: 636.0, menge: 31.21, type: 'E10', eur: 56.15 },
  { datum: '06.09.2026', time: '14:00', odometer: 40461, distanz: 837.0, menge: 27.57, type: 'E10', eur: 61.18 },
  { datum: '13.09.2026', time: '16:00', odometer: 41135, distanz: 674.0, menge: 29.59, type: 'E10', eur: 54.33 },
];

function toIso(datum: string, time: string = '12:00'): string {
  const [d, m, y] = datum.split('.');
  return `${y}-${m}-${d}T${time}:00`;
}

console.log('--- Spritmonitor Import gestartet ---');

// Clear existing tables
db.exec('DELETE FROM charging_sessions;');
db.exec('DELETE FROM fuel_sessions;');

const insertCharging = db.prepare(`
  INSERT INTO charging_sessions (
    vehicle_id, zeitpunkt, kwh, preis_pro_kwh, gesamtkosten, quelle, odometer_km, ev_km, standort, bemerkung
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertFuel = db.prepare(`
  INSERT INTO fuel_sessions (
    vehicle_id, zeitpunkt, liter, preis_pro_liter, gesamtkosten, tankstelle, odometer_km, fuel_km, vollgetankt, bemerkung
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

let countEv = 0;
let countFuel = 0;

for (const entry of entries) {
  const iso = toIso(entry.datum, entry.time);
  if (entry.type === 'EV') {
    const unitPrice = Math.round((entry.eur / entry.menge + 1e-9) * 1000) / 1000;
    const quelle = unitPrice <= 0.25 ? 'zuhause' : 'Ã¶ffentlich';
    insertCharging.run(
      1,
      iso,
      entry.menge,
      unitPrice,
      entry.eur,
      quelle,
      entry.odometer,
      entry.distanz,
      quelle === 'zuhause' ? 'Zuhause' : 'Ã–ffentliche LadesÃ¤ule',
      'Spritmonitor Import'
    );
    countEv++;
  } else {
    const unitPrice = Math.round((entry.eur / entry.menge + 1e-9) * 1000) / 1000;
    insertFuel.run(
      1,
      iso,
      entry.menge,
      unitPrice,
      entry.eur,
      'E10',
      entry.odometer,
      entry.distanz,
      1,
      'Spritmonitor Import'
    );
    countFuel++;
  }
}

console.log(`âœ… Erfolgreich importiert: ${countEv} LadevorgÃ¤nge und ${countFuel} TankvorgÃ¤nge (Gesamt: ${entries.length}).`);

