import React, { useEffect, useState } from 'react';
import {
  Zap,
  Fuel,
  Gauge,
  History,
  Settings,
  PlusCircle,
  TrendingDown,
  RefreshCw,
  Trash2,
  CheckCircle2,
  Wifi,
  WifiOff,
  Database,
  Calculator,
} from 'lucide-react';
import {
  fetchDashboardStats,
  fetchChargingSessions,
  fetchFuelSessions,
  fetchSnapshots,
  fetchTariffs,
  createChargingSession,
  createFuelSession,
  createSnapshot,
  deleteChargingSession,
  deleteFuelSession,
  deleteSnapshot,
  createTariff,
  deleteTariff,
  triggerBackup,
  getKiaStatus,
  saveKiaConfig,
  syncKiaConnect,
} from './api';
import type {
  DashboardStats,
  ChargingSession,
  FuelSession,
  VehicleSnapshot,
  Tariff,
  KiaStatus,
} from './api';
import {
  getPendingActions,
  syncPendingActions,
  saveCachedDashboard,
  getCachedDashboard,
} from './offlineStore';
import type { PendingAction } from './offlineStore';

export function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'charge' | 'fuel' | 'snapshot' | 'history' | 'settings'>('dashboard');
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [toastMsg, setToastMsg] = useState<{ text: string; type: 'success' | 'warn' } | null>(null);

  // History state
  const [chargingList, setChargingList] = useState<ChargingSession[]>([]);
  const [fuelList, setFuelList] = useState<FuelSession[]>([]);
  const [snapshotList, setSnapshotList] = useState<VehicleSnapshot[]>([]);
  const [historyFilter, setHistoryFilter] = useState<'all' | 'charge' | 'fuel' | 'snapshot'>('all');
  const [historySortOrder, setHistorySortOrder] = useState<'desc' | 'asc'>('desc');

  // Form helper & prefill states
  const [chargeKwh, setChargeKwh] = useState('');
  const [chargeOdo, setChargeOdo] = useState('');
  const [chargeEvKm, setChargeEvKm] = useState('');
  const [chargeCalcOpen, setChargeCalcOpen] = useState(false);
  const [calcStartPct, setCalcStartPct] = useState(20);
  const [calcEndPct, setCalcEndPct] = useState(100);

  const [fuelOdo, setFuelOdo] = useState('');
  const [fuelKm, setFuelKm] = useState('');

  // Tariffs
  const [tariffs, setTariffs] = useState<Tariff[]>([]);

  // Simulator state in Dashboard
  const [simEvPrice, setSimEvPrice] = useState<number>(0.28);
  const [simFuelPrice, setSimFuelPrice] = useState<number>(1.65);

  // Kia Connect integration state
  const [kiaStatus, setKiaStatus] = useState<KiaStatus | null>(null);
  const [isKiaSyncing, setIsKiaSyncing] = useState(false);
  const [kiaUsernameInput, setKiaUsernameInput] = useState('');
  const [kiaPasswordInput, setKiaPasswordInput] = useState('');
  const [kiaPinInput, setKiaPinInput] = useState('');
  const [kiaForceRefresh, setKiaForceRefresh] = useState(false);

  // Helper toast notification
  const showToast = (text: string, type: 'success' | 'warn' = 'success') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 4000);
  };

  // Monitor online status & offline sync queue
  useEffect(() => {
    const updateOnline = () => {
      setIsOnline(navigator.onLine);
      if (navigator.onLine) {
        handleSync();
      }
    };

    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);

    checkPendingActions();
    loadDashboard();
    loadKiaStatus();

    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, []);

  const checkPendingActions = async () => {
    const list = await getPendingActions();
    setPendingActions(list);
  };

  const handleSync = async () => {
    if (!navigator.onLine) return;
    setSyncing(true);
    try {
      const count = await syncPendingActions();
      if (count > 0) {
        showToast(`${count} Offline-Eintrag/-Einträge erfolgreich synchronisiert!`);
        await loadDashboard();
        if (activeTab === 'history') loadHistory();
      }
    } finally {
      setSyncing(false);
      checkPendingActions();
    }
  };

  const loadDashboard = async () => {
    try {
      const data = await fetchDashboardStats(1);
      setStats(data);
      saveCachedDashboard(data);
      setSimEvPrice(data.breakEven.electricityPricePerKwh);
      setSimFuelPrice(data.breakEven.fuelPricePerLiter);
    } catch (err) {
      console.warn('Backend nicht erreichbar, nutze gecachte Daten falls vorhanden:', err);
      const cached = getCachedDashboard();
      if (cached) {
        setStats(cached);
        setSimEvPrice(cached.breakEven.electricityPricePerKwh);
        setSimFuelPrice(cached.breakEven.fuelPricePerLiter);
      }
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    try {
      const [c, f, s] = await Promise.all([
        fetchChargingSessions(1),
        fetchFuelSessions(1),
        fetchSnapshots(1),
      ]);
      setChargingList(c);
      setFuelList(f);
      setSnapshotList(s);
    } catch (err) {
      console.error(err);
    }
  };

  const loadTariffs = async () => {
    try {
      const list = await fetchTariffs();
      setTariffs(list);
    } catch (err) {
      console.error(err);
    }
  };

  const loadKiaStatus = async () => {
    try {
      const s = await getKiaStatus();
      setKiaStatus(s);
      if (s.rawUsername) setKiaUsernameInput(s.rawUsername);
      if (s.forceRefresh !== undefined) setKiaForceRefresh(s.forceRefresh);
    } catch (e) {
      console.error('Kia Status Fehler:', e);
    }
  };

  useEffect(() => {
    if (activeTab === 'history') loadHistory();
    if (activeTab === 'settings') {
      loadTariffs();
      loadKiaStatus();
    }
  }, [activeTab]);

  // Format Helpers
  const formatCur = (n: number) => n.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  const formatKmCur = (n: number) => n.toLocaleString('de-AT', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + ' €/km';
  const formatNum = (n: number, decimals = 1) => n.toLocaleString('de-AT', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  };

  // Forms submit handlers
  const handleSaveCharge = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);

    const payload = {
      vehicle_id: 1,
      zeitpunkt: formData.get('zeitpunkt') || new Date().toISOString(),
      kwh: formData.get('kwh'),
      quelle: formData.get('quelle'),
      preis_pro_kwh: formData.get('preis_pro_kwh') || undefined,
      gesamtkosten: formData.get('gesamtkosten') || undefined,
      ev_km: formData.get('ev_km') || undefined,
      odometer_km: formData.get('odometer_km') || undefined,
      standort: formData.get('standort') || '',
      bemerkung: formData.get('bemerkung') || '',
    };

    try {
      const res = await createChargingSession(payload);
      if (res.offline) {
        showToast('Ladevorgang offline gespeichert! Synchronisiert automatisch bei Verbindung.', 'warn');
      } else {
        showToast('Ladevorgang erfolgreich gespeichert!');
      }
      form.reset();
      setChargeKwh('');
      setChargeOdo('');
      setChargeEvKm('');
      await checkPendingActions();
      await loadDashboard();
      setActiveTab('dashboard');
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleSaveFuel = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);

    const payload = {
      vehicle_id: 1,
      zeitpunkt: formData.get('zeitpunkt') || new Date().toISOString(),
      liter: formData.get('liter'),
      preis_pro_liter: formData.get('preis_pro_liter') || undefined,
      gesamtkosten: formData.get('gesamtkosten') || undefined,
      tankstelle: formData.get('tankstelle') || 'Unbekannt',
      fuel_km: formData.get('fuel_km') || undefined,
      odometer_km: formData.get('odometer_km') || undefined,
      vollgetankt: formData.get('vollgetankt') === 'on' ? 1 : 0,
      bemerkung: formData.get('bemerkung') || '',
    };

    try {
      const res = await createFuelSession(payload);
      if (res.offline) {
        showToast('Tankvorgang offline gespeichert! Synchronisiert automatisch bei Verbindung.', 'warn');
      } else {
        showToast('Tankvorgang erfolgreich gespeichert!');
      }
      form.reset();
      setFuelOdo('');
      setFuelKm('');
      await checkPendingActions();
      await loadDashboard();
      setActiveTab('dashboard');
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleSaveSnapshot = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);

    const payload = {
      vehicle_id: 1,
      zeitpunkt: formData.get('zeitpunkt') || new Date().toISOString(),
      odometer_km: formData.get('odometer_km'),
      ev_range_km: formData.get('ev_range_km') || undefined,
      fuel_range_km: formData.get('fuel_range_km') || undefined,
      soc_percent: formData.get('soc_percent') || undefined,
      quelle: 'manuell',
    };

    try {
      const res = await createSnapshot(payload);
      if (res.offline) {
        showToast('Snapshot offline gespeichert!', 'warn');
      } else {
        showToast('Snapshot erfolgreich erfasst!');
      }
      form.reset();
      await checkPendingActions();
      await loadDashboard();
      setActiveTab('dashboard');
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleAddTariff = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);

    try {
      await createTariff({
        quelle: formData.get('quelle'),
        bezeichnung: formData.get('bezeichnung'),
        gueltig_ab: formData.get('gueltig_ab'),
        preis_pro_kwh: formData.get('preis_pro_kwh'),
      });
      showToast('Tarif angelegt!');
      form.reset();
      loadTariffs();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleBackup = async () => {
    try {
      const file = await triggerBackup();
      showToast(`Backup erstellt: ${file}`);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleKiaSync = async (force: boolean = false) => {
    if (isKiaSyncing) return;
    setIsKiaSyncing(true);
    try {
      const res = await syncKiaConnect(force);
      showToast(`Kia Sync erfolgreich! Tacho: ${formatNum(res.odometer_km, 0)} km, Akku: ${res.soc_percent}%`);
      await loadDashboard();
      if (activeTab === 'history') await loadHistory();
    } catch (err: any) {
      alert(err.message || 'Fehler beim Abrufen der Kia-Daten');
    } finally {
      setIsKiaSyncing(false);
    }
  };

  const handleSaveKiaConfig = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    try {
      const res = await saveKiaConfig({
        username: kiaUsernameInput,
        password: kiaPasswordInput,
        pin: kiaPinInput,
        force_refresh: kiaForceRefresh,
      });
      showToast(res.message);
      setKiaPasswordInput('');
      await loadKiaStatus();
    } catch (err: any) {
      alert(err.message || 'Fehler beim Speichern');
    }
  };

  // Dynamic Break-Even Simulation
  const simulatedEvCostPer100Km = (stats ? stats.evMetrics.kwhPer100Km : 16.0) * simEvPrice;
  const simulatedFuelCostPer100Km = (stats ? stats.fuelMetrics.literPer100Km : 5.5) * simFuelPrice;
  const simulatedBreakEven = (stats ? stats.fuelMetrics.literPer100Km : 5.5) * simFuelPrice / (stats ? stats.evMetrics.kwhPer100Km : 16.0);
  const simulatedSavings = simulatedFuelCostPer100Km - simulatedEvCostPer100Km;
  const isSimEvCheaper = simEvPrice <= simulatedBreakEven;

  return (
    <div>
      {/* Header */}
      <header className="app-header">
        <div className="header-content">
          <div className="brand">
            <img src="/icon.svg" alt="PHEV" className="brand-icon" />
            <div>
              <span>PHEV Tracker</span>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                {stats?.vehicle.name || 'Kia Ceed SW PHEV'}
              </div>
            </div>
          </div>

          {/* Desktop Nav */}
          <nav className="nav-desktop">
            <button className={`nav-btn ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>
              <Gauge size={18} /> Dashboard
            </button>
            <button className={`nav-btn ${activeTab === 'charge' ? 'active' : ''}`} onClick={() => setActiveTab('charge')}>
              <Zap size={18} /> + Ladung
            </button>
            <button className={`nav-btn ${activeTab === 'fuel' ? 'active' : ''}`} onClick={() => setActiveTab('fuel')}>
              <Fuel size={18} /> + Tanken
            </button>
            <button className={`nav-btn ${activeTab === 'snapshot' ? 'active' : ''}`} onClick={() => setActiveTab('snapshot')}>
              <PlusCircle size={18} /> + Snapshot
            </button>
            <button className={`nav-btn ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>
              <History size={18} /> Verlauf
            </button>
            <button className={`nav-btn ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>
              <Settings size={18} /> Tarife & Backup
            </button>
          </nav>

          {/* Connection / Sync indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {isOnline ? (
              <span className="badge badge-online" title="Verbunden mit Server">
                <Wifi size={13} /> Online
              </span>
            ) : (
              <span className="badge badge-offline" title="Offline-Modus: Daten werden lokal gespeichert">
                <WifiOff size={13} /> Offline
              </span>
            )}
            {pendingActions.length > 0 && (
              <button
                className="badge"
                style={{ backgroundColor: '#eab308', color: '#000', cursor: 'pointer', border: 'none' }}
                onClick={handleSync}
                disabled={syncing || !isOnline}
                title="Klicken zum Synchronisieren"
              >
                <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
                {pendingActions.length} offen
              </button>
            )}
          </div>
        </div>
      </header>

        {/* Main Container */}
        <main className="container">
          {/* Toast / Sync Banner */}
          {toastMsg && (
            <div className={`banner ${toastMsg.type === 'warn' ? 'banner-warning' : 'banner-success'}`}>
              <span>{toastMsg.text}</span>
              <button onClick={() => setToastMsg(null)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>×</button>
            </div>
          )}

          {loading && !stats && (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
              Lade Dashboard-Daten...
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB: DASHBOARD */}
          {/* ========================================================================= */}
          {activeTab === 'dashboard' && (
          <div>
            {/* Quick Actions for Mobile */}
            <div className="quick-bar">
              <button className="btn btn-secondary" style={{ borderColor: 'var(--ev-color)' }} onClick={() => setActiveTab('charge')}>
                <Zap size={16} color="var(--ev-color)" /> + Ladung
              </button>
              <button className="btn btn-secondary" style={{ borderColor: 'var(--fuel-color)' }} onClick={() => setActiveTab('fuel')}>
                <Fuel size={16} color="var(--fuel-color)" /> + Tanken
              </button>
              <button className="btn btn-secondary" onClick={() => setActiveTab('snapshot')}>
                <Gauge size={16} /> + Tacho
              </button>
              <button
                className="btn btn-secondary"
                style={{ borderColor: '#38bdf8' }}
                onClick={() => handleKiaSync(false)}
                disabled={isKiaSyncing}
                title="Aktuelle Daten (km, Akku) von Kia Connect abrufen"
              >
                <RefreshCw size={16} color="#38bdf8" className={isKiaSyncing ? 'spin' : ''} />
                {isKiaSyncing ? 'Kia lädt...' : 'Kia Sync'}
              </button>
            </div>

            {/* Break-Even Highlight Banner */}
            {stats && (
              <div className="card kpi-break-even" style={{ marginBottom: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                  <div>
                    <span className="badge" style={{ backgroundColor: 'rgba(56, 189, 248, 0.25)', color: '#38bdf8', marginBottom: '6px' }}>
                      Kosten-Entscheidungshilfe
                    </span>
                    <h2 style={{ fontSize: '1.4rem', fontWeight: 700, margin: '4px 0' }}>
                      {stats.breakEven.isEvCheaper ? '⚡ Elektrisch fahren ist günstiger' : '⛽ Benzinbetrieb ist aktuell günstiger'}
                    </h2>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                      Break-Even-Strompreis:{' '}
                      <strong style={{ color: '#38bdf8', fontSize: '1.05rem' }}>
                        {formatNum(stats.breakEven.breakEvenElectricityPricePerKwh, 3)} €/kWh
                      </strong>{' '}
                      (bis zu diesem Tarif spart Strom gegenüber Benzin).
                    </p>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <div className="kpi-value" style={{ color: stats.breakEven.isEvCheaper ? 'var(--ev-color)' : 'var(--fuel-color)' }}>
                      {stats.breakEven.isEvCheaper ? '+' : ''}{formatCur(stats.breakEven.savingsPer100Km)}
                    </div>
                    <div className="kpi-sub">
                      {stats.breakEven.isEvCheaper ? 'Ersparnis pro 100 km' : 'Mehrkosten Strom pro 100 km'}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Core KPI Cards: EV vs Benzin */}
            <div className="grid-2">
              {/* EV Box */}
              <div className="card kpi-box kpi-ev">
                <div className="card-title" style={{ color: 'var(--ev-color)' }}>
                  <Zap size={18} /> Elektrobetrieb (EV)
                </div>
                <div className="kpi-value" style={{ color: 'var(--ev-color)' }}>
                  {stats ? formatKmCur(stats.evMetrics.costPerKm) : '...'}
                </div>
                <div className="kpi-sub" style={{ fontSize: '1rem', color: 'var(--text-main)', marginTop: '2px' }}>
                  <strong>{stats ? formatCur(stats.evMetrics.costPer100Km) : '...'}</strong> / 100 km
                </div>

                <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid rgba(16, 185, 129, 0.2)', fontSize: '0.85rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Realverbrauch:</span>
                    <strong>{stats ? formatNum(stats.evMetrics.kwhPer100Km, 1) : '...'} kWh/100km</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Erfasste EV-Distanz:</span>
                    <span>{stats ? formatNum(stats.evMetrics.totalEvKm, 0) : '0'} km</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Geladene Energie:</span>
                    <span>{stats ? formatNum(stats.evMetrics.totalKwh, 1) : '0'} kWh ({stats ? formatCur(stats.evMetrics.totalCost) : '0 €'})</span>
                  </div>
                  {stats?.evMetrics.isEstimate && (
                    <div style={{ color: '#fbbf24', fontSize: '0.75rem', marginTop: '6px' }}>
                      * Richtwert (noch keine EV-Kilometer erfasst)
                    </div>
                  )}
                </div>
              </div>

              {/* Fuel Box */}
              <div className="card kpi-box kpi-fuel">
                <div className="card-title" style={{ color: 'var(--fuel-color)' }}>
                  <Fuel size={18} /> Verbrennerbetrieb (Benzin)
                </div>
                <div className="kpi-value" style={{ color: 'var(--fuel-color)' }}>
                  {stats ? formatKmCur(stats.fuelMetrics.costPerKm) : '...'}
                </div>
                <div className="kpi-sub" style={{ fontSize: '1rem', color: 'var(--text-main)', marginTop: '2px' }}>
                  <strong>{stats ? formatCur(stats.fuelMetrics.costPer100Km) : '...'}</strong> / 100 km
                </div>

                <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid rgba(245, 158, 11, 0.2)', fontSize: '0.85rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Realverbrauch:</span>
                    <strong>{stats ? formatNum(stats.fuelMetrics.literPer100Km, 1) : '...'} L/100km</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Erfasste Benzin-Distanz:</span>
                    <span>{stats ? formatNum(stats.fuelMetrics.totalFuelKm, 0) : '0'} km</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Getankt gesamt:</span>
                    <span>{stats ? formatNum(stats.fuelMetrics.totalLiter, 1) : '0'} L ({stats ? formatCur(stats.fuelMetrics.totalCost) : '0 €'})</span>
                  </div>
                  {stats?.fuelMetrics.isEstimate && (
                    <div style={{ color: '#fbbf24', fontSize: '0.75rem', marginTop: '6px' }}>
                      * Richtwert (noch keine Benzin-Kilometer erfasst)
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Interactive Live Break-Even Calculator */}
            <div className="card" style={{ marginTop: '8px' }}>
              <div className="card-title">
                <TrendingDown size={18} /> Interaktiver Break-Even Rechner (Lohnt sich Laden an Säule X?)
              </div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
                Verändere die Strom- und Spritpreise, um sofort zu sehen, ob sich das Laden an einer öffentlichen Station (z. B. VKW, EnBW, Ionity) gegenüber reinem Benzinbetrieb rechnet:
              </p>

              <div className="grid-2" style={{ marginBottom: '16px' }}>
                <div>
                  <label>Strompreis an der Ladesäule: {formatNum(simEvPrice, 2)} €/kWh</label>
                  <input
                    type="range"
                    min="0.15"
                    max="0.95"
                    step="0.01"
                    value={simEvPrice}
                    onChange={(e) => setSimEvPrice(Number(e.target.value))}
                    style={{ width: '100%', cursor: 'pointer' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    <span>0,15 € (PV/Nachttarif)</span>
                    <span>0,39 € (VKW)</span>
                    <span>0,79 € (DC Schnelllader)</span>
                  </div>
                </div>

                <div>
                  <label>Aktueller Spritpreis: {formatNum(simFuelPrice, 2)} €/L</label>
                  <input
                    type="range"
                    min="1.30"
                    max="2.30"
                    step="0.02"
                    value={simFuelPrice}
                    onChange={(e) => setSimFuelPrice(Number(e.target.value))}
                    style={{ width: '100%', cursor: 'pointer' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    <span>1,30 €/L</span>
                    <span>1,65 €/L (Durchschnitt)</span>
                    <span>2,30 €/L</span>
                  </div>
                </div>
              </div>

              {/* Simulation Result */}
              <div
                style={{
                  backgroundColor: 'var(--bg-input)',
                  padding: '14px',
                  borderRadius: '8px',
                  border: isSimEvCheaper ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(239, 68, 68, 0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '12px',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.95rem', color: isSimEvCheaper ? 'var(--ev-color)' : '#f87171' }}>
                    {isSimEvCheaper ? '✓ Ja, Laden ist günstiger!' : '✗ Nein, Benzinbetrieb ist günstiger!'}
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    Strom: {formatCur(simulatedEvCostPer100Km)} / 100km &nbsp;|&nbsp; Benzin: {formatCur(simulatedFuelCostPer100Km)} / 100km
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: isSimEvCheaper ? 'var(--ev-color)' : '#f87171' }}>
                    {isSimEvCheaper ? `-${formatCur(simulatedSavings)} Ersparnis` : `+${formatCur(-simulatedSavings)} teurer`}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>je 100 km Fahrt</div>
                </div>
              </div>
            </div>

            {/* Latest Snapshot / Odometer Summary */}
            {stats?.latestSnapshot && (
              <div className="card">
                <div className="card-title">
                  <Gauge size={18} /> Letzter Fahrzeug-Snapshot ({formatDate(stats.latestSnapshot.zeitpunkt)})
                </div>
                <div className="grid-3" style={{ textAlign: 'center' }}>
                  <div style={{ padding: '10px', background: 'var(--bg-input)', borderRadius: '8px' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Gesamtkilometerstand</div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{formatNum(stats.latestSnapshot.odometer_km, 0)} km</div>
                  </div>
                  <div style={{ padding: '10px', background: 'var(--bg-input)', borderRadius: '8px' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Akku & EV-Reichweite</div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--ev-color)' }}>
                      {stats.latestSnapshot.soc_percent !== null && stats.latestSnapshot.soc_percent !== undefined
                        ? `${formatNum(stats.latestSnapshot.soc_percent, 0)}%`
                        : ''}
                      {stats.latestSnapshot.ev_range_km
                        ? ` (${formatNum(stats.latestSnapshot.ev_range_km, 0)} km)`
                        : ''}
                      {!stats.latestSnapshot.soc_percent && !stats.latestSnapshot.ev_range_km && '-'}
                    </div>
                  </div>
                  <div style={{ padding: '10px', background: 'var(--bg-input)', borderRadius: '8px' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Benzin-Restreichweite</div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--fuel-color)' }}>
                      {stats.latestSnapshot.fuel_range_km ? `${formatNum(stats.latestSnapshot.fuel_range_km, 0)} km` : '-'}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB: CHARGING FORM */}
        {/* ========================================================================= */}
        {activeTab === 'charge' && (
          <div className="card" style={{ maxWidth: '600px', margin: '0 auto' }}>
            <div className="card-title" style={{ color: 'var(--ev-color)' }}>
              <Zap size={20} /> Ladevorgang erfassen
            </div>

            <form onSubmit={handleSaveCharge}>
              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label style={{ margin: 0 }}>Geladene Menge in kWh *</label>
                  <button
                    type="button"
                    onClick={() => {
                      if (!chargeCalcOpen && stats?.latestSnapshot?.soc_percent) {
                        setCalcEndPct(Math.round(stats.latestSnapshot.soc_percent));
                      }
                      setChargeCalcOpen(!chargeCalcOpen);
                    }}
                    style={{
                      background: 'none',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      padding: '2px 8px',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      color: 'var(--ev-color)',
                    }}
                  >
                    <Calculator size={13} /> {chargeCalcOpen ? 'Rechner schließen' : '🔋 Aus Akku-% berechnen'}
                  </button>
                </div>

                {chargeCalcOpen && (
                  <div
                    style={{
                      padding: '12px',
                      background: 'var(--bg-input)',
                      borderRadius: '8px',
                      marginBottom: '10px',
                      border: '1px solid rgba(16, 185, 129, 0.25)',
                    }}
                  >
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--ev-color)', marginBottom: '4px' }}>
                      🔋 Lade-Rechner (inkl. ~14% Ladeverlust)
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
                      Kia Ceed PHEV Akku: 8,9 kWh. Wegen Wandlungsverlusten (AC➔DC) zieht das Auto ab Steckdose ca. 8,3 kWh für 100%.
                    </div>
                    <div className="grid-2" style={{ gap: '10px', marginBottom: '8px' }}>
                      <div>
                        <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Start-Akkustand (%)</label>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={calcStartPct}
                          onChange={(e) => setCalcStartPct(Number(e.target.value))}
                          style={{ padding: '6px 8px', fontSize: '0.85rem' }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>End-Akkustand (%)</label>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={calcEndPct}
                          onChange={(e) => setCalcEndPct(Number(e.target.value))}
                          style={{ padding: '6px 8px', fontSize: '0.85rem' }}
                        />
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem' }}>
                      <span style={{ color: 'var(--text-muted)' }}>
                        Netto: +{Math.max(0, calcEndPct - calcStartPct)}% ➔ ab Steckdose: <strong style={{ color: 'var(--text-primary)' }}>{((Math.max(0, calcEndPct - calcStartPct) / 100) * 8.3).toFixed(2).replace('.', ',')} kWh</strong>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const val = ((Math.max(0, calcEndPct - calcStartPct) / 100) * 8.3).toFixed(2).replace('.', ',');
                          setChargeKwh(val);
                          setChargeCalcOpen(false);
                        }}
                        style={{
                          background: 'var(--ev-color)',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '6px',
                          padding: '5px 12px',
                          fontSize: '0.75rem',
                          cursor: 'pointer',
                          fontWeight: 600,
                        }}
                      >
                        In Feld übernehmen
                      </button>
                    </div>
                  </div>
                )}

                <input
                  type="text"
                  name="kwh"
                  required
                  placeholder="z.B. 7,5"
                  autoFocus
                  inputMode="decimal"
                  value={chargeKwh}
                  onChange={(e) => setChargeKwh(e.target.value)}
                />
                <div className="input-helper">Vom VKW-Display / Zähler oder oben per Akku-% berechnen</div>
              </div>

              <div className="grid-2">
                <div className="form-group">
                  <label>Ladequelle / Ort *</label>
                  <select name="quelle" defaultValue="zuhause">
                    <option value="zuhause">Zuhause (Haushaltsstrom)</option>
                    <option value="vkw">VKW / vlotte Ladekarte</option>
                    <option value="enbw">EnBW mobility+</option>
                    <option value="sonstige">Sonstige Ladesäule</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Preis pro kWh (€) (Optional)</label>
                  <input
                    type="text"
                    name="preis_pro_kwh"
                    placeholder="leer = Tarif der Quelle"
                    inputMode="decimal"
                  />
                  <div className="input-helper">Wenn leer, greift der hinterlegte Tarif</div>
                </div>
              </div>

              <div className="form-group">
                <label>Gesamtkosten (€) (Optional)</label>
                <input
                  type="text"
                  name="gesamtkosten"
                  placeholder="z.B. 2,10 (wird sonst auto-berechnet)"
                  inputMode="decimal"
                />
              </div>

              <div className="grid-2">
                <div className="form-group">
                  <label>Elektrisch gefahrene km (EV-Trip)</label>
                  <input
                    type="text"
                    name="ev_km"
                    placeholder="z.B. 48,0"
                    inputMode="decimal"
                    value={chargeEvKm}
                    onChange={(e) => setChargeEvKm(e.target.value)}
                  />
                  <div className="input-helper">Aus Bordcomputer / Trip-Zähler für genaue Kosten/km</div>
                </div>

                <div className="form-group">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <label style={{ margin: 0 }}>Gesamtkilometerstand (Tacho)</label>
                    {stats?.latestSnapshot?.odometer_km && (
                      <button
                        type="button"
                        onClick={() => setChargeOdo(Math.round(stats.latestSnapshot!.odometer_km).toString())}
                        style={{
                          background: 'none',
                          border: '1px solid var(--border-color)',
                          borderRadius: '6px',
                          padding: '2px 8px',
                          fontSize: '0.75rem',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          color: 'var(--primary-color)',
                        }}
                      >
                        ⚡ Kia Tacho ({Math.round(stats.latestSnapshot.odometer_km).toLocaleString('de-AT')} km)
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    name="odometer_km"
                    placeholder="z.B. 45200"
                    inputMode="numeric"
                    value={chargeOdo}
                    onChange={(e) => setChargeOdo(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Datum & Uhrzeit</label>
                <input
                  type="datetime-local"
                  name="zeitpunkt"
                  defaultValue={new Date().toISOString().slice(0, 16)}
                />
              </div>

              <div className="form-group">
                <label>Bemerkung / Standort</label>
                <input type="text" name="standort" placeholder="z.B. Wallbox Garage oder Filiale Dornbirn" />
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '24px' }}>
                <button type="submit" className="btn btn-primary" style={{ backgroundColor: 'var(--ev-color)' }}>
                  <CheckCircle2 size={18} /> Ladevorgang speichern
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setActiveTab('dashboard')}>
                  Abbrechen
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB: FUEL FORM */}
        {/* ========================================================================= */}
        {activeTab === 'fuel' && (
          <div className="card" style={{ maxWidth: '600px', margin: '0 auto' }}>
            <div className="card-title" style={{ color: 'var(--fuel-color)' }}>
              <Fuel size={20} /> Tankvorgang erfassen
            </div>

            <form onSubmit={handleSaveFuel}>
              <div className="form-group">
                <label>Getankte Liter *</label>
                <input
                  type="text"
                  name="liter"
                  required
                  placeholder="z.B. 32,5"
                  autoFocus
                  inputMode="decimal"
                />
              </div>

              <div className="grid-2">
                <div className="form-group">
                  <label>Preis pro Liter (€/L)</label>
                  <input
                    type="text"
                    name="preis_pro_liter"
                    placeholder="z.B. 1,629"
                    inputMode="decimal"
                  />
                </div>

                <div className="form-group">
                  <label>Gesamtkosten (€)</label>
                  <input
                    type="text"
                    name="gesamtkosten"
                    placeholder="z.B. 52,94"
                    inputMode="decimal"
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Tankstelle / Ort</label>
                <input type="text" name="tankstelle" placeholder="z.B. OMV Dornbirn, BP Lustenau" />
              </div>

              <div className="grid-2">
                <div className="form-group">
                  <label>Gefahrene Benzin-Kilometer</label>
                  <input
                    type="text"
                    name="fuel_km"
                    placeholder="z.B. 550"
                    inputMode="decimal"
                    value={fuelKm}
                    onChange={(e) => setFuelKm(e.target.value)}
                  />
                  <div className="input-helper">Mit Verbrenner gefahren seit letztem Tanken</div>
                </div>

                <div className="form-group">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <label style={{ margin: 0 }}>Gesamtkilometerstand (Tacho)</label>
                    {stats?.latestSnapshot?.odometer_km && (
                      <button
                        type="button"
                        onClick={() => setFuelOdo(Math.round(stats.latestSnapshot!.odometer_km).toString())}
                        style={{
                          background: 'none',
                          border: '1px solid var(--border-color)',
                          borderRadius: '6px',
                          padding: '2px 8px',
                          fontSize: '0.75rem',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          color: 'var(--primary-color)',
                        }}
                      >
                        ⚡ Kia Tacho ({Math.round(stats.latestSnapshot.odometer_km).toLocaleString('de-AT')} km)
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    name="odometer_km"
                    placeholder="z.B. 45800"
                    inputMode="numeric"
                    value={fuelOdo}
                    onChange={(e) => setFuelOdo(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input type="checkbox" name="vollgetankt" id="vollgetankt" defaultChecked style={{ width: 'auto' }} />
                <label htmlFor="vollgetankt" style={{ margin: 0, cursor: 'pointer' }}>Vollgetankt (für präzise Verbrauchsrechnung)</label>
              </div>

              <div className="form-group">
                <label>Datum & Uhrzeit</label>
                <input
                  type="datetime-local"
                  name="zeitpunkt"
                  defaultValue={new Date().toISOString().slice(0, 16)}
                />
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '24px' }}>
                <button type="submit" className="btn btn-primary" style={{ backgroundColor: 'var(--fuel-color)' }}>
                  <CheckCircle2 size={18} /> Tankvorgang speichern
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setActiveTab('dashboard')}>
                  Abbrechen
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB: SNAPSHOT FORM */}
        {/* ========================================================================= */}
        {activeTab === 'snapshot' && (
          <div className="card" style={{ maxWidth: '600px', margin: '0 auto' }}>
            <div className="card-title">
              <Gauge size={20} /> Tacho & Fahrzeug-Snapshot erfassen
            </div>

            <form onSubmit={handleSaveSnapshot}>
              <div className="form-group">
                <label>Gesamtkilometerstand (km) *</label>
                <input
                  type="text"
                  name="odometer_km"
                  required
                  placeholder="z.B. 46000"
                  autoFocus
                  inputMode="numeric"
                />
              </div>

              <div className="grid-2">
                <div className="form-group">
                  <label>Restreichweite EV (km)</label>
                  <input type="text" name="ev_range_km" placeholder="z.B. 42" inputMode="numeric" />
                </div>
                <div className="form-group">
                  <label>Restreichweite Benzin (km)</label>
                  <input type="text" name="fuel_range_km" placeholder="z.B. 520" inputMode="numeric" />
                </div>
              </div>

              <div className="form-group">
                <label>Batteriestand SoC (%)</label>
                <input type="text" name="soc_percent" placeholder="z.B. 85" inputMode="numeric" />
              </div>

              <div className="form-group">
                <label>Datum & Uhrzeit</label>
                <input
                  type="datetime-local"
                  name="zeitpunkt"
                  defaultValue={new Date().toISOString().slice(0, 16)}
                />
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '24px' }}>
                <button type="submit" className="btn btn-primary">
                  <CheckCircle2 size={18} /> Snapshot speichern
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setActiveTab('dashboard')}>
                  Abbrechen
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB: HISTORY */}
        {/* ========================================================================= */}
        {activeTab === 'history' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  className={`btn ${historyFilter === 'all' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ width: 'auto', padding: '6px 12px', fontSize: '0.85rem' }}
                  onClick={() => setHistoryFilter('all')}
                >
                  Alle ({chargingList.length + fuelList.length + snapshotList.length})
                </button>
                <button
                  className={`btn ${historyFilter === 'charge' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ width: 'auto', padding: '6px 12px', fontSize: '0.85rem' }}
                  onClick={() => setHistoryFilter('charge')}
                >
                  ⚡ Ladungen ({chargingList.length})
                </button>
                <button
                  className={`btn ${historyFilter === 'fuel' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ width: 'auto', padding: '6px 12px', fontSize: '0.85rem' }}
                  onClick={() => setHistoryFilter('fuel')}
                >
                  ⛽ Tanken ({fuelList.length})
                </button>
                <button
                  className={`btn ${historyFilter === 'snapshot' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ width: 'auto', padding: '6px 12px', fontSize: '0.85rem' }}
                  onClick={() => setHistoryFilter('snapshot')}
                >
                  📸 Snapshots ({snapshotList.length})
                </button>
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button
                  className="btn btn-secondary"
                  style={{ width: 'auto', padding: '6px 12px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}
                  onClick={() => setHistorySortOrder(historySortOrder === 'desc' ? 'asc' : 'desc')}
                  title="Nach Datum sortieren"
                >
                  📅 {historySortOrder === 'desc' ? 'Neueste zuerst ⬇️' : 'Älteste zuerst ⬆️'}
                </button>

                <button className="btn btn-secondary" style={{ width: 'auto', padding: '6px 12px', fontSize: '0.85rem' }} onClick={loadHistory}>
                  <RefreshCw size={14} /> Aktualisieren
                </button>
              </div>
            </div>

            {/* Unified Chronological Timeline */}
            {(() => {
              const items: Array<
                | { type: 'charge'; zeitpunkt: string; data: ChargingSession }
                | { type: 'fuel'; zeitpunkt: string; data: FuelSession }
                | { type: 'snapshot'; zeitpunkt: string; data: VehicleSnapshot }
              > = [];

              if (historyFilter === 'all' || historyFilter === 'charge') {
                chargingList.forEach((c) => items.push({ type: 'charge', zeitpunkt: c.zeitpunkt, data: c }));
              }
              if (historyFilter === 'all' || historyFilter === 'fuel') {
                fuelList.forEach((f) => items.push({ type: 'fuel', zeitpunkt: f.zeitpunkt, data: f }));
              }
              if (historyFilter === 'all' || historyFilter === 'snapshot') {
                snapshotList.forEach((s) => items.push({ type: 'snapshot', zeitpunkt: s.zeitpunkt, data: s }));
              }

              items.sort((a, b) => {
                const tA = new Date(a.zeitpunkt).getTime() || 0;
                const tB = new Date(b.zeitpunkt).getTime() || 0;
                return historySortOrder === 'desc' ? tB - tA : tA - tB;
              });

              if (items.length === 0) {
                return (
                  <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                    Noch keine Einträge vorhanden.
                  </div>
                );
              }

              return items.map((item) => {
                if (item.type === 'charge') {
                  const c = item.data;
                  return (
                    <div key={`charge-${c.id}`} className="list-item" style={{ borderLeft: '4px solid var(--ev-color)' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span className="badge badge-ev">⚡ Ladung</span>
                          <span style={{ fontWeight: 600 }}>{formatNum(c.kwh, 2)} kWh</span>
                          <span style={{ color: 'var(--text-muted)' }}>({c.quelle})</span>
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                          {formatDate(c.zeitpunkt)}
                          {c.ev_km ? ` • EV-Trip: ${formatNum(c.ev_km, 1)} km` : ''}
                          {c.odometer_km ? ` • Tacho: ${formatNum(c.odometer_km, 0)} km` : ''}
                          {c.standort ? ` • ${c.standort}` : ''}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontWeight: 700, color: 'var(--ev-color)' }}>{formatCur(c.gesamtkosten)}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{formatNum(c.preis_pro_kwh, 3)} €/kWh</div>
                        </div>
                        <button
                          style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
                          title="Löschen"
                          onClick={async () => {
                            if (confirm('Ladevorgang wirklich löschen?')) {
                              await deleteChargingSession(c.id);
                              loadHistory();
                              loadDashboard();
                            }
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  );
                }

                if (item.type === 'fuel') {
                  const f = item.data;
                  return (
                    <div key={`fuel-${f.id}`} className="list-item" style={{ borderLeft: '4px solid var(--fuel-color)' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span className="badge badge-fuel">⛽ Tanken</span>
                          <span style={{ fontWeight: 600 }}>{formatNum(f.liter, 2)} L</span>
                          <span style={{ color: 'var(--text-muted)' }}>({f.tankstelle})</span>
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                          {formatDate(f.zeitpunkt)}
                          {f.fuel_km ? ` • Benzin-Trip: ${formatNum(f.fuel_km, 1)} km` : ''}
                          {f.odometer_km ? ` • Tacho: ${formatNum(f.odometer_km, 0)} km` : ''}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontWeight: 700, color: 'var(--fuel-color)' }}>{formatCur(f.gesamtkosten)}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{formatNum(f.preis_pro_liter, 3)} €/L</div>
                        </div>
                        <button
                          style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
                          title="Löschen"
                          onClick={async () => {
                            if (confirm('Tankvorgang wirklich löschen?')) {
                              await deleteFuelSession(f.id);
                              loadHistory();
                              loadDashboard();
                            }
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  );
                }

                if (item.type === 'snapshot') {
                  const s = item.data;
                  return (
                    <div key={`snap-${s.id}`} className="list-item" style={{ borderLeft: '4px solid #38bdf8' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span className="badge" style={{ backgroundColor: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8' }}>📸 Tacho</span>
                          <span style={{ fontWeight: 600 }}>{formatNum(s.odometer_km, 0)} km</span>
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                          {formatDate(s.zeitpunkt)}
                          {s.ev_range_km ? ` • EV: ${formatNum(s.ev_range_km, 0)} km` : ''}
                          {s.fuel_range_km ? ` • Benzin: ${formatNum(s.fuel_range_km, 0)} km` : ''}
                        </div>
                      </div>
                      <button
                        style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
                        title="Löschen"
                        onClick={async () => {
                          if (confirm('Snapshot löschen?')) {
                            await deleteSnapshot(s.id);
                            loadHistory();
                            loadDashboard();
                          }
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  );
                }

                return null;
              });
            })()}
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB: SETTINGS & TARIFFS */}
        {/* ========================================================================= */}
        {activeTab === 'settings' && (
          <div>
            {/* Tariffs List */}
            <div className="card">
              <div className="card-title">
                <Settings size={18} /> Hinterlegte Ladetarife
              </div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
                Diese Tarife dienen als automatische Preisvorbelegung, falls bei einer Ladung kein individueller Preis eingetragen wird.
              </p>

              {tariffs.map((t) => (
                <div key={t.id} className="list-item">
                  <div>
                    <strong>{t.bezeichnung}</strong>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Quelle-Key: <code>{t.quelle}</code> • Gültig ab: {t.gueltig_ab}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ fontWeight: 700, color: 'var(--ev-color)' }}>
                      {formatNum(t.preis_pro_kwh, 3)} €/kWh
                    </div>
                    <button
                      style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
                      title="Tarif löschen"
                      onClick={async () => {
                        if (confirm(`Tarif "${t.bezeichnung}" löschen?`)) {
                          await deleteTariff(t.id);
                          loadTariffs();
                        }
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}

              {/* Form to add a new tariff */}
              <form onSubmit={handleAddTariff} style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
                <h4 style={{ fontSize: '0.95rem', marginBottom: '12px' }}>Neuen Tarif hinzufügen</h4>
                <div className="grid-2">
                  <div className="form-group">
                    <label>Quelle (z.B. zuhause, vkw, enbw) *</label>
                    <input type="text" name="quelle" required placeholder="z.B. vkw" />
                  </div>
                  <div className="form-group">
                    <label>Bezeichnung *</label>
                    <input type="text" name="bezeichnung" required placeholder="z.B. VKW Ladetarif 2026" />
                  </div>
                </div>
                <div className="grid-2">
                  <div className="form-group">
                    <label>Preis pro kWh (€) *</label>
                    <input type="text" name="preis_pro_kwh" required placeholder="z.B. 0,38" inputMode="decimal" />
                  </div>
                  <div className="form-group">
                    <label>Gültig ab (Datum) *</label>
                    <input type="date" name="gueltig_ab" required defaultValue={new Date().toISOString().slice(0, 10)} />
                  </div>
                </div>
                <button type="submit" className="btn btn-secondary" style={{ width: 'auto' }}>
                  + Tarif speichern
                </button>
              </form>
            </div>

            {/* Kia Connect / UVO Integration */}
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                <div className="card-title" style={{ margin: 0 }}>
                  <RefreshCw size={18} color="#38bdf8" /> Kia Connect / UVO Telemetrie
                </div>
                <span
                  className="badge"
                  style={{
                    backgroundColor: kiaStatus?.configured ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                    color: kiaStatus?.configured ? '#34d399' : '#fbbf24',
                  }}
                >
                  {kiaStatus?.configured ? `🟢 Verbunden (${kiaStatus.username})` : '🟡 Nicht eingerichtet'}
                </span>
              </div>

              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
                Ruft automatisch den aktuellen Gesamtkilometerstand, Akkuladestand (SOC) und Restreichweiten aus deinem Kia Connect Konto ab.
                Standardmäßig wird der batterieschonende Cloud-Cache verwendet (kein Wecken des Fahrzeugs / keine 12V-Entladung).
              </p>

              {/* Sync Actions */}
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '20px' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ width: 'auto' }}
                  onClick={() => handleKiaSync(false)}
                  disabled={isKiaSyncing}
                >
                  <RefreshCw size={16} className={isKiaSyncing ? 'spin' : ''} />
                  {isKiaSyncing ? 'Synchronisiere...' : 'Jetzt Telemetrie abrufen (Cache)'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ width: 'auto' }}
                  onClick={() => handleKiaSync(true)}
                  disabled={isKiaSyncing}
                  title="Weckt das Auto auf für Echtzeitdaten"
                >
                  📡 Live-Fahrzeugabfrage erzwingen
                </button>
              </div>

              {/* Configuration Form */}
              <form onSubmit={handleSaveKiaConfig} style={{ paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
                <h4 style={{ fontSize: '0.95rem', marginBottom: '12px' }}>Kia Connect Zugangsdaten</h4>
                <div className="grid-2">
                  <div className="form-group">
                    <label>Kia Account E-Mail / Benutzername *</label>
                    <input
                      type="email"
                      value={kiaUsernameInput}
                      onChange={(e) => setKiaUsernameInput(e.target.value)}
                      required
                      placeholder="deine-kia-email@beispiel.de"
                    />
                  </div>
                  <div className="form-group">
                    <label>Passwort {kiaStatus?.configured ? '(leer lassen um beizubehalten)' : '*'}</label>
                    <input
                      type="password"
                      value={kiaPasswordInput}
                      onChange={(e) => setKiaPasswordInput(e.target.value)}
                      placeholder={kiaStatus?.configured ? '••••••••' : 'Kia Connect Passwort'}
                    />
                  </div>
                </div>

                <div className="grid-2">
                  <div className="form-group">
                    <label>PIN (optional, meist nicht erforderlich)</label>
                    <input
                      type="password"
                      value={kiaPinInput}
                      onChange={(e) => setKiaPinInput(e.target.value)}
                      placeholder="PIN falls vergeben"
                      maxLength={6}
                    />
                  </div>
                  <div className="form-group" style={{ display: 'flex', alignItems: 'center', marginTop: '24px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', margin: 0 }}>
                      <input
                        type="checkbox"
                        checked={kiaForceRefresh}
                        onChange={(e) => setKiaForceRefresh(e.target.checked)}
                        style={{ width: 'auto' }}
                      />
                      Standardmäßig Live-Abfrage erzwingen (Force)
                    </label>
                  </div>
                </div>

                <button type="submit" className="btn btn-secondary" style={{ width: 'auto' }}>
                  Zugangsdaten speichern
                </button>
              </form>
            </div>

            {/* Backup Management */}
            <div className="card">
              <div className="card-title">
                <Database size={18} /> Datenbank & Datensicherung
              </div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
                Die SQLite-Datenbank wird täglich automatisch gesichert. Hier kann jederzeit eine manuelle Sicherungskopie erzeugt werden.
              </p>
              <button className="btn btn-primary" style={{ width: 'auto' }} onClick={handleBackup}>
                <Database size={16} /> Manuelles Backup jetzt ausführen
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Mobile Bottom Navigation Bar */}
      <nav className="nav-mobile">
        <button className={`mobile-tab ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>
          <Gauge size={20} />
          <span>Dashboard</span>
        </button>
        <button className={`mobile-tab ${activeTab === 'charge' ? 'active' : ''}`} onClick={() => setActiveTab('charge')}>
          <Zap size={20} />
          <span>Laden</span>
        </button>
        <button className={`mobile-tab ${activeTab === 'fuel' ? 'active' : ''}`} onClick={() => setActiveTab('fuel')}>
          <Fuel size={20} />
          <span>Tanken</span>
        </button>
        <button className={`mobile-tab ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>
          <History size={20} />
          <span>Verlauf</span>
        </button>
        <button className={`mobile-tab ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>
          <Settings size={20} />
          <span>Setup</span>
        </button>
      </nav>
    </div>
  );
}

export default App;
