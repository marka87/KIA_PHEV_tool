import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { db, initDatabase, getTariffForSource, createBackup } from './db.js';
import { PORT, HOST } from './config.js';
import { logger } from './logger.js';
import { basicAuthMiddleware } from './auth.js';
import { encryptString, decryptString } from './crypto.js';
import {
  parseLocaleNumber,
  calculateEvMetrics,
  calculateFuelMetrics,
  calculateBreakEven,
} from './calculations.js';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const kiaConfigPath = path.resolve(__dirname, '../../kia_service/config.json');
const kiaSyncScript = path.resolve(__dirname, '../../kia_service/sync_kia.py');
const kiaControlScript = path.resolve(__dirname, '../../kia_service/control_kia.py');

// Initialize DB schema & defaults
initDatabase();

// Setup daily automatic backup (runs once every 24h)
setInterval(() => {
  try {
    const backupFile = createBackup();
    logger.info(`[Backup] Tägliches Backup erfolgreich erstellt: ${backupFile}`);
  } catch (err: any) {
    logger.error('[Backup] Fehler beim täglichen Backup:', err);
  }
}, 24 * 60 * 60 * 1000);

const app = express();
app.use(cors());
app.use(express.json());
app.use(logger.requestMiddleware);
app.use(basicAuthMiddleware);

// Helper for error handling
function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<any> | any) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// ==========================================
// VEHICLES API
// ==========================================

app.get('/api/vehicles', (req, res) => {
  const rows = db.prepare('SELECT * FROM vehicles ORDER BY id ASC').all();
  res.json(rows);
});

app.get('/api/vehicles/:id', (req, res) => {
  const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(req.params.id);
  if (!vehicle) return res.status(404).json({ error: 'Fahrzeug nicht gefunden' });
  res.json(vehicle);
});

app.post('/api/vehicles', asyncHandler((req, res) => {
  const {
    name,
    marke = 'Kia',
    modell = 'Ceed SW PHEV',
    batterie_kapazitaet_kwh = 8.9,
    tank_kapazitaet_l = 37.0,
    default_ev_kwh_per_100km = 16.0,
    default_fuel_l_per_100km = 5.5,
  } = req.body;

  if (!name) return res.status(400).json({ error: 'Name ist erforderlich' });

  const stmt = db.prepare(`
    INSERT INTO vehicles (name, marke, modell, batterie_kapazitaet_kwh, tank_kapazitaet_l, default_ev_kwh_per_100km, default_fuel_l_per_100km)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    name,
    marke,
    modell,
    parseLocaleNumber(batterie_kapazitaet_kwh),
    parseLocaleNumber(tank_kapazitaet_l),
    parseLocaleNumber(default_ev_kwh_per_100km),
    parseLocaleNumber(default_fuel_l_per_100km),
  );

  res.status(201).json({ id: result.lastInsertRowid, message: 'Fahrzeug erstellt' });
}));

// ==========================================
// CHARGING SESSIONS API
// ==========================================

app.get('/api/sessions/charging', (req, res) => {
  const vehicleId = req.query.vehicleId ? Number(req.query.vehicleId) : 1;
  const rows = db.prepare(`
    SELECT * FROM charging_sessions
    WHERE vehicle_id = ?
    ORDER BY zeitpunkt DESC, id DESC
  `).all(vehicleId);
  res.json(rows);
});

app.post('/api/sessions/charging', asyncHandler((req, res) => {
  const {
    vehicle_id = 1,
    zeitpunkt = new Date().toISOString(),
    kwh,
    preis_pro_kwh,
    gesamtkosten,
    quelle = 'zuhause',
    odometer_km,
    ev_km,
    standort = '',
    bemerkung = '',
  } = req.body;

  const parsedKwh = parseLocaleNumber(kwh);
  if (parsedKwh <= 0) {
    return res.status(400).json({ error: 'Geladene kWh müssen größer als 0 sein' });
  }

  let finalPricePerKwh: number;
  let finalTotalCost: number;

  if (preis_pro_kwh !== undefined && preis_pro_kwh !== null && String(preis_pro_kwh).trim() !== '') {
    finalPricePerKwh = parseLocaleNumber(preis_pro_kwh);
    finalTotalCost = (gesamtkosten !== undefined && gesamtkosten !== null && String(gesamtkosten).trim() !== '')
      ? parseLocaleNumber(gesamtkosten)
      : parsedKwh * finalPricePerKwh;
  } else if (gesamtkosten !== undefined && gesamtkosten !== null && String(gesamtkosten).trim() !== '') {
    finalTotalCost = parseLocaleNumber(gesamtkosten);
    finalPricePerKwh = finalTotalCost / parsedKwh;
  } else {
    // Fallback: look up tariff for source
    const tariff = getTariffForSource(quelle, zeitpunkt);
    if (tariff !== null) {
      finalPricePerKwh = tariff;
      finalTotalCost = parsedKwh * tariff;
    } else {
      return res.status(400).json({
        error: `Weder Preis noch Gesamtkosten angegeben und kein hinterlegter Tarif für Quelle "${quelle}" gefunden`,
      });
    }
  }

  const parsedOdometer = odometer_km ? parseLocaleNumber(odometer_km) : null;
  const parsedEvKm = ev_km ? parseLocaleNumber(ev_km) : null;

  const stmt = db.prepare(`
    INSERT INTO charging_sessions (
      vehicle_id, zeitpunkt, kwh, preis_pro_kwh, gesamtkosten, quelle, odometer_km, ev_km, standort, bemerkung
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    Number(vehicle_id),
    zeitpunkt,
    parsedKwh,
    finalPricePerKwh,
    finalTotalCost,
    quelle,
    parsedOdometer,
    parsedEvKm,
    standort,
    bemerkung,
  );

  res.status(201).json({ id: result.lastInsertRowid, message: 'Ladevorgang gespeichert' });
}));

app.put('/api/sessions/charging/:id', asyncHandler((req, res) => {
  const id = Number(req.params.id);
  const {
    zeitpunkt,
    kwh,
    preis_pro_kwh,
    gesamtkosten,
    quelle,
    odometer_km,
    ev_km,
    standort,
    bemerkung,
  } = req.body;

  const parsedKwh = parseLocaleNumber(kwh);
  const parsedPrice = parseLocaleNumber(preis_pro_kwh);
  const parsedTotal = gesamtkosten ? parseLocaleNumber(gesamtkosten) : parsedKwh * parsedPrice;

  const stmt = db.prepare(`
    UPDATE charging_sessions
    SET zeitpunkt = ?, kwh = ?, preis_pro_kwh = ?, gesamtkosten = ?, quelle = ?,
        odometer_km = ?, ev_km = ?, standort = ?, bemerkung = ?
    WHERE id = ?
  `);

  stmt.run(
    zeitpunkt,
    parsedKwh,
    parsedPrice,
    parsedTotal,
    quelle,
    odometer_km ? parseLocaleNumber(odometer_km) : null,
    ev_km ? parseLocaleNumber(ev_km) : null,
    standort,
    bemerkung,
    id,
  );

  res.json({ message: 'Ladevorgang aktualisiert' });
}));

app.delete('/api/sessions/charging/:id', (req, res) => {
  db.prepare('DELETE FROM charging_sessions WHERE id = ?').run(Number(req.params.id));
  res.json({ message: 'Ladevorgang gelöscht' });
});

// ==========================================
// FUEL SESSIONS API
// ==========================================

app.get('/api/sessions/fuel', (req, res) => {
  const vehicleId = req.query.vehicleId ? Number(req.query.vehicleId) : 1;
  const rows = db.prepare(`
    SELECT * FROM fuel_sessions
    WHERE vehicle_id = ?
    ORDER BY zeitpunkt DESC, id DESC
  `).all(vehicleId);
  res.json(rows);
});

app.post('/api/sessions/fuel', asyncHandler((req, res) => {
  const {
    vehicle_id = 1,
    zeitpunkt = new Date().toISOString(),
    liter,
    preis_pro_liter,
    gesamtkosten,
    tankstelle = '',
    odometer_km,
    fuel_km,
    vollgetankt = 1,
    bemerkung = '',
  } = req.body;

  const parsedLiter = parseLocaleNumber(liter);
  if (parsedLiter <= 0) {
    return res.status(400).json({ error: 'Getankte Liter müssen größer als 0 sein' });
  }

  let finalPricePerLiter: number;
  let finalTotalCost: number;

  if (preis_pro_liter !== undefined && preis_pro_liter !== null && String(preis_pro_liter).trim() !== '') {
    finalPricePerLiter = parseLocaleNumber(preis_pro_liter);
    finalTotalCost = (gesamtkosten !== undefined && gesamtkosten !== null && String(gesamtkosten).trim() !== '')
      ? parseLocaleNumber(gesamtkosten)
      : parsedLiter * finalPricePerLiter;
  } else if (gesamtkosten !== undefined && gesamtkosten !== null && String(gesamtkosten).trim() !== '') {
    finalTotalCost = parseLocaleNumber(gesamtkosten);
    finalPricePerLiter = finalTotalCost / parsedLiter;
  } else {
    return res.status(400).json({ error: 'Bitte entweder Preis pro Liter oder Gesamtkosten angeben' });
  }

  const parsedOdometer = odometer_km ? parseLocaleNumber(odometer_km) : null;
  const parsedFuelKm = fuel_km ? parseLocaleNumber(fuel_km) : null;

  const stmt = db.prepare(`
    INSERT INTO fuel_sessions (
      vehicle_id, zeitpunkt, liter, preis_pro_liter, gesamtkosten, tankstelle, odometer_km, fuel_km, vollgetankt, bemerkung
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    Number(vehicle_id),
    zeitpunkt,
    parsedLiter,
    finalPricePerLiter,
    finalTotalCost,
    tankstelle,
    parsedOdometer,
    parsedFuelKm,
    vollgetankt ? 1 : 0,
    bemerkung,
  );

  res.status(201).json({ id: result.lastInsertRowid, message: 'Tankvorgang gespeichert' });
}));

app.put('/api/sessions/fuel/:id', asyncHandler((req, res) => {
  const id = Number(req.params.id);
  const {
    zeitpunkt,
    liter,
    preis_pro_liter,
    gesamtkosten,
    tankstelle,
    odometer_km,
    fuel_km,
    vollgetankt,
    bemerkung,
  } = req.body;

  const parsedLiter = parseLocaleNumber(liter);
  const parsedPrice = parseLocaleNumber(preis_pro_liter);
  const parsedTotal = gesamtkosten ? parseLocaleNumber(gesamtkosten) : parsedLiter * parsedPrice;

  const stmt = db.prepare(`
    UPDATE fuel_sessions
    SET zeitpunkt = ?, liter = ?, preis_pro_liter = ?, gesamtkosten = ?, tankstelle = ?,
        odometer_km = ?, fuel_km = ?, vollgetankt = ?, bemerkung = ?
    WHERE id = ?
  `);

  stmt.run(
    zeitpunkt,
    parsedLiter,
    parsedPrice,
    parsedTotal,
    tankstelle,
    odometer_km ? parseLocaleNumber(odometer_km) : null,
    fuel_km ? parseLocaleNumber(fuel_km) : null,
    vollgetankt ? 1 : 0,
    bemerkung,
    id,
  );

  res.json({ message: 'Tankvorgang aktualisiert' });
}));

app.delete('/api/sessions/fuel/:id', (req, res) => {
  db.prepare('DELETE FROM fuel_sessions WHERE id = ?').run(Number(req.params.id));
  res.json({ message: 'Tankvorgang gelöscht' });
});

// ==========================================
// SNAPSHOTS API
// ==========================================

app.get('/api/snapshots', (req, res) => {
  const vehicleId = req.query.vehicleId ? Number(req.query.vehicleId) : 1;
  const rows = db.prepare(`
    SELECT * FROM vehicle_snapshots
    WHERE vehicle_id = ?
    ORDER BY zeitpunkt DESC, id DESC
    LIMIT 100
  `).all(vehicleId);
  res.json(rows);
});

app.post('/api/snapshots', asyncHandler((req, res) => {
  const {
    vehicle_id = 1,
    zeitpunkt = new Date().toISOString(),
    odometer_km,
    ev_range_km,
    fuel_range_km,
    ev_odometer_km,
    soc_percent,
    car_12v_percent,
    is_charging = 0,
    is_plugged_in = 0,
    is_locked,
    doors_open_json,
    windows_open_json,
    climate_status_json,
    charge_remaining_min,
    charge_port_open = 0,
    location_lat,
    location_lon,
    tire_pressure_warning = 0,
    washer_fluid_warning = 0,
    smart_key_warning = 0,
    quelle = 'manuell',
  } = req.body;

  if (odometer_km === undefined || odometer_km === null) {
    return res.status(400).json({ error: 'Kilometerstand (odometer_km) ist Pflicht' });
  }

  const stmt = db.prepare(`
    INSERT INTO vehicle_snapshots (
      vehicle_id, zeitpunkt, odometer_km, ev_range_km, fuel_range_km, ev_odometer_km, soc_percent,
      car_12v_percent, is_charging, is_plugged_in, is_locked, doors_open_json, windows_open_json,
      climate_status_json, charge_remaining_min, charge_port_open, location_lat, location_lon,
      tire_pressure_warning, washer_fluid_warning, smart_key_warning, quelle
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    Number(vehicle_id),
    zeitpunkt,
    parseLocaleNumber(odometer_km),
    ev_range_km ? parseLocaleNumber(ev_range_km) : null,
    fuel_range_km ? parseLocaleNumber(fuel_range_km) : null,
    ev_odometer_km ? parseLocaleNumber(ev_odometer_km) : null,
    soc_percent ? parseLocaleNumber(soc_percent) : null,
    car_12v_percent !== undefined && car_12v_percent !== null ? parseLocaleNumber(car_12v_percent) : null,
    is_charging ? 1 : 0,
    is_plugged_in ? 1 : 0,
    is_locked !== undefined && is_locked !== null ? (is_locked ? 1 : 0) : null,
    doors_open_json || null,
    windows_open_json || null,
    climate_status_json || null,
    charge_remaining_min !== undefined && charge_remaining_min !== null ? Number(charge_remaining_min) : null,
    charge_port_open ? 1 : 0,
    location_lat !== undefined && location_lat !== null ? Number(location_lat) : null,
    location_lon !== undefined && location_lon !== null ? Number(location_lon) : null,
    tire_pressure_warning ? 1 : 0,
    washer_fluid_warning ? 1 : 0,
    smart_key_warning ? 1 : 0,
    quelle,
  );

  res.status(201).json({ id: result.lastInsertRowid, message: 'Snapshot gespeichert' });
}));

app.delete('/api/snapshots/:id', (req, res) => {
  db.prepare('DELETE FROM vehicle_snapshots WHERE id = ?').run(Number(req.params.id));
  res.json({ message: 'Snapshot gelöscht' });
});

// ==========================================
// TARIFFS API
// ==========================================

app.get('/api/tariffs', (req, res) => {
  const rows = db.prepare('SELECT * FROM tariffs ORDER BY quelle ASC, gueltig_ab DESC').all();
  res.json(rows);
});

app.post('/api/tariffs', asyncHandler((req, res) => {
  const { quelle, bezeichnung, gueltig_ab, preis_pro_kwh, grundgebuehr_monat = 0 } = req.body;

  if (!quelle || !bezeichnung || !gueltig_ab || preis_pro_kwh === undefined) {
    return res.status(400).json({ error: 'Quelle, Bezeichnung, Gültig-ab und Preis pro kWh sind erforderlich' });
  }

  const stmt = db.prepare(`
    INSERT INTO tariffs (quelle, bezeichnung, gueltig_ab, preis_pro_kwh, grundgebuehr_monat)
    VALUES (?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    quelle.toLowerCase().trim(),
    bezeichnung.trim(),
    gueltig_ab.trim(),
    parseLocaleNumber(preis_pro_kwh),
    parseLocaleNumber(grundgebuehr_monat),
  );

  res.status(201).json({ id: result.lastInsertRowid, message: 'Tarif erstellt' });
}));

app.delete('/api/tariffs/:id', (req, res) => {
  db.prepare('DELETE FROM tariffs WHERE id = ?').run(Number(req.params.id));
  res.json({ message: 'Tarif gelöscht' });
});

// ==========================================
// DASHBOARD & CALCULATION STATS API
// ==========================================

app.get('/api/dashboard/stats', asyncHandler((req, res) => {
  const vehicleId = req.query.vehicleId ? Number(req.query.vehicleId) : 1;

  const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(vehicleId) as any;
  if (!vehicle) return res.status(404).json({ error: 'Fahrzeug nicht gefunden' });

  // 1. Sum up charging sessions
  const chargingStats = db.prepare(`
    SELECT
      COUNT(*) as count,
      COALESCE(SUM(kwh), 0) as total_kwh,
      COALESCE(SUM(gesamtkosten), 0) as total_cost,
      COALESCE(SUM(ev_km), 0) as total_ev_km
    FROM charging_sessions
    WHERE vehicle_id = ?
  `).get(vehicleId) as any;

  const measuredCharging = db.prepare(`
    SELECT
      COALESCE(SUM(kwh), 0) as measured_kwh,
      COALESCE(SUM(ev_km), 0) as measured_ev_km
    FROM charging_sessions
    WHERE vehicle_id = ? AND ev_km IS NOT NULL AND ev_km > 0
  `).get(vehicleId) as any;

  // 2. Sum up fuel sessions
  const fuelStats = db.prepare(`
    SELECT
      COUNT(*) as count,
      COALESCE(SUM(liter), 0) as total_liter,
      COALESCE(SUM(gesamtkosten), 0) as total_cost,
      COALESCE(SUM(fuel_km), 0) as total_fuel_km
    FROM fuel_sessions
    WHERE vehicle_id = ?
  `).get(vehicleId) as any;

  const measuredFuel = db.prepare(`
    SELECT
      COALESCE(SUM(liter), 0) as measured_liter,
      COALESCE(SUM(fuel_km), 0) as measured_fuel_km
    FROM fuel_sessions
    WHERE vehicle_id = ? AND fuel_km IS NOT NULL AND fuel_km > 0
  `).get(vehicleId) as any;

  // 3. Latest fuel price and latest electricity price for realistic break-even comparison
  const latestFuel = db.prepare(`
    SELECT preis_pro_liter FROM fuel_sessions
    WHERE vehicle_id = ?
    ORDER BY zeitpunkt DESC, id DESC LIMIT 1
  `).get(vehicleId) as { preis_pro_liter: number } | undefined;

  const latestCharge = db.prepare(`
    SELECT preis_pro_kwh FROM charging_sessions
    WHERE vehicle_id = ?
    ORDER BY zeitpunkt DESC, id DESC LIMIT 1
  `).get(vehicleId) as { preis_pro_kwh: number } | undefined;

  // Home tariff as reference
  const homeTariff = getTariffForSource('zuhause', new Date().toISOString()) ?? 0.28;

  // Calculate EV metrics
  const evMetrics = calculateEvMetrics({
    totalKwh: chargingStats.total_kwh,
    totalCost: chargingStats.total_cost,
    totalEvKm: chargingStats.total_ev_km,
    measuredKwh: measuredCharging?.measured_kwh,
    measuredEvKm: measuredCharging?.measured_ev_km,
    defaultKwhPer100Km: vehicle.default_ev_kwh_per_100km,
    averagePricePerKwh: chargingStats.total_kwh > 0 ? chargingStats.total_cost / chargingStats.total_kwh : homeTariff,
  });

  // Calculate Fuel metrics
  const fuelMetrics = calculateFuelMetrics({
    totalLiter: fuelStats.total_liter,
    totalCost: fuelStats.total_cost,
    totalFuelKm: fuelStats.total_fuel_km,
    measuredLiter: measuredFuel?.measured_liter,
    measuredFuelKm: measuredFuel?.measured_fuel_km,
    defaultLPer100Km: vehicle.default_fuel_l_per_100km,
    averagePricePerLiter: latestFuel?.preis_pro_liter ?? (fuelStats.total_liter > 0 ? fuelStats.total_cost / fuelStats.total_liter : 1.65),
  });

  // Reference prices for break-even
  const activeFuelPrice = latestFuel?.preis_pro_liter ?? 1.65;
  const activeEvPrice = latestCharge?.preis_pro_kwh ?? homeTariff;

  const breakEven = calculateBreakEven({
    evKwhPer100Km: evMetrics.kwhPer100Km,
    fuelLiterPer100Km: fuelMetrics.literPer100Km,
    fuelPricePerLiter: activeFuelPrice,
    electricityPricePerKwh: activeEvPrice,
  });

  // Latest snapshot
  const latestSnapshot = db.prepare(`
    SELECT * FROM vehicle_snapshots
    WHERE vehicle_id = ?
    ORDER BY zeitpunkt DESC, id DESC LIMIT 1
  `).get(vehicleId);

  res.json({
    vehicle,
    evMetrics,
    fuelMetrics,
    breakEven,
    sessionsCount: {
      charging: chargingStats.count,
      fuel: fuelStats.count,
    },
    latestSnapshot: latestSnapshot || null,
  });
}));

// ==========================================
// BACKUP API
// ==========================================

app.post('/api/backup', (req, res) => {
  try {
    const backupFile = createBackup();
    res.json({ message: 'Backup erfolgreich erstellt', file: path.basename(backupFile) });
  } catch (err: any) {
    res.status(500).json({ error: 'Fehler beim Erstellen des Backups: ' + err.message });
  }
});

// ==========================================
// KIA CONNECT / UVO INTEGRATION API
// ==========================================

app.get('/api/kia/status', (req, res) => {
  if (!fs.existsSync(kiaConfigPath)) {
    return res.json({ configured: false, username: null });
  }
  try {
    const raw = fs.readFileSync(kiaConfigPath, 'utf-8');
    const cfg = JSON.parse(raw);

    // Auto-migrate plaintext password to encrypted on disk
    if (cfg.password && !cfg.password.startsWith('enc:v1:')) {
      cfg.password = encryptString(cfg.password);
      if (cfg.pin && !cfg.pin.startsWith('enc:v1:')) {
        cfg.pin = encryptString(cfg.pin);
      }
      fs.writeFileSync(kiaConfigPath, JSON.stringify(cfg, null, 2), 'utf-8');
      logger.info('[Security] Kia-Zugangsdaten auf der Festplatte mit AES-256-GCM verschlüsselt.');
    }

    const configured = Boolean(cfg.username && cfg.password);
    res.json({
      configured,
      username: cfg.username ? cfg.username.replace(/^(.)(.*)(@.*)$/, (_m: any, a: any, b: any, c: any) => a + '***' + c) : null,
      rawUsername: cfg.username || '',
      region: cfg.region || 1,
      brand: cfg.brand || 1,
      forceRefresh: Boolean(cfg.force_refresh),
    });
  } catch (e: any) {
    res.json({ configured: false, error: e.message });
  }
});

app.post('/api/kia/config', (req, res) => {
  const { username, password, pin = '', region = 1, brand = 1, force_refresh = false } = req.body;
  if (!username) {
    return res.status(400).json({ error: 'Benutzername/E-Mail ist erforderlich' });
  }
  let currentCfg: any = {};
  if (fs.existsSync(kiaConfigPath)) {
    try {
      currentCfg = JSON.parse(fs.readFileSync(kiaConfigPath, 'utf-8'));
    } catch {}
  }

  let finalPassword = currentCfg.password;
  if (password !== undefined && String(password).trim() !== '') {
    finalPassword = encryptString(String(password).trim());
  }

  let finalPin = currentCfg.pin || '';
  if (pin !== undefined && String(pin).trim() !== '') {
    finalPin = encryptString(String(pin).trim());
  }

  const updatedCfg = {
    ...currentCfg,
    username: String(username).trim(),
    password: finalPassword,
    pin: finalPin,
    region: Number(region) || 1,
    brand: Number(brand) || 1,
    server_url: `http://localhost:${PORT}`,
    vehicle_id: 1,
    force_refresh: Boolean(force_refresh),
  };
  fs.writeFileSync(kiaConfigPath, JSON.stringify(updatedCfg, null, 2), 'utf-8');
  logger.info('[Security] Kia Connect Konfiguration mit verschlüsseltem Passwort aktualisiert.');
  res.json({
    message: 'Kia Connect Konfiguration sicher gespeichert',
    configured: Boolean(updatedCfg.username && updatedCfg.password),
  });
});

app.post('/api/kia/sync', asyncHandler(async (req, res) => {
  const force = Boolean(req.body.force);
  logger.info(`[KiaSync] Synchronisierung gestartet (force=${force})...`);

  // Read and decrypt credentials in memory to pass safely to Python
  let decryptedPassword = '';
  let decryptedPin = '';
  let username = '';
  if (fs.existsSync(kiaConfigPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(kiaConfigPath, 'utf-8'));
      username = cfg.username || '';
      decryptedPassword = decryptString(cfg.password || '');
      decryptedPin = decryptString(cfg.pin || '');
    } catch (e: any) {
      logger.error('[KiaSync] Konfigurationsfehler:', e.message);
    }
  }

  const args = [kiaSyncScript, '--json', '--server-url', `http://localhost:${PORT}`];
  if (force) args.push('--force');

  try {
    const { stdout, stderr } = await execFileAsync('python', args, {
      timeout: 90000,
      env: {
        ...process.env,
        KIA_USERNAME: username,
        KIA_PASSWORD: decryptedPassword,
        KIA_PIN: decryptedPin,
        BASIC_AUTH_USER: process.env.BASIC_AUTH_USER || '',
        BASIC_AUTH_PASSWORD: process.env.BASIC_AUTH_PASSWORD || '',
      },
    });
    const output = stdout.trim();
    let data;
    try {
      data = JSON.parse(output);
    } catch {
      logger.error('[KiaSync] Unerwartete Skript-Ausgabe:', output || stderr);
      return res.status(500).json({ error: 'Unerwartete Skript-Ausgabe: ' + (output || stderr) });
    }

    if (!data.success) {
      logger.warn('[KiaSync] Synchronisation meldet Fehler:', data.error);
      return res.status(400).json({ error: data.error || 'Kia Connect Synchronisation fehlgeschlagen' });
    }

    logger.info(`[KiaSync] Synchronisation erfolgreich: Tacho=${data.snapshot?.odometer_km} km, SoC=${data.snapshot?.soc_percent}%`);
    res.json(data);
  } catch (err: any) {
    const errDetail = err.stderr?.trim() || err.stdout?.trim() || err.message;
    logger.error('[KiaSync] Ausführungsfehler:', errDetail);
    if (err.stdout) {
      try {
        const data = JSON.parse(err.stdout.trim());
        if (data.error) {
          return res.status(400).json({ error: data.error });
        }
      } catch {}
    }
    res.status(500).json({ error: 'Fehler beim Ausführen von sync_kia.py: ' + errDetail });
  }
}));

app.post('/api/kia/control', asyncHandler(async (req, res) => {
  const { action, temp = 21.0, duration = 15, defrost = false, steering_wheel = false } = req.body;

  if (!action) {
    return res.status(400).json({ error: 'Aktion ist erforderlich (z.B. lock, unlock, start_climate, stop_climate, start_charge, stop_charge)' });
  }

  logger.info(`[KiaRemote] Befehl '${action}' wird ausgeführt...`);

  let decryptedPassword = '';
  let decryptedPin = '';
  let username = '';
  if (fs.existsSync(kiaConfigPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(kiaConfigPath, 'utf-8'));
      username = cfg.username || '';
      decryptedPassword = decryptString(cfg.password || '');
      decryptedPin = decryptString(cfg.pin || '');
    } catch (e: any) {
      logger.error('[KiaRemote] Konfigurationsfehler:', e.message);
    }
  }

  const args = [kiaControlScript, action, '--json'];
  if (action === 'start_climate') {
    args.push('--temp', String(temp));
    args.push('--duration', String(duration));
    if (defrost) args.push('--defrost');
    if (steering_wheel) args.push('--steering-wheel');
  }

  try {
    const { stdout, stderr } = await execFileAsync('python', args, {
      timeout: 90000,
      env: {
        ...process.env,
        KIA_USERNAME: username,
        KIA_PASSWORD: decryptedPassword,
        KIA_PIN: decryptedPin,
      },
    });

    const output = stdout.trim();
    let data;
    try {
      data = JSON.parse(output);
    } catch {
      logger.error('[KiaRemote] Unerwartete Skript-Ausgabe:', output || stderr);
      return res.status(500).json({ error: 'Unerwartete Skript-Ausgabe: ' + (output || stderr) });
    }

    if (!data.success) {
      logger.warn('[KiaRemote] Befehl meldet Fehler:', data.error);
      return res.status(400).json({ error: data.error || `Remote-Befehl '${action}' fehlgeschlagen` });
    }

    // Immediately update latest snapshot state in database so the UI reflects the action
    if (action === 'lock') {
      try {
        db.prepare('UPDATE vehicle_snapshots SET is_locked = 1 WHERE id = (SELECT id FROM vehicle_snapshots ORDER BY zeitpunkt DESC, id DESC LIMIT 1)').run();
      } catch {}
    } else if (action === 'unlock') {
      try {
        db.prepare('UPDATE vehicle_snapshots SET is_locked = 0 WHERE id = (SELECT id FROM vehicle_snapshots ORDER BY zeitpunkt DESC, id DESC LIMIT 1)').run();
      } catch {}
    } else if (action === 'start_charge') {
      try {
        db.prepare('UPDATE vehicle_snapshots SET is_charging = 1 WHERE id = (SELECT id FROM vehicle_snapshots ORDER BY zeitpunkt DESC, id DESC LIMIT 1)').run();
      } catch {}
    } else if (action === 'stop_charge') {
      try {
        db.prepare('UPDATE vehicle_snapshots SET is_charging = 0 WHERE id = (SELECT id FROM vehicle_snapshots ORDER BY zeitpunkt DESC, id DESC LIMIT 1)').run();
      } catch {}
    }

    logger.info(`[KiaRemote] Befehl '${action}' erfolgreich ausgeführt:`, data.message);
    res.json(data);
  } catch (err: any) {
    const errDetail = err.stderr?.trim() || err.stdout?.trim() || err.message;
    logger.error('[KiaRemote] Ausführungsfehler:', errDetail);
    if (err.stdout) {
      try {
        const data = JSON.parse(err.stdout.trim());
        if (data.error) {
          return res.status(400).json({ error: data.error });
        }
      } catch {}
    }
    res.status(500).json({ error: `Fehler beim Ausführen von '${action}': ` + errDetail });
  }
}));

// ==========================================
// STATIC FRONTEND SERVING (Production)
// ==========================================

const frontendDistPath = path.resolve(__dirname, '../../frontend/dist');
if (fs.existsSync(frontendDistPath)) {
  app.use(express.static(frontendDistPath));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/')) {
      return res.sendFile(path.resolve(frontendDistPath, 'index.html'));
    }
    next();
  });
}

// Global error handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  logger.error(`API Error on ${req.method} ${req.url}: ${err.message}`, err);
  res.status(500).json({ error: err.message || 'Interner Serverfehler' });
});

app.listen(PORT, HOST, () => {
  logger.info(`🚗 PHEV-Tracker Server läuft auf http://${HOST}:${PORT}`);
  logger.info(`   - Lokal:    http://localhost:${PORT}`);
  logger.info(`   - Netzwerk/Meshnet: http://0.0.0.0:${PORT} (auf allen Netzwerk-Adaptern aktiv)`);
});
