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
  Database,
  Calculator,
  Lock,
  Unlock,
  MapPin,
  AlertTriangle,
  Car,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Power,
  Radio,
  Battery,
  BatteryCharging,
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
  sendKiaRemoteControl,
  fetchBreakEvenSettings,
  saveBreakEvenSettings,
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
  const [simEvPriceInput, setSimEvPriceInput] = useState('0,28');
  const [simFuelPriceInput, setSimFuelPriceInput] = useState('1,65');
  const [showSimulator, setShowSimulator] = useState(false);

  // Kia Connect integration state
  const [kiaStatus, setKiaStatus] = useState<KiaStatus | null>(null);
  const [isKiaSyncing, setIsKiaSyncing] = useState(false);
  const [kiaUsernameInput, setKiaUsernameInput] = useState('');
  const [kiaPasswordInput, setKiaPasswordInput] = useState('');
  const [kiaPinInput, setKiaPinInput] = useState('');
  const [kiaForceRefresh, setKiaForceRefresh] = useState(false);
  const [showVehicleMap, setShowVehicleMap] = useState(false);
  const [dashboardTheme, setDashboardTheme] = useState<'oled' | 'blue'>(
    () => (localStorage.getItem('dashboard-theme') as 'oled' | 'blue' | null) || 'oled',
  );

  // Kia Remote Controls state
  const [isRemoteLoading, setIsRemoteLoading] = useState(false);
  const [remoteActionActive, setRemoteActionActive] = useState<string | null>(null);

  // Helper toast notification
  const showToast = (text: string, type: 'success' | 'warn' = 'success') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 4000);
  };

  useEffect(() => {
    document.documentElement.dataset.dashboardTheme = dashboardTheme;
    localStorage.setItem('dashboard-theme', dashboardTheme);
  }, [dashboardTheme]);

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
      const savedSettings = await fetchBreakEvenSettings(1);
      const evPrice = savedSettings.electricityPricePerKwh ?? data.breakEven.electricityPricePerKwh;
      const fuelPrice = savedSettings.fuelPricePerLiter ?? data.breakEven.fuelPricePerLiter;
      setSimEvPrice(evPrice);
      setSimFuelPrice(fuelPrice);
      setSimEvPriceInput(String(evPrice).replace('.', ','));
      setSimFuelPriceInput(String(fuelPrice).replace('.', ','));
    } catch (err) {
      console.warn('Backend nicht erreichbar, nutze gecachte Daten falls vorhanden:', err);
      const cached = getCachedDashboard();
      if (cached) {
        setStats(cached);
        setSimEvPrice(cached.breakEven.electricityPricePerKwh);
        setSimFuelPrice(cached.breakEven.fuelPricePerLiter);
        setSimEvPriceInput(String(cached.breakEven.electricityPricePerKwh).replace('.', ','));
        setSimFuelPriceInput(String(cached.breakEven.fuelPricePerLiter).replace('.', ','));
      }
    } finally {
      setLoading(false);
    }
  };

  const saveSimulatorPrices = async (evInput: string, fuelInput: string) => {
    const evPrice = Number(evInput.replace(',', '.'));
    const fuelPrice = Number(fuelInput.replace(',', '.'));
    if (!Number.isFinite(evPrice) || evPrice <= 0 || !Number.isFinite(fuelPrice) || fuelPrice <= 0) return;

    setSimEvPrice(evPrice);
    setSimFuelPrice(fuelPrice);
    try {
      await saveBreakEvenSettings(evPrice, fuelPrice);
    } catch (err: any) {
      showToast(err.message || 'Break-Even-Preise konnten nicht gespeichert werden', 'warn');
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
    if (activeTab === 'charge') {
      if (!chargeOdo && stats?.latestSnapshot?.odometer_km) {
        setChargeOdo(Math.round(stats.latestSnapshot.odometer_km).toString());
      }
    }
    if (activeTab === 'fuel') {
      if (!fuelOdo && stats?.latestSnapshot?.odometer_km) {
        setFuelOdo(Math.round(stats.latestSnapshot.odometer_km).toString());
      }
    }
  }, [activeTab, stats]);

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
    if (force) {
      showToast('📡 Live-Abfrage: Fahrzeug wird geweckt (dauert ca. 20-30 Sek.)...', 'warn');
    }
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

  const handleRemoteCommand = async (payload: {
    action: 'lock' | 'unlock' | 'start_climate' | 'stop_climate' | 'start_charge' | 'stop_charge';
    temp?: number;
    duration?: number;
    defrost?: boolean;
    steering_wheel?: boolean;
  }) => {
    if (isRemoteLoading) return;
    setIsRemoteLoading(true);
    setRemoteActionActive(payload.action);
    try {
      showToast(`Befehl '${payload.action}' wird an Fahrzeug gesendet...`, 'warn');
      const res = await sendKiaRemoteControl(payload);
      showToast(res.message || 'Befehl erfolgreich ausgeführt!');

      // Immediately update lock and charging state in the UI
      if (stats?.latestSnapshot) {
        const newLocked = payload.action === 'lock' ? 1 : (payload.action === 'unlock' ? 0 : stats.latestSnapshot.is_locked);
        const newCharging = payload.action === 'start_charge' ? 1 : (payload.action === 'stop_charge' ? 0 : stats.latestSnapshot.is_charging);
        setStats(prev => prev && prev.latestSnapshot ? {
          ...prev,
          latestSnapshot: {
            ...prev.latestSnapshot,
            is_locked: newLocked,
            is_charging: newCharging,
          }
        } : prev);
      }

      await loadDashboard();
    } catch (err: any) {
      alert(err.message || 'Remote-Befehl fehlgeschlagen');
    } finally {
      setIsRemoteLoading(false);
      setRemoteActionActive(null);
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
            <div className="brand-icon-box">
              <Car size={18} />
            </div>
            <span>PHEV Tracker</span>
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
              <Settings size={18} /> Setup
            </button>
          </nav>

          {/* Connection / Sync indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {isOnline ? (
              <span className="badge-online-pill" title="Verbunden mit Server">
                <span className="dot" /> Online
              </span>
            ) : (
              <span className="badge-offline-pill" title="Offline-Modus: Daten werden lokal gespeichert">
                <span className="dot" /> Offline
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
          {activeTab === 'dashboard' && (() => {
            const snap = stats?.latestSnapshot;
            const parseJsonSafe = <T,>(str?: string | null, fallback: T = {} as T): T => {
              if (!str) return fallback;
              try {
                return JSON.parse(str);
              } catch {
                return fallback;
              }
            };

            const doors = parseJsonSafe<Record<string, boolean>>(snap?.doors_open_json, {});
            const windows = parseJsonSafe<Record<string, boolean>>(snap?.windows_open_json, {});

            const openDoorsList: string[] = [];
            if (doors.front_left) openDoorsList.push('Fahrertür');
            if (doors.front_right) openDoorsList.push('Beifahrertür');
            if (doors.back_left) openDoorsList.push('Tür hinten links');
            if (doors.back_right) openDoorsList.push('Tür hinten rechts');
            if (doors.trunk) openDoorsList.push('Kofferraum');
            if (doors.hood) openDoorsList.push('Motorhaube');

            const openWindowsList: string[] = [];
            if (windows.front_left) openWindowsList.push('Vorne links');
            if (windows.front_right) openWindowsList.push('Vorne rechts');
            if (windows.back_left) openWindowsList.push('Hinten links');
            if (windows.back_right) openWindowsList.push('Hinten rechts');

            const hasOpenItems = openDoorsList.length > 0 || openWindowsList.length > 0;
            const hasWarnings = Boolean(snap?.tire_pressure_warning || snap?.washer_fluid_warning || snap?.smart_key_warning);

            const is12vLow = snap?.car_12v_percent !== null && snap?.car_12v_percent !== undefined && snap.car_12v_percent < 50;
            const is12vMed = snap?.car_12v_percent !== null && snap?.car_12v_percent !== undefined && snap.car_12v_percent >= 50 && snap.car_12v_percent < 65;

            const renderControlCard = () => (
              <div className="control-card">
                <div className="control-card-title">BEDIENUNG</div>
                <div className="control-btn-grid">
                  <button
                    type="button"
                    className="control-btn-lock"
                    disabled={isRemoteLoading}
                    onClick={() => {
                      if (!kiaStatus?.configured) {
                        showToast('Kia Connect Zugangsdaten bitte zuerst in Setup hinterlegen', 'warn');
                        return;
                      }
                      handleRemoteCommand({ action: 'lock' });
                    }}
                    title="Auto verriegeln"
                  >
                    <Lock size={24} />
                    <span>Verriegeln</span>
                  </button>

                  <button
                    type="button"
                    className="control-btn-unlock"
                    disabled={isRemoteLoading}
                    onClick={() => {
                      if (!kiaStatus?.configured) {
                        showToast('Kia Connect Zugangsdaten bitte zuerst in Setup hinterlegen', 'warn');
                        return;
                      }
                      if (window.confirm('Möchtest du das Fahrzeug wirklich aus der Ferne entriegeln?')) {
                        handleRemoteCommand({ action: 'unlock' });
                      }
                    }}
                    title="Auto entriegeln"
                  >
                    <Unlock size={24} />
                    <span>Entriegeln</span>
                  </button>
                </div>

                <button
                  type="button"
                  className="control-btn-charge"
                  disabled={isRemoteLoading}
                  onClick={() => {
                    if (!kiaStatus?.configured) {
                      showToast('Kia Connect Zugangsdaten bitte zuerst in Setup hinterlegen', 'warn');
                      return;
                    }
                    if (snap?.is_charging) {
                      handleRemoteCommand({ action: 'stop_charge' });
                    } else {
                      handleRemoteCommand({ action: 'start_charge' });
                    }
                  }}
                  style={{
                    color: snap?.is_charging ? '#f59e0b' : '#94a3b8',
                    borderColor: snap?.is_charging ? 'rgba(245, 158, 11, 0.4)' : undefined,
                  }}
                >
                  {isRemoteLoading && remoteActionActive?.includes('charge') ? (
                    <RefreshCw size={15} className="spin" />
                  ) : (
                    <Power size={15} />
                  )}
                  <span>{snap?.is_charging ? 'Laden Stoppen' : 'Laden Starten'}</span>
                </button>
              </div>
            );

            const renderStatusCard = (isDesktop: boolean) => (
              <div className={`status-card ${isDesktop ? 'status-card-desktop' : ''}`}>
                <div className="status-card-header">
                  <div>
                    <div className="status-card-title">FAHRZEUGSTATUS</div>
                    <div className="status-card-subtitle">
                      Stand: {formatDate(snap?.zeitpunkt || new Date().toISOString())}
                    </div>
                  </div>

                  <div className="status-sync-btns">
                    <button
                      type="button"
                      onClick={() => {
                        if (!kiaStatus?.configured) {
                          showToast('Kia Connect noch nicht eingerichtet in Setup', 'warn');
                          return;
                        }
                        handleKiaSync(false);
                      }}
                      disabled={isKiaSyncing}
                      className="status-sync-btn"
                      title="Schneller Cloud-Sync"
                    >
                      <RefreshCw size={12} className={isKiaSyncing ? 'spin' : ''} />
                      Schnell Sync
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!kiaStatus?.configured) {
                          showToast('Kia Connect noch nicht eingerichtet in Setup', 'warn');
                          return;
                        }
                        handleKiaSync(true);
                      }}
                      disabled={isKiaSyncing}
                      className="status-sync-btn"
                      title="Live Aufweck-Sync per Mobilfunk"
                    >
                      <Radio size={12} className={isKiaSyncing ? 'spin' : ''} />
                      Live Sync
                    </button>
                  </div>
                </div>

                <div className={`status-grid status-grid-tiles ${isDesktop ? 'status-grid-desktop' : ''}`}>
                  {/* Left Column: Tacho & HV-Akku */}
                  <div className="status-tile">
                    <Gauge size={22} style={{ color: '#cbd5e1' }} />
                    <div className="status-metric-label">TACHO</div>
                    <div className="status-metric-val">
                      {formatNum(snap?.odometer_km || 0, 0)} km
                    </div>

                  </div>

                  <div className="status-tile">
                    <Fuel size={22} style={{ color: '#fbbf24' }} />
                    <div className="status-metric-label">REICHWEITE (BENZIN)</div>
                    <div className="status-metric-val">
                      {snap?.fuel_range_km ? `${formatNum(snap.fuel_range_km, 0)} km` : '- km'}
                    </div>

                  </div>

                  <div className="status-tile">
                    <BatteryCharging className="status-tile-icon" style={{ color: '#22c55e' }} />
                    <div className="status-battery-label"><span>HV-AKKU</span></div>
                    <div className="status-battery-val" style={{ color: '#22c55e' }}>
                      {snap?.soc_percent !== null && snap?.soc_percent !== undefined ? `${formatNum(snap.soc_percent, 0)}%` : '-%'}
                      {snap?.ev_range_km ? ` (${formatNum(snap.ev_range_km, 0)} km)` : ''}
                    </div>
                    <div className="status-progress-track">
                      <div className="status-progress-fill" style={{ width: `${Math.min(100, Math.max(0, snap?.soc_percent || 0))}%`, backgroundColor: '#22c55e' }} />
                    </div>
                    <div className="status-subtext">{snap?.charge_remaining_min ? `ca. ${snap.charge_remaining_min} Min. bis voll` : 'Optimaler Zustand'}</div>
                  </div>

                  <div className="status-tile">
                    <Battery className="status-tile-icon" style={{ color: is12vLow ? '#ef4444' : is12vMed ? '#f59e0b' : '#10b981' }} />
                    <div className="status-battery-label"><span>12V-AKKU</span></div>
                    <div
                      className="status-battery-val"
                      style={{ color: is12vLow ? '#ef4444' : is12vMed ? '#f59e0b' : '#10b981' }}
                    >
                      {snap?.car_12v_percent !== null && snap?.car_12v_percent !== undefined ? `${snap.car_12v_percent}%` : '-%'}
                    </div>

                    <div className="status-progress-track">
                      <div
                        className="status-progress-fill"
                        style={{
                          width: `${Math.min(100, Math.max(0, snap?.car_12v_percent || 0))}%`,
                          backgroundColor: is12vLow ? '#ef4444' : is12vMed ? '#f59e0b' : '#10b981',
                        }}
                      />
                    </div>

                    <div className="status-subtext">
                      {is12vLow ? '⚠️ Bitte bald laden' : is12vMed ? 'Normale Entladung' : 'Optimaler Zustand'}
                    </div>
                  </div>
                </div>

                {/* Warnings or open items banner if any */}
                {hasOpenItems && (
                  <div className="status-warning-banner">
                    <AlertTriangle size={15} style={{ color: '#ef4444', flexShrink: 0 }} />
                    <div>
                      Geöffnet: {openDoorsList.concat(openWindowsList).join(', ')}
                    </div>
                  </div>
                )}
                {hasWarnings && (
                  <div className="status-warning-banner">
                    <AlertTriangle size={15} style={{ color: '#f59e0b', flexShrink: 0 }} />
                    <div>
                      Warnung:{' '}
                      {[
                        snap?.tire_pressure_warning && 'Reifendruck',
                        snap?.washer_fluid_warning && 'Scheibenwaschwasser',
                        snap?.smart_key_warning && 'Schlüsselbatterie',
                      ]
                        .filter(Boolean)
                        .join(', ')}
                    </div>
                  </div>
                )}
              </div>
            );

            const renderSavingsCard = () => {
              if (!stats) return null;
              return (
                <div className="savings-banner-card">
                  <div className="savings-banner-title">Spar-Status</div>
                  <div className={`savings-banner-box ${stats.breakEven.isEvCheaper ? '' : 'fuel-cheaper'}`}>
                    <div className="savings-icon-box">
                      <Zap size={20} />
                    </div>
                    <div>
                      <div className="savings-title-text">
                        {stats.breakEven.isEvCheaper ? 'AKTUELL SPAREND (Strom)' : 'AKTUELL SPAREND (Benzin)'}
                      </div>
                      <div className="savings-sub-text">
                        Schwelle: {formatNum(stats.breakEven.breakEvenElectricityPricePerKwh, 3)} €/kWh |{' '}
                        {stats.breakEven.isEvCheaper ? '+' : ''}
                        {formatCur(stats.breakEven.savingsPer100Km)} / 100 km
                      </div>
                    </div>
                  </div>
                </div>
              );
            };

            const renderCostCard = () => {
              if (!stats) return null;
              return (
                <div className="cost-card">
                  <div className="cost-card-title">KOSTEN-VERGLEICH</div>
                  <div className="cost-card-grid">
                    {/* EV Column */}
                    <div className="cost-col-ev">
                      <div className="cost-col-header-ev">ELEKTROBETRIEB</div>
                      <div className="cost-col-main-val-ev">{formatKmCur(stats.evMetrics.costPerKm)}</div>
                      <div className="cost-col-sub-val">
                        {formatCur(stats.evMetrics.costPer100Km)} / {formatNum(stats.evMetrics.kwhPer100Km, 1)} kWh/100 km
                      </div>

                      <div className="cost-details-list">
                        <div className="cost-detail-row">
                          <span>Realverbrauch</span>
                          <strong>{formatNum(stats.evMetrics.kwhPer100Km, 1)} kWh/100 km</strong>
                        </div>
                        <div className="cost-detail-row">
                          <span>Erfasste EV Distanz</span>
                          <span>{formatNum(stats.evMetrics.totalEvKm, 0)} km</span>
                        </div>
                        <div className="cost-detail-row">
                          <span>Geladene Energie</span>
                          <span>{formatNum(stats.evMetrics.totalKwh, 1)} kWh</span>
                        </div>
                        <div className="cost-detail-row">
                          <span>Ladekosten gesamt</span>
                          <span>{formatCur(stats.evMetrics.totalCost)}</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        className="cost-btn-details-ev"
                        onClick={() => setShowSimulator(!showSimulator)}
                      >
                        DETAILS
                      </button>
                    </div>

                    {/* Fuel Column */}
                    <div className="cost-col-fuel">
                      <div className="cost-col-header-fuel">VERBRENNERBETRIEB</div>
                      <div className="cost-col-main-val-fuel">{formatKmCur(stats.fuelMetrics.costPerKm)}</div>
                      <div className="cost-col-sub-val">
                        {formatCur(stats.fuelMetrics.costPer100Km)} / {formatNum(stats.fuelMetrics.literPer100Km, 1)} L/100 km
                      </div>

                      <div className="cost-details-list">
                        <div className="cost-detail-row">
                          <span>Realverbrauch</span>
                          <strong>{formatNum(stats.fuelMetrics.literPer100Km, 1)} L/100 km</strong>
                        </div>
                        <div className="cost-detail-row">
                          <span>Erfasste Benzin Distanz</span>
                          <span>{formatNum(stats.fuelMetrics.totalFuelKm, 0)} km</span>
                        </div>
                        <div className="cost-detail-row">
                          <span>Erfasste Distanz</span>
                          <span>{formatNum((stats.evMetrics.totalEvKm || 0) + (stats.fuelMetrics.totalFuelKm || 0), 0)} gesamt</span>
                        </div>
                        <div className="cost-detail-row">
                          <span>Getankt gesamt</span>
                          <span>{formatCur(stats.fuelMetrics.totalCost)}</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        className="cost-btn-details-fuel"
                        onClick={() => setShowSimulator(!showSimulator)}
                      >
                        DETAILS
                      </button>
                    </div>
                  </div>

                  {/* Interactive Break-Even Simulator when toggled */}
                  {showSimulator && (
                    <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                        <strong style={{ fontSize: '0.88rem', color: '#cbd5e1', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <TrendingDown size={16} /> Interaktiver Break-Even Rechner
                        </strong>
                        <button
                          type="button"
                          onClick={() => setShowSimulator(false)}
                          style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '0.8rem' }}
                        >
                          Schließen
                        </button>
                      </div>
                      <div className="grid-2" style={{ marginBottom: '12px' }}>
                        <div>
                          <label htmlFor="sim-ev-price" style={{ fontSize: '0.75rem' }}>Strompreis (€/kWh)</label>
                          <input
                            id="sim-ev-price"
                            className="price-input"
                            type="text"
                            inputMode="decimal"
                            value={simEvPriceInput}
                            onChange={(e) => setSimEvPriceInput(e.target.value)}
                            onBlur={() => saveSimulatorPrices(simEvPriceInput, simFuelPriceInput)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') e.currentTarget.blur();
                            }}
                          />
                        </div>
                        <div>
                          <label htmlFor="sim-fuel-price" style={{ fontSize: '0.75rem' }}>Spritpreis (€/L)</label>
                          <input
                            id="sim-fuel-price"
                            className="price-input"
                            type="text"
                            inputMode="decimal"
                            value={simFuelPriceInput}
                            onChange={(e) => setSimFuelPriceInput(e.target.value)}
                            onBlur={() => saveSimulatorPrices(simEvPriceInput, simFuelPriceInput)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') e.currentTarget.blur();
                            }}
                          />
                        </div>
                      </div>
                      <div
                        style={{
                          backgroundColor: 'var(--bg-input)',
                          padding: '10px 14px',
                          borderRadius: '8px',
                          border: isSimEvCheaper ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(239, 68, 68, 0.4)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          flexWrap: 'wrap',
                          gap: '8px',
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 700, fontSize: '0.88rem', color: isSimEvCheaper ? 'var(--ev-color)' : '#f87171' }}>
                            {isSimEvCheaper ? '✓ Ja, Laden ist günstiger!' : '✗ Nein, Benzinbetrieb ist günstiger!'}
                          </div>
                          <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                            Strom: {formatCur(simulatedEvCostPer100Km)} / 100km &nbsp;|&nbsp; Benzin: {formatCur(simulatedFuelCostPer100Km)} / 100km
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '1.05rem', fontWeight: 800, color: isSimEvCheaper ? 'var(--ev-color)' : '#f87171' }}>
                            {isSimEvCheaper ? `-${formatCur(simulatedSavings)} Ersparnis` : `+${formatCur(-simulatedSavings)} teurer`}
                          </div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>je 100 km Fahrt</div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            };

            const renderParkCard = () => {
              if (!snap?.location_lat || !snap?.location_lon) return null;
              return (
                <div className="park-card">
                  <div
                    className="park-card-header"
                    onClick={() => setShowVehicleMap(!showVehicleMap)}
                  >
                    <div className="park-card-title">
                      <MapPin size={16} style={{ color: '#94a3b8' }} />
                      <span>
                        GEPARKTE POS: {snap.location_lat.toFixed(5)}, {snap.location_lon.toFixed(5)}
                      </span>
                    </div>
                    {showVehicleMap ? <ChevronUp size={16} color="#94a3b8" /> : <ChevronDown size={16} color="#94a3b8" />}
                  </div>

                  <div className="park-actions">
                    <button
                      type="button"
                      className="park-btn"
                      onClick={() => setShowVehicleMap(!showVehicleMap)}
                    >
                      <span>✣</span> {showVehicleMap ? 'Karte verbergen' : 'Karte anzeigen'}
                    </button>

                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${snap.location_lat},${snap.location_lon}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="park-btn"
                    >
                      <ExternalLink size={13} /> In Maps öffnen
                    </a>
                  </div>

                  {showVehicleMap && (
                    <div style={{ marginTop: '12px', borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--border)' }}>
                      <iframe
                        title="Fahrzeug Parkposition"
                        width="100%"
                        height="220"
                        style={{ border: 0, display: 'block' }}
                        src={`https://www.openstreetmap.org/export/embed.html?bbox=${snap.location_lon - 0.005}%2C${snap.location_lat - 0.003}%2C${snap.location_lon + 0.005}%2C${snap.location_lat + 0.003}&layer=mapnik&marker=${snap.location_lat}%2C${snap.location_lon}`}
                      />
                    </div>
                  )}
                </div>
              );
            };

            return (
              <div className="dashboard-container">
                {/* Mobile View (< 900px): Clean single-column mobile flow */}
                <div className="dashboard-mobile">
                  {renderControlCard()}
                  {renderStatusCard(false)}
                  {renderSavingsCard()}
                  {renderCostCard()}
                  {renderParkCard()}
                </div>

                {/* Desktop View (>= 900px): Separate Cockpit Desktop Layout */}
                <div className="dashboard-desktop">
                  {/* Top full-width Vehicle Overview with 4 metric tiles across */}
                  {renderStatusCard(true)}

                  {/* 2-Column Desktop Cockpit: Controls & Map on Left, Savings & Costs on Right */}
                  <div className="dashboard-desktop-grid">
                    <div className="dashboard-desktop-col-left">
                      {renderControlCard()}
                      {renderParkCard()}
                    </div>
                    <div className="dashboard-desktop-col-right">
                      {renderSavingsCard()}
                      {renderCostCard()}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

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
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
                  {stats?.latestSnapshot?.soc_percent != null && stats.latestSnapshot.soc_percent < 100 && (() => {
                    const soc = stats.latestSnapshot.soc_percent;
                    const needed = ((100 - soc) / 100 * 8.3).toFixed(1).replace('.', ',');
                    return (
                      <button
                        type="button"
                        onClick={() => setChargeKwh(needed)}
                        className="quick-chip"
                      >
                        ⚡ Auf 100% (~{needed} kWh)
                      </button>
                    );
                  })()}
                  <button
                    type="button"
                    onClick={() => setChargeKwh('8,3')}
                    className="quick-chip"
                  >
                    🔋 100% Voll (8,3 kWh)
                  </button>
                  <button
                    type="button"
                    onClick={() => setChargeKwh('5,0')}
                    className="quick-chip"
                  >
                    5,0 kWh
                  </button>
                </div>
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
                  defaultValue={stats?.latestSnapshot?.odometer_km ? Math.round(stats.latestSnapshot.odometer_km).toString() : ''}
                  autoFocus
                  inputMode="numeric"
                />
              </div>

              <div className="grid-2">
                <div className="form-group">
                  <label>Restreichweite EV (km)</label>
                  <input
                    type="text"
                    name="ev_range_km"
                    placeholder="z.B. 42"
                    defaultValue={stats?.latestSnapshot?.ev_range_km != null ? Math.round(stats.latestSnapshot.ev_range_km).toString() : ''}
                    inputMode="numeric"
                  />
                </div>
                <div className="form-group">
                  <label>Restreichweite Benzin (km)</label>
                  <input
                    type="text"
                    name="fuel_range_km"
                    placeholder="z.B. 520"
                    defaultValue={stats?.latestSnapshot?.fuel_range_km != null ? Math.round(stats.latestSnapshot.fuel_range_km).toString() : ''}
                    inputMode="numeric"
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Batteriestand SoC (%)</label>
                <input
                  type="text"
                  name="soc_percent"
                  placeholder="z.B. 85"
                  defaultValue={stats?.latestSnapshot?.soc_percent != null ? Math.round(stats.latestSnapshot.soc_percent).toString() : ''}
                  inputMode="numeric"
                />
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
              <div className="filter-chips">
                <button
                  className={`filter-chip ${historyFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setHistoryFilter('all')}
                >
                  Alle ({chargingList.length + fuelList.length + snapshotList.length})
                </button>
                <button
                  className={`filter-chip chip-charge ${historyFilter === 'charge' ? 'active' : ''}`}
                  onClick={() => setHistoryFilter('charge')}
                >
                  ⚡ Ladungen ({chargingList.length})
                </button>
                <button
                  className={`filter-chip chip-fuel ${historyFilter === 'fuel' ? 'active' : ''}`}
                  onClick={() => setHistoryFilter('fuel')}
                >
                  ⛽ Tanken ({fuelList.length})
                </button>
                <button
                  className={`filter-chip chip-snapshot ${historyFilter === 'snapshot' ? 'active' : ''}`}
                  onClick={() => setHistoryFilter('snapshot')}
                >
                  📸 Snapshots ({snapshotList.length})
                </button>
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button
                  className="filter-chip"
                  onClick={() => setHistorySortOrder(historySortOrder === 'desc' ? 'asc' : 'desc')}
                  title="Nach Datum sortieren"
                >
                  📅 {historySortOrder === 'desc' ? 'Neueste ⬇️' : 'Älteste ⬆️'}
                </button>

                <button className="filter-chip" onClick={loadHistory} title="Aktualisieren">
                  <RefreshCw size={13} /> Aktualisieren
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
                // Ponytail: Only show snapshots in history when odometer value changed
                let lastOdo: number | null = null;
                const sortedSnaps = [...snapshotList].sort((a, b) => new Date(a.zeitpunkt).getTime() - new Date(b.zeitpunkt).getTime());
                const dedupedSnaps = sortedSnaps.filter((s) => {
                  if (s.odometer_km === lastOdo) return false;
                  lastOdo = s.odometer_km;
                  return true;
                });
                dedupedSnaps.forEach((s) => items.push({ type: 'snapshot', zeitpunkt: s.zeitpunkt, data: s }));
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
            <div className="card">
              <div className="card-title">
                <Settings size={18} /> Dashboard-Darstellung
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="dashboard-theme">Hintergrund</label>
                <select
                  id="dashboard-theme"
                  value={dashboardTheme}
                  onChange={(event) => setDashboardTheme(event.target.value as 'oled' | 'blue')}
                >
                  <option value="oled">OLED Schwarz</option>
                  <option value="blue">Dunkles Blau</option>
                </select>
              </div>
            </div>

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
        <button
          type="button"
          className={`mobile-tab ${activeTab === 'dashboard' ? 'active' : ''}`}
          onClick={() => setActiveTab('dashboard')}
        >
          <Gauge size={20} />
          <span>Dashboard</span>
        </button>
        <button
          type="button"
          className={`mobile-tab ${activeTab === 'charge' ? 'active' : ''}`}
          onClick={() => setActiveTab('charge')}
        >
          <Zap size={20} />
          <span>Laden</span>
        </button>
        <button
          type="button"
          className={`mobile-tab ${activeTab === 'fuel' ? 'active' : ''}`}
          onClick={() => setActiveTab('fuel')}
        >
          <Fuel size={20} />
          <span>Tanken</span>
        </button>
        <button
          type="button"
          className={`mobile-tab ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          <History size={20} />
          <span>Verlauf</span>
        </button>
        <button
          type="button"
          className={`mobile-tab ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          <Settings size={20} />
          <span>Setup</span>
        </button>
      </nav>
    </div>
  );
}

export default App;
