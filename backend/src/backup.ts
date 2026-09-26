import { createBackup } from './db.js';
import { DB_PATH, BACKUP_DIR, BACKUP_RETENTION_DAYS } from './config.js';

console.log('📦 PHEV-Tracker - Backup wird ausgeführt...');
console.log(`- Quelldatenbank: ${DB_PATH}`);
console.log(`- Backup-Ziel:    ${BACKUP_DIR}`);
console.log(`- Vorhaltezeit:   ${BACKUP_RETENTION_DAYS} Tage`);

try {
  const result = createBackup();
  console.log(`✅ Backup erfolgreich erstellt:\n  -> ${result}`);
  process.exit(0);
} catch (err: any) {
  console.error(`❌ Fehler beim Backup: ${err.message}`);
  process.exit(1);
}
