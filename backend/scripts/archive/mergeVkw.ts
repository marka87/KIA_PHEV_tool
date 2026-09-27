// Einmalige historische Datenmigration, archiviert am 2026-09-27. Nur manuell mit ts-node ausführbar, kein Teil des laufenden Betriebs.

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.resolve(__dirname, '../data/phev.db');

const db = new DatabaseSync(dbPath);

interface VkwRow {
  beginn: string; // 'DD.MM.YYYY HH:MM:SS'
  dauer: string;
  ort: string;
  kostenNetto: number;
  kostenBrutto: number;
  kwh: number;
  stationsName: string;
}

const vkwRaw = `26.09.2026 13:26:40;00:22:55;LustenauerstraÃŸe 107a, 6845 Hohenems;0,471;0,565;1,261;EUROSPAR Hohenems
17.09.2026 16:37:28;01:23:04;SchweizerstraÃŸe 59, 6845 Hohenems;1,801;2,161;4,824;Collini GmbH
04.09.2026 12:00:12;02:32:17;SchweizerstraÃŸe 59, 6845 Hohenems;2,94;3,528;7,876;Collini GmbH
29.08.2026 10:28:47;00:35:33;MessestraÃŸe 2, 6850 Dornbirn;0,763;0,916;2,044;Messepark Dornbirn
28.08.2026 11:46:12;02:14:22;SchweizerstraÃŸe 59, 6845 Hohenems;2,689;3,227;7,204;Collini GmbH
22.08.2026 14:55:46;00:33:46;LustenauerstraÃŸe 107a, 6845 Hohenems;0,719;0,862;1,925;EUROSPAR Hohenems
31.07.2026 15:11:27;00:49:49;LustenauerstraÃŸe 107a, 6845 Hohenems;1,058;1,27;2,835;EUROSPAR Hohenems
28.07.2026 16:59:59;02:24:20;SchweizerstraÃŸe 59, 6845 Hohenems;2,368;2,842;6,344;Collini GmbH
16.07.2026 18:35:34;01:04:34;SchweizerstraÃŸe 59, 6845 Hohenems;1,395;1,674;3,737;Collini GmbH
10.07.2026 16:11:30;02:06:38;SchweizerstraÃŸe 59, 6845 Hohenems;2,639;3,167;7,07;Collini GmbH
10.07.2026 14:47:51;00:30:48;LustenauerstraÃŸe 107a, 6845 Hohenems;0,641;0,769;1,716;EUROSPAR Hohenems
19.06.2026 12:18:41;02:17:18;SchweizerstraÃŸe 59, 6845 Hohenems;2,824;3,389;7,565;Collini GmbH
19.06.2026 10:44:16;00:41:54;LustenauerstraÃŸe 107a, 6845 Hohenems;0,311;0,373;0,832;EUROSPAR Hohenems
18.06.2026 14:35:06;00:30:42;LustenauerstraÃŸe 107a, 6845 Hohenems;0,649;0,779;1,738;EUROSPAR Hohenems
16.06.2026 16:54:45;00:43:27;Pfarrweg 4x, 6890 Lustenau;0,89;1,068;2,384;Kirche St. Peter und Paul
12.06.2026 12:17:25;02:52:13;SchweizerstraÃŸe 59, 6845 Hohenems;3,004;3,605;8,048;Collini GmbH
11.06.2026 18:27:56;02:15:33;SchweizerstraÃŸe 59, 6845 Hohenems;2,76;3,312;7,393;Collini GmbH
11.06.2026 10:27:57;00:22:57;Pfarrweg 4x, 6890 Lustenau;0,471;0,565;1,262;Kirche St. Peter und Paul
05.06.2026 13:08:04;00:16:21;LustenauerstraÃŸe 107a, 6845 Hohenems;0,342;0,41;0,915;EUROSPAR Hohenems
05.06.2026 11:27:24;00:52:56;BahnhofstraÃŸe 14,16,18,20,36,40, 6800 Feldkirch;1,142;1,371;3,06;FB Bahnhofcity Feldkirch
03.06.2026 16:04:50;00:10:35;LustenauerstraÃŸe 107a, 6845 Hohenems;0,22;0,264;0,588;EUROSPAR Hohenems
01.06.2026 17:36:20;02:00:24;SchweizerstraÃŸe 59, 6845 Hohenems;2,574;3,088;6,894;Collini GmbH
16.05.2026 15:39:54;00:38:12;BahnhofstraÃŸe 14,16,18,20,36,40, 6800 Feldkirch;0,803;0,964;2,151;FB Bahnhofcity Feldkirch
15.05.2026 13:49:10;02:15:11;SchweizerstraÃŸe 59, 6845 Hohenems;2,855;3,426;7,649;Collini GmbH`;

function parseDeFloat(str: string): number {
  return parseFloat(str.replace(',', '.'));
}

function parseVkwDate(str: string): string {
  // '26.09.2026 13:26:40' -> '2026-09-26T13:26:40'
  const [datePart, timePart] = str.split(' ');
  const [d, m, y] = datePart.split('.');
  return `${y}-${m}-${d}T${timePart}`;
}

const vkwItems: VkwRow[] = vkwRaw
  .trim()
  .split('\n')
  .map((line) => {
    const p = line.split(';');
    return {
      beginn: p[0],
      dauer: p[1],
      ort: p[2],
      kostenNetto: parseDeFloat(p[3]),
      kostenBrutto: parseDeFloat(p[4]),
      kwh: parseDeFloat(p[5]),
      stationsName: p[6],
    };
  })
  .filter((r) => r.kwh > 0)
  .sort((a, b) => {
    const ta = new Date(parseVkwDate(a.beginn)).getTime();
    const tb = new Date(parseVkwDate(b.beginn)).getTime();
    return ta - tb;
  });

console.log(`GÃ¼ltige VKW LadevorgÃ¤nge mit > 0 kWh: ${vkwItems.length}`);

// Get existing charging sessions
const existingCharging = db.prepare('SELECT * FROM charging_sessions').all() as any[];

// Keep home charges intact
const homeCharges = existingCharging.filter((c) => c.quelle === 'zuhause');
console.log(`Bestehende Heimladungen: ${homeCharges.length} (bleiben unverÃ¤ndert)`);

// Delete old public charges and replace with exact VKW data
db.exec("DELETE FROM charging_sessions WHERE quelle != 'zuhause'");

const insertStmt = db.prepare(`
  INSERT INTO charging_sessions (
    vehicle_id, zeitpunkt, kwh, preis_pro_kwh, gesamtkosten, quelle, odometer_km, ev_km, standort, bemerkung
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

let insertedVkw = 0;
for (const vkw of vkwItems) {
  const iso = parseVkwDate(vkw.beginn);
  const unitPrice = Math.round((vkw.kostenBrutto / vkw.kwh + 1e-9) * 1000) / 1000;
  const standortFull = `${vkw.stationsName}, ${vkw.ort.split(',')[1]?.trim() || vkw.ort}`;
  const bemerkung = `VKW Ladekarte (Dauer: ${vkw.dauer})`;

  insertStmt.run(
    1,
    iso,
    Math.round(vkw.kwh * 100) / 100,
    unitPrice,
    Math.round(vkw.kostenBrutto * 100) / 100,
    'vkw',
    null,
    null,
    standortFull,
    bemerkung
  );
  insertedVkw++;
}

console.log(`âœ… ${insertedVkw} VKW-LadevorgÃ¤nge mit genauen Standorten und Uhrzeiten eingepflegt!`);

const totalCharging = db.prepare('SELECT COUNT(*) as count FROM charging_sessions').get() as { count: number };
const totalFuel = db.prepare('SELECT COUNT(*) as count FROM fuel_sessions').get() as { count: number };
console.log(`Aktueller Stand in DB: ${totalCharging.count} LadevorgÃ¤nge (12 Zuhause + ${insertedVkw} VKW), ${totalFuel.count} Tankungen.`);

