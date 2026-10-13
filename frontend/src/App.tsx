import React, { useEffect, useState, useMemo } from 'react';
import {
  Zap,
  Fuel,
  Gauge,
  History,
  Settings,
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
  Plus,
} from 'lucide-react';
import {
  fetchDashboardStats,
  fetchChargingSessions,
  fetchFuelSessions,
  fetchSnapshots,
  fetchTariffs,
  createChargingSession,
  createFuelSession,
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
  fetchPendingChargeSuggestions,
  confirmChargeSuggestion,
  dismissChargeSuggestion,
} from './api';
import type {
  DashboardStats,
  ChargingSession,
  FuelSession,
  VehicleSnapshot,
  Tariff,
  KiaStatus,
  ChargeSuggestion,
} from './api';
import {
  getPendingActions,
  syncPendingActions,
  saveCachedDashboard,
  getCachedDashboard,
} from './offlineStore';
import type { PendingAction } from './offlineStore';

export function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'charge' | 'fuel' | 'history' | 'settings'>('dashboard');
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
  const [swipedItemId, setSwipedItemId] = useState<string | null>(null);
  const [fullSwipedItemId, setFullSwipedItemId] = useState<string | null>(null);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);

  // Form helper & prefill states
  const [chargeKwh, setChargeKwh] = useState('');
  const [chargeOdo, setChargeOdo] = useState('');
  const [chargeEvKm, setChargeEvKm] = useState('');
  const [chargeQuelle, setChargeQuelle] = useState('zuhause');
  const [chargePrice, setChargePrice] = useState('');
  const [chargeCalcOpen, setChargeCalcOpen] = useState(false);
  const [calcStartPct, setCalcStartPct] = useState(20);
  const [calcEndPct, setCalcEndPct] = useState(100);

  const [fuelOdo, setFuelOdo] = useState('');
  const [fuelKm, setFuelKm] = useState('');
  const [fuelLiter, setFuelLiter] = useState('');
  const [fuelPricePerLiter, setFuelPricePerLiter] = useState('');
  const [fuelTotalCost, setFuelTotalCost] = useState('');

  // Smart charge suggestions detected from SoC increase
  const [chargeSuggestions, setChargeSuggestions] = useState<ChargeSuggestion[]>([]);

  // Tariffs (cached locally for instant availability)
  const [tariffs, setTariffs] = useState<Tariff[]>(() => {
    try {
      const cached = localStorage.getItem('phev-cached-tariffs');
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });

  // Unique active tariffs for selection (newest validity per quelle)
  const activeTariffs = useMemo(() => {
    const map = new Map<string, Tariff>();
    for (const t of tariffs) {
      const key = t.quelle.toLowerCase();
      if (!map.has(key)) {
        map.set(key, t);
      }
    }
    return Array.from(map.values());
  }, [tariffs]);

  const activeTariffForQuelle = useMemo(() => {
    return activeTariffs.find((t) => t.quelle.toLowerCase() === chargeQuelle.toLowerCase()) || null;
  }, [activeTariffs, chargeQuelle]);

  const calculatedCost = useMemo(() => {
    const kwhVal = Number(chargeKwh.replace(',', '.'));
    const priceVal = chargePrice
      ? Number(chargePrice.replace(',', '.'))
      : activeTariffForQuelle
      ? activeTariffForQuelle.preis_pro_kwh
      : NaN;
    if (Number.isFinite(kwhVal) && kwhVal > 0 && Number.isFinite(priceVal) && priceVal > 0) {
      return kwhVal * priceVal;
    }
    return null;
  }, [chargeKwh, chargePrice, activeTariffForQuelle]);

  const calculatedFuelCost = useMemo(() => {
    const literVal = Number(fuelLiter.replace(',', '.'));
    const priceVal = Number(fuelPricePerLiter.replace(',', '.'));
    if (Number.isFinite(literVal) && literVal > 0 && Number.isFinite(priceVal) && priceVal > 0) {
      return literVal * priceVal;
    }
    return null;
  }, [fuelLiter, fuelPricePerLiter]);

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

  // Tariff management states
  const [isAddTariffOpen, setIsAddTariffOpen] = useState(false);
  const [swipedTariffId, setSwipedTariffId] = useState<number | null>(null);
  const [fullSwipedTariffId, setFullSwipedTariffId] = useState<number | null>(null);
  const [deletingTariffId, setDeletingTariffId] = useState<number | null>(null);

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
    loadTariffs();

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
    loadChargeSuggestions();
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
      if (Array.isArray(list) && list.length > 0) {
        setTariffs(list);
        try {
          localStorage.setItem('phev-cached-tariffs', JSON.stringify(list));
        } catch {}
      }
    } catch (err) {
      console.error(err);
    }
  };

  const loadChargeSuggestions = async () => {
    try {
      const list = await fetchPendingChargeSuggestions(1);
      setChargeSuggestions(list);
    } catch {
      // offline or backend unreachable
    }
  };

  const handleConfirmSuggestion = async (s: ChargeSuggestion) => {
    try {
      const defaultTariff = activeTariffForQuelle || activeTariffs[0];
      await confirmChargeSuggestion(s.id, {
        quelle: defaultTariff ? defaultTariff.quelle : 'zuhause',
        preis_pro_kwh: defaultTariff ? defaultTariff.preis_pro_kwh : undefined,
      });
      showToast(`Ladevorgang (+${formatNum(s.estimated_kwh, 2)} kWh) gespeichert!`);
      await loadChargeSuggestions();
      await loadDashboard();
    } catch (err: any) {
      showToast(err.message || 'Fehler beim Bestätigen', 'warn');
    }
  };

  const handleDismissSuggestion = async (s: ChargeSuggestion) => {
    try {
      await dismissChargeSuggestion(s.id);
      showToast('Ladevorschlag verworfen');
      await loadChargeSuggestions();
    } catch (err: any) {
      showToast(err.message || 'Fehler beim Verwerfen', 'warn');
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
      loadTariffs();
      if (!chargeOdo && stats?.latestSnapshot?.odometer_km) {
        setChargeOdo(Math.round(stats.latestSnapshot.odometer_km).toString());
      }
      if (!chargePrice && activeTariffForQuelle) {
        setChargePrice(String(activeTariffForQuelle.preis_pro_kwh).replace('.', ','));
      }
    }
    if (activeTab === 'fuel') {
      if (!fuelOdo && stats?.latestSnapshot?.odometer_km) {
        setFuelOdo(Math.round(stats.latestSnapshot.odometer_km).toString());
      }
    }
  }, [activeTab, stats, activeTariffForQuelle]);

  useEffect(() => {
    if (tariffs.length > 0) {
      const currentMatch = tariffs.find((t) => t.quelle.toLowerCase() === chargeQuelle.toLowerCase());
      if (currentMatch) {
        if (!chargePrice) {
          setChargePrice(String(currentMatch.preis_pro_kwh).replace('.', ','));
        }
      } else if (chargeQuelle !== 'sonstige') {
        const first = tariffs[0];
        setChargeQuelle(first.quelle);
        setChargePrice(String(first.preis_pro_kwh).replace('.', ','));
      }
    }
  }, [tariffs]);

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

  // Swipe gesture & animated deletion helpers
  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    const el = e.currentTarget as HTMLElement;
    el.dataset.startX = String(touch.clientX);
    el.dataset.startY = String(touch.clientY);
    el.dataset.swiping = 'false';
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const el = e.currentTarget as HTMLElement;
    const startX = Number(el.dataset.startX);
    const startY = Number(el.dataset.startY);
    if (!startX) return;

    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const deltaX = startX - currentX;
    const deltaY = Math.abs(startY - currentY);

    if (deltaY > Math.abs(deltaX) && el.dataset.swiping !== 'true') {
      return;
    }

    if (deltaX > 10) {
      el.dataset.swiping = 'true';
    }
  };

  const handleTouchEnd = (
    e: React.TouchEvent,
    onSnapOpen: () => void,
    onSnapClose: () => void,
    onFullSwipe: () => void,
  ) => {
    const el = e.currentTarget as HTMLElement;
    const startX = Number(el.dataset.startX);
    if (!startX) return;

    const currentX = e.changedTouches[0].clientX;
    const deltaX = startX - currentX;
    const rowWidth = el.offsetWidth || 300;

    delete el.dataset.startX;
    delete el.dataset.startY;
    delete el.dataset.swiping;

    if (deltaX > rowWidth * 0.45) {
      onFullSwipe();
    } else if (deltaX > 55) {
      onSnapOpen();
    } else if (deltaX < -30) {
      onSnapClose();
    }
  };

  const handleDeleteHistoryItem = (type: 'charge' | 'fuel' | 'snapshot', id: number, idKey: string) => {
    if (deletingItemId === idKey) return;
    setDeletingItemId(idKey);
    setTimeout(async () => {
      try {
        if (type === 'charge') await deleteChargingSession(id);
        else if (type === 'fuel') await deleteFuelSession(id);
        else if (type === 'snapshot') await deleteSnapshot(id);
        await loadHistory();
        await loadDashboard();
        showToast('Eintrag gelöscht');
      } catch (err: any) {
        alert(err.message || 'Löschen fehlgeschlagen');
      } finally {
        setDeletingItemId(null);
        setSwipedItemId(null);
        setFullSwipedItemId(null);
      }
    }, 280);
  };

  const handleDeleteTariffItem = (id: number, bezeichnung: string) => {
    if (deletingTariffId === id) return;
    setDeletingTariffId(id);
    setTimeout(async () => {
      try {
        await deleteTariff(id);
        await loadTariffs();
        showToast(`Tarif "${bezeichnung}" gelöscht`);
      } catch (err: any) {
        alert(err.message || 'Löschen fehlgeschlagen');
      } finally {
        setDeletingTariffId(null);
        setSwipedTariffId(null);
        setFullSwipedTariffId(null);
      }
    }, 280);
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
      setFuelLiter('');
      setFuelPricePerLiter('');
      setFuelTotalCost('');
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
      setIsAddTariffOpen(false);
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
      showToast('Live-Abfrage: Fahrzeug wird geweckt (dauert ca. 20-30 Sek.)...', 'warn');
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
    <div className="app-shell">
      {/* macOS Desktop Sidebar (>= 900px) */}
      <aside className="macos-sidebar">
        <div className="macos-sidebar-brand">
          <div className="brand-icon-box">
            <Car size={18} />
          </div>
          <span className="macos-sidebar-brand-title">PHEV Tracker</span>
        </div>

        <nav className="macos-sidebar-nav">
          <button
            type="button"
            className={`macos-sidebar-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <Gauge size={18} />
            <span>Dashboard</span>
          </button>
          <button
            type="button"
            className={`macos-sidebar-btn ${activeTab === 'charge' ? 'active' : ''}`}
            onClick={() => setActiveTab('charge')}
          >
            <Zap size={18} />
            <span>Laden</span>
          </button>
          <button
            type="button"
            className={`macos-sidebar-btn ${activeTab === 'fuel' ? 'active' : ''}`}
            onClick={() => setActiveTab('fuel')}
          >
            <Fuel size={18} />
            <span>Tanken</span>
          </button>
          <button
            type="button"
            className={`macos-sidebar-btn ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            <History size={18} />
            <span>Verlauf</span>
          </button>
          <button
            type="button"
            className={`macos-sidebar-btn ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            <Settings size={18} />
            <span>Setup</span>
          </button>
        </nav>

        <div className="macos-sidebar-footer">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {isOnline ? (
              <span className="badge-online-pill" title="Verbunden mit Server">
                <span className="dot" /> Online
              </span>
            ) : (
              <span className="badge-offline-pill" title="Offline-Modus">
                <span className="dot" /> Offline
              </span>
            )}
            {pendingActions.length > 0 && (
              <button
                className="badge"
                style={{ backgroundColor: '#eab308', color: '#000', cursor: 'pointer', border: 'none' }}
                onClick={handleSync}
                disabled={syncing || !isOnline}
                title="Synchronisieren"
              >
                <RefreshCw size={11} className={syncing ? 'animate-spin' : ''} />
                {pendingActions.length}
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="app-main-content">
        {/* Mobile Header (< 900px) */}
        <header className="app-header">
          <div className="header-content">
            <div className="brand">
              <div className="brand-icon-box">
                <Car size={18} />
              </div>
              <span>PHEV Tracker</span>
            </div>

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
          {/* Toast / Sync Banner (Apple Dynamic Island style) */}
          {toastMsg && (
            <div className="toast-container">
              <div className={`banner ${toastMsg.type === 'warn' ? 'banner-warning' : 'banner-success'}`}>
                {toastMsg.type === 'warn' ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
                <span>{toastMsg.text}</span>
                <button
                  type="button"
                  onClick={() => setToastMsg(null)}
                  className="banner-close-btn"
                  title="Schließen"
                >
                  ×
                </button>
              </div>
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
                <div className="control-card-title">Schnellsteuerung</div>
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
                    <Lock size={20} />
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
                    <Unlock size={20} />
                    <span>Entriegeln</span>
                  </button>
                </div>

                <button
                  type="button"
                  className={`control-btn-charge ${snap?.is_charging ? 'is-charging' : 'btn-charge-start'}`}
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
                >
                  {isRemoteLoading && remoteActionActive?.includes('charge') ? (
                    <RefreshCw size={15} className="spin" />
                  ) : (
                    <Power size={15} />
                  )}
                  <span>{snap?.is_charging ? 'Laden stoppen' : 'Laden starten'}</span>
                </button>
              </div>
            );

            const renderStatusCard = (isDesktop: boolean) => (
              <div className={`status-card ${isDesktop ? 'status-card-desktop' : ''}`}>
                <div className="status-card-header">
                  <div>
                    <div className="status-card-title">Fahrzeugstatus</div>
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
                      <RefreshCw size={11} className={isKiaSyncing ? 'spin' : ''} />
                      Schnell
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
                      <Radio size={11} className={isKiaSyncing ? 'spin' : ''} />
                      Live
                    </button>
                  </div>
                </div>

                <div className={`status-grid status-grid-tiles ${isDesktop ? 'status-grid-desktop' : ''}`}>
                  {/* Tile 1: HV-Akku */}
                  <div className="status-tile">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="status-metric-label">Hochvolt-Akku</span>
                      <BatteryCharging size={18} style={{ color: 'var(--ev-color)' }} />
                    </div>
                    <div className="status-metric-val" style={{ color: 'var(--ev-color)' }}>
                      {snap?.soc_percent !== null && snap?.soc_percent !== undefined ? `${formatNum(snap.soc_percent, 0)} %` : '– %'}
                    </div>
                    <div className="status-progress-track">
                      <div className="status-progress-fill tile-bar-ev" style={{ width: `${Math.min(100, Math.max(0, snap?.soc_percent || 0))}%` }} />
                    </div>
                    <div className="status-subtext">
                      {snap?.ev_range_km ? `${formatNum(snap.ev_range_km, 0)} km Rest` : ''}
                      {snap?.charge_remaining_min ? ` • Noch ~${snap.charge_remaining_min} Min.` : ''}
                    </div>
                  </div>

                  {/* Tile 2: Tacho */}
                  <div className="status-tile">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="status-metric-label">Tachostand</span>
                      <Gauge size={18} style={{ color: 'var(--text-muted)' }} />
                    </div>
                    <div className="status-metric-val">
                      {snap?.odometer_km ? `${formatNum(snap.odometer_km, 0)} km` : '– km'}
                    </div>
                    <div className="status-subtext">Gesamtfahrstrecke</div>
                  </div>

                  {/* Tile 3: Benzin-Reichweite */}
                  <div className="status-tile">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="status-metric-label">Benzin-Reichweite</span>
                      <Fuel size={18} style={{ color: 'var(--fuel-color)' }} />
                    </div>
                    <div className="status-metric-val" style={{ color: 'var(--fuel-color)' }}>
                      {snap?.fuel_range_km ? `${formatNum(snap.fuel_range_km, 0)} km` : '– km'}
                    </div>
                    <div className="status-subtext">Tankreserve aktiv</div>
                  </div>

                  {/* Tile 4: 12V-Batterie */}
                  <div className="status-tile">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="status-metric-label">12V-Batterie</span>
                      <Battery size={18} style={{ color: is12vLow ? 'var(--danger)' : is12vMed ? 'var(--fuel-color)' : 'var(--text-muted)' }} />
                    </div>
                    <div className={`status-metric-val ${is12vLow ? 'tile-state-bad' : is12vMed ? 'tile-state-warn' : ''}`}>
                      {snap?.car_12v_percent !== null && snap?.car_12v_percent !== undefined ? `${snap.car_12v_percent} %` : '– %'}
                    </div>
                    <div className="status-progress-track">
                      <div
                        className={`status-progress-fill ${is12vLow ? 'tile-bar-bad' : is12vMed ? 'tile-bar-warn' : 'tile-bar-ok'}`}
                        style={{ width: `${Math.min(100, Math.max(0, snap?.car_12v_percent || 0))}%` }}
                      />
                    </div>
                    <div className="status-subtext">
                      {is12vLow ? '⚠️ Bitte bald laden' : is12vMed ? 'Ausreichend' : 'Geladen'}
                    </div>
                  </div>
                </div>

                {/* Warnings or open items banner if any */}
                {hasOpenItems && (
                  <div className="status-warning-banner">
                    <AlertTriangle size={15} style={{ color: 'var(--danger)', flexShrink: 0 }} />
                    <div>Geöffnet: {openDoorsList.concat(openWindowsList).join(', ')}</div>
                  </div>
                )}
                {hasWarnings && (
                  <div className="status-warning-banner">
                    <AlertTriangle size={15} style={{ color: 'var(--fuel-color)', flexShrink: 0 }} />
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
                  <div className={`savings-banner-box ${stats.breakEven.isEvCheaper ? '' : 'fuel-cheaper'}`}>
                    <div className="savings-icon-box">
                      <Zap size={18} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="savings-title-text">
                        {stats.breakEven.isEvCheaper ? 'Elektroantrieb ist günstiger' : 'Benzinbetrieb ist günstiger'}
                      </div>
                      <div className="savings-sub-text">
                        Ersparnis: <strong style={{ color: stats.breakEven.isEvCheaper ? 'var(--ev-color)' : 'var(--fuel-color)' }}>+{formatCur(stats.breakEven.savingsPer100Km)} / 100 km</strong> • Schwelle: {formatNum(stats.breakEven.breakEvenElectricityPricePerKwh, 3)} €/kWh
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
                  <div className="cost-card-title">Kostenvergleich</div>
                  <div className="cost-card-grid">
                    {/* EV Column */}
                    <div className="cost-col-ev">
                      <div className="cost-col-header-ev">Elektro</div>
                      <div className="cost-col-main-val-ev">{formatKmCur(stats.evMetrics.costPerKm)}</div>
                      <div className="cost-col-sub-val">
                        {formatCur(stats.evMetrics.costPer100Km)} / 100 km
                      </div>

                      <div className="cost-details-list">
                        <div className="cost-detail-row">
                          <span>Verbrauch</span>
                          <strong>{formatNum(stats.evMetrics.kwhPer100Km, 1)} kWh/100 km</strong>
                        </div>
                        <div className="cost-detail-row">
                          <span>Distanz</span>
                          <span>{formatNum(stats.evMetrics.totalEvKm, 0)} km</span>
                        </div>
                        <div className="cost-detail-row">
                          <span>Energie</span>
                          <span>{formatNum(stats.evMetrics.totalKwh, 1)} kWh</span>
                        </div>
                        <div className="cost-detail-row">
                          <span>Kosten</span>
                          <span>{formatCur(stats.evMetrics.totalCost)}</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        className="cost-btn-details-ev"
                        onClick={() => setShowSimulator(!showSimulator)}
                      >
                        {showSimulator ? 'Rechner schließen' : 'Rechner & Details ▾'}
                      </button>
                    </div>

                    {/* Fuel Column */}
                    <div className="cost-col-fuel">
                      <div className="cost-col-header-fuel">Benzin</div>
                      <div className="cost-col-main-val-fuel">{formatKmCur(stats.fuelMetrics.costPerKm)}</div>
                      <div className="cost-col-sub-val">
                        {formatCur(stats.fuelMetrics.costPer100Km)} / 100 km
                      </div>

                      <div className="cost-details-list">
                        <div className="cost-detail-row">
                          <span>Verbrauch</span>
                          <strong>{formatNum(stats.fuelMetrics.literPer100Km, 1)} L/100 km</strong>
                        </div>
                        <div className="cost-detail-row">
                          <span>Distanz</span>
                          <span>{formatNum(stats.fuelMetrics.totalFuelKm, 0)} km</span>
                        </div>
                        <div className="cost-detail-row">
                          <span>Gesamt</span>
                          <span>{formatNum((stats.evMetrics.totalEvKm || 0) + (stats.fuelMetrics.totalFuelKm || 0), 0)} km</span>
                        </div>
                        <div className="cost-detail-row">
                          <span>Kosten</span>
                          <span>{formatCur(stats.fuelMetrics.totalCost)}</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        className="cost-btn-details-fuel"
                        onClick={() => setShowSimulator(!showSimulator)}
                      >
                        {showSimulator ? 'Rechner schließen' : 'Rechner & Details ▾'}
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
                      <div className="park-icon-box">
                        <MapPin size={17} />
                      </div>
                      <div>
                        <div className="park-main-title">Parkposition</div>
                        <div className="park-coords">
                          {snap.location_lat.toFixed(5)}° N · {snap.location_lon.toFixed(5)}° E
                        </div>
                      </div>
                    </div>
                    {showVehicleMap ? <ChevronUp size={18} color="var(--text-muted)" /> : <ChevronDown size={18} color="var(--text-muted)" />}
                  </div>

                  <div className="park-actions">
                    <button
                      type="button"
                      className="park-btn"
                      onClick={() => setShowVehicleMap(!showVehicleMap)}
                    >
                      {showVehicleMap ? 'Karte verbergen' : 'Karte anzeigen'}
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
                    <div className="park-map-frame">
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

            const renderChargeSuggestionsCard = () => {
              if (chargeSuggestions.length === 0) return null;
              return (
                <div className="suggestion-container">
                  {chargeSuggestions.map((s) => (
                    <div key={s.id} className="suggestion-card">
                      <div className="suggestion-header">
                        <div className="suggestion-icon-badge">
                          <Zap size={18} />
                        </div>
                        <div className="suggestion-content">
                          <div className="suggestion-title">
                            Ladevorgang erkannt
                          </div>
                          <div className="suggestion-detail">
                            SoC: {s.from_soc_percent}% → {s.to_soc_percent}% (+{s.soc_diff_percent}%) · ca. {formatNum(s.estimated_kwh, 2)} kWh
                          </div>
                          <div className="suggestion-time">
                            {formatDate(s.to_zeitpunkt)}
                          </div>
                        </div>
                      </div>
                      <div className="suggestion-actions">
                        <button
                          type="button"
                          className="suggestion-btn-confirm"
                          onClick={() => handleConfirmSuggestion(s)}
                        >
                          <CheckCircle2 size={15} /> Als Ladung speichern
                        </button>
                        <button
                          type="button"
                          className="suggestion-btn-dismiss"
                          onClick={() => handleDismissSuggestion(s)}
                        >
                          Verwerfen
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              );
            };

            return (
              <div className="dashboard-container">
                {/* Mobile View (< 900px): Clean single-column mobile flow */}
                <div className="dashboard-mobile">
                  {renderStatusCard(false)}
                  {renderChargeSuggestionsCard()}
                  {renderControlCard()}
                  {renderSavingsCard()}
                  {renderCostCard()}
                  {renderParkCard()}
                </div>

                {/* Desktop View (>= 900px): Separate Cockpit Desktop Layout */}
                <div className="dashboard-desktop">
                  {/* Top full-width Vehicle Overview with 4 metric tiles across */}
                  {renderStatusCard(true)}
                  {renderChargeSuggestionsCard()}

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
        {/* ========================================================================= */}
        {/* TAB: CHARGING FORM (APPLE HIG GROUPED INSET LAYOUT) */}
        {/* ========================================================================= */}
        {activeTab === 'charge' && (
          <div className="apple-form-container">
            <form id="charge-form" onSubmit={handleSaveCharge}>
              {/* Header: iOS Modal Bar mit Abbrechen (links), Titel (Mitte) und Sichern (rechts) */}
              <div className="apple-modal-nav">
                <button
                  type="button"
                  className="apple-nav-action-btn apple-nav-cancel"
                  onClick={() => setActiveTab('dashboard')}
                >
                  Abbrechen
                </button>
                <span className="apple-nav-title">Ladevorgang erfassen</span>
                <button
                  type="submit"
                  className="apple-nav-action-btn apple-nav-save"
                >
                  Sichern
                </button>
              </div>

              {/* 2-Column Responsive Layout on Desktop */}
              <div className="apple-form-desktop-grid">
                <div className="apple-form-desktop-col">
                  {/* 1. Hero Amount Box mit dezentem Rechner-Icon an der Seite */}
                  <div className="apple-hero-box">
                    <div className="apple-hero-header-row">
                      <div className="apple-hero-header-spacer" />
                      <div className="apple-hero-label">Geladene Energiemenge</div>
                      <button
                        type="button"
                        onClick={() => {
                          if (!chargeCalcOpen && stats?.latestSnapshot?.soc_percent) {
                            setCalcEndPct(Math.round(stats.latestSnapshot.soc_percent));
                          }
                          setChargeCalcOpen(!chargeCalcOpen);
                        }}
                        className={`apple-calc-icon-btn ${chargeCalcOpen ? 'active' : ''}`}
                        title="Akku-% Rechner öffnen"
                      >
                        <Calculator size={15} />
                      </button>
                    </div>

                    <div className="apple-hero-amount">
                      <input
                        type="text"
                        name="kwh"
                        required
                        placeholder="0,0"
                        autoFocus
                        inputMode="decimal"
                        value={chargeKwh}
                        onChange={(e) => setChargeKwh(e.target.value)}
                        className="apple-hero-input"
                      />
                      <span className="apple-hero-unit">kWh</span>
                    </div>

                    {/* Integrated % Calculator Drawer */}
                    {chargeCalcOpen && (
                      <div className="apple-calc-drawer">
                        <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--ev-color)', marginBottom: '4px' }}>
                          Akku-Rechner (inkl. ~14% Wandlungsverlust)
                        </div>
                        <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginBottom: '10px' }}>
                          Netto ab Steckdose berechnet auf Basis des 8,9 kWh Akkus.
                        </div>
                        <div className="grid-2" style={{ gap: '10px', marginBottom: '10px' }}>
                          <div>
                            <label style={{ fontSize: '0.74rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Start-Akkustand (%)</label>
                            <input
                              type="number"
                              min="0"
                              max="100"
                              value={calcStartPct}
                              onChange={(e) => setCalcStartPct(Number(e.target.value))}
                              style={{ padding: '6px 10px', fontSize: '0.9rem', width: '100%' }}
                            />
                          </div>
                          <div>
                            <label style={{ fontSize: '0.74rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>End-Akkustand (%)</label>
                            <input
                              type="number"
                              min="0"
                              max="100"
                              value={calcEndPct}
                              onChange={(e) => setCalcEndPct(Number(e.target.value))}
                              style={{ padding: '6px 10px', fontSize: '0.9rem', width: '100%' }}
                            />
                          </div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            +{Math.max(0, calcEndPct - calcStartPct)}% SoC: <strong style={{ color: '#fff' }}>{((Math.max(0, calcEndPct - calcStartPct) / 100) * 8.3).toFixed(2).replace('.', ',')} kWh</strong>
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const val = ((Math.max(0, calcEndPct - calcStartPct) / 100) * 8.3).toFixed(2).replace('.', ',');
                              setChargeKwh(val);
                              setChargeCalcOpen(false);
                            }}
                            className="apple-preset-pill active"
                          >
                            In Feld übernehmen
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 2. Grouped Inset Card: Ladung & Kosten */}
                  <div className="settings-section-header">Ladung & Tarif</div>
                  <div className="apple-grouped-card">
                    <div className="apple-row">
                      <label className="apple-row-label">Ladequelle</label>
                      <div className="apple-row-content">
                        <select
                          name="quelle"
                          value={chargeQuelle}
                          onChange={(e) => {
                            const newQuelle = e.target.value;
                            setChargeQuelle(newQuelle);
                            const matched = activeTariffs.find((t) => t.quelle.toLowerCase() === newQuelle.toLowerCase());
                            if (matched) {
                              setChargePrice(String(matched.preis_pro_kwh).replace('.', ','));
                            } else if (newQuelle === 'sonstige') {
                              setChargePrice('');
                            }
                          }}
                          className="apple-row-select"
                        >
                          {activeTariffs.length === 0 ? (
                            <>
                              <option value="zuhause">Zuhause (Haushaltsstrom)</option>
                              <option value="vkw">VKW / vlotte Ladekarte</option>
                              <option value="enbw">EnBW mobility+</option>
                              <option value="sonstige">Sonstige Ladesäule</option>
                            </>
                          ) : (
                            <>
                              {activeTariffs.map((t) => (
                                <option key={t.id} value={t.quelle}>
                                  {t.bezeichnung} ({formatNum(t.preis_pro_kwh, 3)} €)
                                </option>
                              ))}
                              {!activeTariffs.some((t) => t.quelle.toLowerCase() === 'sonstige') && (
                                <option value="sonstige">Sonstige Ladesäule</option>
                              )}
                            </>
                          )}
                        </select>
                        <button
                          type="button"
                          onClick={() => setActiveTab('settings')}
                          className="apple-gear-btn"
                          title="Tarife in Setup verwalten"
                        >
                          <Settings size={15} />
                        </button>
                      </div>
                    </div>

                    <div className="apple-row">
                      <label className="apple-row-label">Strompreis</label>
                      <div className="apple-row-content">
                        <input
                          type="text"
                          name="preis_pro_kwh"
                          placeholder={activeTariffForQuelle ? String(activeTariffForQuelle.preis_pro_kwh).replace('.', ',') : '0,28'}
                          inputMode="decimal"
                          value={chargePrice}
                          onChange={(e) => setChargePrice(e.target.value)}
                          className="apple-row-input"
                        />
                        <span className="apple-row-suffix">€/kWh</span>
                        {activeTariffForQuelle && (
                          <button
                            type="button"
                            onClick={() => setChargePrice(String(activeTariffForQuelle.preis_pro_kwh).replace('.', ','))}
                            className="apple-chip-restore"
                            title="Hinterlegten Tarif-Preis wiederherstellen"
                          >
                            Standard
                          </button>
                        )}
                      </div>
                    </div>

                    {calculatedCost != null && (
                      <div className="apple-row apple-row-summary">
                        <span className="apple-row-label">Gesamtkosten</span>
                        <div className="apple-row-content">
                          <span className="apple-row-value-accent">{formatCur(calculatedCost)}</span>
                          <span className="apple-row-suffix">({chargeKwh} kWh × {chargePrice || (activeTariffForQuelle ? formatNum(activeTariffForQuelle.preis_pro_kwh, 3) : '0')} €)</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="apple-form-desktop-col">
                  {/* 3. Grouped Inset Card: Fahrzeug & Zeitpunkt */}
                  <div className="settings-section-header">Fahrzeug & Datum</div>
                  <div className="apple-grouped-card">
                    <div className="apple-row">
                      <label className="apple-row-label">Tachostand</label>
                      <div className="apple-row-content">
                        <input
                          type="text"
                          name="odometer_km"
                          placeholder="z.B. 45200"
                          inputMode="numeric"
                          value={chargeOdo}
                          onChange={(e) => setChargeOdo(e.target.value)}
                          className="apple-row-input"
                        />
                        <span className="apple-row-suffix">km</span>
                        {stats?.latestSnapshot?.odometer_km && (
                          <button
                            type="button"
                            onClick={() => setChargeOdo(Math.round(stats.latestSnapshot!.odometer_km).toString())}
                            className="apple-chip-restore"
                            title="Aus Kia Connect Telemetrie übernehmen"
                          >
                            <Gauge size={12} /> Kia
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="apple-row">
                      <label className="apple-row-label">Zeitpunkt</label>
                      <div className="apple-row-content">
                        <input
                          type="datetime-local"
                          name="zeitpunkt"
                          defaultValue={new Date().toISOString().slice(0, 16)}
                          className="apple-row-datetime"
                        />
                      </div>
                    </div>
                  </div>

                  {/* 4. Grouped Inset Card: Optionale Angaben */}
                  <div className="settings-section-header">Weitere Details (Optional)</div>
                  <div className="apple-grouped-card">
                    <div className="apple-row">
                      <label className="apple-row-label">Trip-Distanz</label>
                      <div className="apple-row-content">
                        <input
                          type="text"
                          name="ev_km"
                          placeholder="z.B. 48,0"
                          inputMode="decimal"
                          value={chargeEvKm}
                          onChange={(e) => setChargeEvKm(e.target.value)}
                          className="apple-row-input"
                        />
                        <span className="apple-row-suffix">km</span>
                      </div>
                    </div>

                    <div className="apple-row">
                      <label className="apple-row-label">Standort / Notiz</label>
                      <div className="apple-row-content">
                        <input
                          type="text"
                          name="standort"
                          placeholder="z.B. Wallbox Garage"
                          className="apple-row-input"
                          style={{ maxWidth: '220px' }}
                        />
                      </div>
                    </div>

                    <div className="apple-row">
                      <label className="apple-row-label">Kosten überschreiben</label>
                      <div className="apple-row-content">
                        <input
                          type="text"
                          name="gesamtkosten"
                          placeholder={
                            calculatedCost != null
                              ? `~ ${formatNum(calculatedCost, 2)} €`
                              : 'z.B. 2,10'
                          }
                          inputMode="decimal"
                          className="apple-row-input"
                        />
                        <span className="apple-row-suffix">€</span>
                      </div>
                    </div>
                  </div>

                  {/* Bottom Action Button (Apple Subdued Pill) */}
                  <div className="apple-form-submit-row">
                    <button type="submit" className="apple-btn-primary">
                      <CheckCircle2 size={17} /> Ladevorgang speichern
                    </button>
                  </div>
                </div>
              </div>
            </form>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB: FUEL FORM (APPLE HIG GROUPED INSET MODAL) */}
        {/* ========================================================================= */}
        {activeTab === 'fuel' && (
          <div className="apple-form-container">
            <form onSubmit={handleSaveFuel}>
              {/* Header: iOS Modal Bar mit Abbrechen (links), Titel (Mitte) und Sichern (rechts) */}
              <div className="apple-modal-nav">
                <button
                  type="button"
                  className="apple-nav-action-btn apple-nav-cancel"
                  onClick={() => setActiveTab('dashboard')}
                >
                  Abbrechen
                </button>
                <span className="apple-nav-title">Tanken erfassen</span>
                <button
                  type="submit"
                  className="apple-nav-action-btn apple-nav-save"
                >
                  Sichern
                </button>
              </div>

              {/* 2-Column Responsive Layout on Desktop */}
              <div className="apple-form-desktop-grid">
                <div className="apple-form-desktop-col">
                  {/* 1. Hero Amount Card (Liter) */}
                  <div className="apple-hero-box">
                    <div className="apple-hero-label">Kraftstoffmenge</div>
                    <div className="apple-hero-amount">
                      <input
                        type="text"
                        name="liter"
                        required
                        placeholder="0,0"
                        autoFocus
                        inputMode="decimal"
                        value={fuelLiter}
                        onChange={(e) => setFuelLiter(e.target.value)}
                        className="apple-hero-input"
                        style={{ color: 'var(--fuel-color)' }}
                      />
                      <span className="apple-hero-unit" style={{ color: 'var(--fuel-color)' }}>Liter</span>
                    </div>
                  </div>

                  {/* 2. Grouped Inset Card: Kraftstoff & Kosten */}
                  <div className="settings-section-header">Kraftstoff & Kosten</div>
                  <div className="apple-grouped-card">
                    <div className="apple-row">
                      <label className="apple-row-label">Preis pro Liter</label>
                      <div className="apple-row-content">
                        <input
                          type="text"
                          name="preis_pro_liter"
                          placeholder="z.B. 1,629"
                          inputMode="decimal"
                          value={fuelPricePerLiter}
                          onChange={(e) => setFuelPricePerLiter(e.target.value)}
                          className="apple-row-input"
                        />
                        <span className="apple-row-suffix">€/L</span>
                      </div>
                    </div>

                    <div className="apple-row">
                      <label className="apple-row-label">Gesamtkosten</label>
                      <div className="apple-row-content">
                        <input
                          type="text"
                          name="gesamtkosten"
                          placeholder={
                            calculatedFuelCost != null
                              ? `${formatNum(calculatedFuelCost, 2)}`
                              : 'z.B. 52,94'
                          }
                          inputMode="decimal"
                          value={fuelTotalCost}
                          onChange={(e) => setFuelTotalCost(e.target.value)}
                          className="apple-row-input"
                        />
                        <span className="apple-row-suffix">€</span>
                      </div>
                    </div>

                    {calculatedFuelCost != null && !fuelTotalCost && (
                      <div className="apple-row apple-row-summary-fuel">
                        <label className="apple-row-label" style={{ color: 'var(--fuel-color)', fontWeight: 600 }}>
                          Kostenberechnung
                        </label>
                        <div className="apple-row-content">
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            {fuelLiter} L × {fuelPricePerLiter} € =
                          </span>
                          <span className="apple-row-value-fuel">
                            {formatCur(calculatedFuelCost)}
                          </span>
                        </div>
                      </div>
                    )}

                    <div className="apple-row">
                      <label className="apple-row-label">Status</label>
                      <div className="apple-row-content">
                        <label className="apple-toggle-label">
                          <input type="checkbox" name="vollgetankt" id="vollgetankt" defaultChecked />
                          <span>Vollgetankt</span>
                        </label>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="apple-form-desktop-col">
                  {/* 3. Grouped Inset Card: Fahrzeug & Kilometer */}
                  <div className="settings-section-header">Fahrzeug & Kilometer</div>
                  <div className="apple-grouped-card">
                    <div className="apple-row">
                      <label className="apple-row-label">Tachostand</label>
                      <div className="apple-row-content">
                        {stats?.latestSnapshot?.odometer_km && (
                          <button
                            type="button"
                            onClick={() => setFuelOdo(Math.round(stats.latestSnapshot!.odometer_km).toString())}
                            className="apple-chip-restore"
                            title="Aktuellen Kia-Telemetriewert einsetzen"
                          >
                            <Gauge size={12} /> Kia {Math.round(stats.latestSnapshot.odometer_km).toLocaleString('de-AT')}
                          </button>
                        )}
                        <input
                          type="text"
                          name="odometer_km"
                          placeholder={stats?.latestSnapshot?.odometer_km ? String(Math.round(stats.latestSnapshot.odometer_km)) : 'z.B. 45800'}
                          inputMode="numeric"
                          value={fuelOdo}
                          onChange={(e) => setFuelOdo(e.target.value)}
                          className="apple-row-input"
                        />
                        <span className="apple-row-suffix">km</span>
                      </div>
                    </div>

                    <div className="apple-row">
                      <label className="apple-row-label">Trip-Distanz</label>
                      <div className="apple-row-content">
                        <input
                          type="text"
                          name="fuel_km"
                          placeholder="z.B. 550"
                          inputMode="decimal"
                          value={fuelKm}
                          onChange={(e) => setFuelKm(e.target.value)}
                          className="apple-row-input"
                        />
                        <span className="apple-row-suffix">km</span>
                      </div>
                    </div>

                    <div className="apple-row">
                      <label className="apple-row-label">Zeitpunkt</label>
                      <div className="apple-row-content">
                        <input
                          type="datetime-local"
                          name="zeitpunkt"
                          defaultValue={new Date().toISOString().slice(0, 16)}
                          className="apple-row-datetime"
                        />
                      </div>
                    </div>
                  </div>

                  {/* 4. Grouped Inset Card: Optionale Angaben */}
                  <div className="settings-section-header">Weitere Details (Optional)</div>
                  <div className="apple-grouped-card">
                    <div className="apple-row">
                      <label className="apple-row-label">Tankstelle / Ort</label>
                      <div className="apple-row-content">
                        <input
                          type="text"
                          name="tankstelle"
                          placeholder="z.B. OMV Dornbirn, BP"
                          className="apple-row-input"
                          style={{ maxWidth: '220px' }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Bottom Action Button (Apple Subdued Pill) */}
                  <div className="apple-form-submit-row">
                    <button type="submit" className="apple-btn-primary apple-btn-primary-fuel">
                      <CheckCircle2 size={17} /> Tankvorgang speichern
                    </button>
                  </div>
                </div>
              </div>
            </form>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB: HISTORY (APPLE HIG PLAIN INSET LIST & SWIPE-TO-DELETE) */}
        {/* ========================================================================= */}
        {activeTab === 'history' && (
          <div className="apple-history-container">
            {/* 1. Apple Segmented Control */}
            <div className="apple-segmented-control">
              <button
                type="button"
                className={`apple-segment-btn ${historyFilter === 'all' ? 'active' : ''}`}
                onClick={() => setHistoryFilter('all')}
              >
                <span>Alle</span>
                <span className="apple-segment-count">({chargingList.length + fuelList.length + snapshotList.length})</span>
              </button>
              <button
                type="button"
                className={`apple-segment-btn ${historyFilter === 'charge' ? 'active' : ''}`}
                onClick={() => setHistoryFilter('charge')}
              >
                <span>Laden</span>
                <span className="apple-segment-count">({chargingList.length})</span>
              </button>
              <button
                type="button"
                className={`apple-segment-btn ${historyFilter === 'fuel' ? 'active' : ''}`}
                onClick={() => setHistoryFilter('fuel')}
              >
                <span>Tanken</span>
                <span className="apple-segment-count">({fuelList.length})</span>
              </button>
              <button
                type="button"
                className={`apple-segment-btn ${historyFilter === 'snapshot' ? 'active' : ''}`}
                onClick={() => setHistoryFilter('snapshot')}
              >
                <span>Tacho</span>
                <span className="apple-segment-count">({snapshotList.length})</span>
              </button>
            </div>

            {/* 2. Apple Toolbar (Sort & Refresh) */}
            <div className="apple-history-toolbar">
              <span className="apple-history-count">
                {historySortOrder === 'desc' ? 'Neueste zuerst' : 'Älteste zuerst'}
              </span>
              <div className="apple-history-actions">
                <button
                  type="button"
                  className="apple-history-tool-btn"
                  onClick={() => setHistorySortOrder(historySortOrder === 'desc' ? 'asc' : 'desc')}
                  title="Sortierreihenfolge wechseln"
                >
                  {historySortOrder === 'desc' ? 'Neueste' : 'Älteste'}
                </button>
                <button
                  type="button"
                  className="apple-history-tool-btn"
                  onClick={loadHistory}
                  title="Verlauf aktualisieren"
                >
                  <RefreshCw size={13} />
                </button>
              </div>
            </div>

            {/* 3. Unified Chronological Timeline in Apple Grouped List */}
            {(() => {
              const items: Array<
                | { type: 'charge'; idKey: string; zeitpunkt: string; data: ChargingSession }
                | { type: 'fuel'; idKey: string; zeitpunkt: string; data: FuelSession }
                | { type: 'snapshot'; idKey: string; zeitpunkt: string; data: VehicleSnapshot }
              > = [];

              if (historyFilter === 'all' || historyFilter === 'charge') {
                chargingList.forEach((c) => items.push({ type: 'charge', idKey: `charge-${c.id}`, zeitpunkt: c.zeitpunkt, data: c }));
              }
              if (historyFilter === 'all' || historyFilter === 'fuel') {
                fuelList.forEach((f) => items.push({ type: 'fuel', idKey: `fuel-${f.id}`, zeitpunkt: f.zeitpunkt, data: f }));
              }
              if (historyFilter === 'all' || historyFilter === 'snapshot') {
                let lastOdo: number | null = null;
                const sortedSnaps = [...snapshotList].sort((a, b) => new Date(a.zeitpunkt).getTime() - new Date(b.zeitpunkt).getTime());
                const dedupedSnaps = sortedSnaps.filter((s) => {
                  if (s.odometer_km === lastOdo) return false;
                  lastOdo = s.odometer_km;
                  return true;
                });
                dedupedSnaps.forEach((s) => items.push({ type: 'snapshot', idKey: `snap-${s.id}`, zeitpunkt: s.zeitpunkt, data: s }));
              }

              items.sort((a, b) => {
                const tA = new Date(a.zeitpunkt).getTime() || 0;
                const tB = new Date(b.zeitpunkt).getTime() || 0;
                return historySortOrder === 'desc' ? tB - tA : tA - tB;
              });

              if (items.length === 0) {
                return (
                  <div className="empty-history-box">
                    <div className="empty-history-icon">
                      <History size={30} />
                    </div>
                    <div className="empty-history-title">Keine Einträge vorhanden</div>
                    <div className="empty-history-sub">
                      Sobald du Ladungen oder Betankungen erfasst, erscheinen sie hier im Verlauf.
                    </div>
                  </div>
                );
              }

              return (
                <div className="apple-history-list">
                  {items.map((item) => {
                    const isCollapsing = deletingItemId === item.idKey;
                    const isFullSwiped = fullSwipedItemId === item.idKey;
                    const isSwiped = swipedItemId === item.idKey;

                    const rowClass = `apple-swipe-row ${isCollapsing ? 'collapsing' : ''} ${isFullSwiped ? 'full-swiped' : ''} ${isSwiped ? 'swiped' : ''}`.trim();

                    if (item.type === 'charge') {
                      const c = item.data;
                      return (
                        <div
                          key={item.idKey}
                          className={rowClass}
                          onTouchStart={handleTouchStart}
                          onTouchMove={handleTouchMove}
                          onTouchEnd={(e) =>
                            handleTouchEnd(
                              e,
                              () => setSwipedItemId(item.idKey),
                              () => { if (swipedItemId === item.idKey) setSwipedItemId(null); },
                              () => {
                                setFullSwipedItemId(item.idKey);
                                handleDeleteHistoryItem('charge', c.id, item.idKey);
                              },
                            )
                          }
                          onClick={() => {
                            if (swipedItemId) setSwipedItemId(null);
                          }}
                        >
                          <div className="apple-swipe-content">
                            <div className="apple-item-leading">
                              <div className="apple-item-icon charge">
                                <Zap size={17} />
                              </div>
                              <div className="apple-item-details">
                                <div className="apple-item-title">
                                  Ladung {c.quelle ? `· ${c.quelle}` : ''}
                                </div>
                                <div className="apple-item-sub">
                                  {formatDate(c.zeitpunkt)}
                                  {c.odometer_km ? ` · ${formatNum(c.odometer_km, 0)} km` : ''}
                                  {c.standort ? ` · ${c.standort}` : ''}
                                </div>
                              </div>
                            </div>
                            <div className="apple-item-trailing">
                              <span className="apple-item-metric charge">+{formatNum(c.kwh, 2)} kWh</span>
                              <span className="apple-item-secondary">
                                {formatCur(c.gesamtkosten)} ({formatNum(c.preis_pro_kwh, 3)} €)
                              </span>
                            </div>
                          </div>

                          {/* Swipe Delete Action */}
                          <div className="apple-swipe-actions">
                            <button
                              type="button"
                              className="apple-swipe-delete-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteHistoryItem('charge', c.id, item.idKey);
                              }}
                            >
                              <Trash2 size={16} />
                              <span>Löschen</span>
                            </button>
                          </div>
                        </div>
                      );
                    }

                    if (item.type === 'fuel') {
                      const f = item.data;
                      return (
                        <div
                          key={item.idKey}
                          className={rowClass}
                          onTouchStart={handleTouchStart}
                          onTouchMove={handleTouchMove}
                          onTouchEnd={(e) =>
                            handleTouchEnd(
                              e,
                              () => setSwipedItemId(item.idKey),
                              () => { if (swipedItemId === item.idKey) setSwipedItemId(null); },
                              () => {
                                setFullSwipedItemId(item.idKey);
                                handleDeleteHistoryItem('fuel', f.id, item.idKey);
                              },
                            )
                          }
                          onClick={() => {
                            if (swipedItemId) setSwipedItemId(null);
                          }}
                        >
                          <div className="apple-swipe-content">
                            <div className="apple-item-leading">
                              <div className="apple-item-icon fuel">
                                <Fuel size={17} />
                              </div>
                              <div className="apple-item-details">
                                <div className="apple-item-title">
                                  Tanken {f.tankstelle ? `· ${f.tankstelle}` : ''}
                                </div>
                                <div className="apple-item-sub">
                                  {formatDate(f.zeitpunkt)}
                                  {f.odometer_km ? ` · ${formatNum(f.odometer_km, 0)} km` : ''}
                                  {f.fuel_km ? ` · Trip ${formatNum(f.fuel_km, 1)} km` : ''}
                                </div>
                              </div>
                            </div>
                            <div className="apple-item-trailing">
                              <span className="apple-item-metric fuel">+{formatNum(f.liter, 2)} L</span>
                              <span className="apple-item-secondary">
                                {formatCur(f.gesamtkosten)} ({formatNum(f.preis_pro_liter, 3)} €)
                              </span>
                            </div>
                          </div>

                          {/* Swipe Delete Action */}
                          <div className="apple-swipe-actions">
                            <button
                              type="button"
                              className="apple-swipe-delete-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteHistoryItem('fuel', f.id, item.idKey);
                              }}
                            >
                              <Trash2 size={16} />
                              <span>Löschen</span>
                            </button>
                          </div>
                        </div>
                      );
                    }

                    if (item.type === 'snapshot') {
                      const s = item.data;
                      return (
                        <div
                          key={item.idKey}
                          className={rowClass}
                          onTouchStart={handleTouchStart}
                          onTouchMove={handleTouchMove}
                          onTouchEnd={(e) =>
                            handleTouchEnd(
                              e,
                              () => setSwipedItemId(item.idKey),
                              () => { if (swipedItemId === item.idKey) setSwipedItemId(null); },
                              () => {
                                setFullSwipedItemId(item.idKey);
                                handleDeleteHistoryItem('snapshot', s.id, item.idKey);
                              },
                            )
                          }
                          onClick={() => {
                            if (swipedItemId) setSwipedItemId(null);
                          }}
                        >
                          <div className="apple-swipe-content">
                            <div className="apple-item-leading">
                              <div className="apple-item-icon snapshot">
                                <Gauge size={17} />
                              </div>
                              <div className="apple-item-details">
                                <div className="apple-item-title">
                                  Tachostand · {formatNum(s.odometer_km, 0)} km
                                </div>
                                <div className="apple-item-sub">
                                  {formatDate(s.zeitpunkt)}
                                  {s.ev_range_km ? ` · EV ${formatNum(s.ev_range_km, 0)} km` : ''}
                                  {s.fuel_range_km ? ` · Benzin ${formatNum(s.fuel_range_km, 0)} km` : ''}
                                </div>
                              </div>
                            </div>
                            <div className="apple-item-trailing">
                              <span className="apple-item-metric snapshot">
                                {s.soc_percent != null ? `${s.soc_percent} %` : `${formatNum(s.odometer_km, 0)} km`}
                              </span>
                              <span className="apple-item-secondary">Telemetrie</span>
                            </div>
                          </div>

                          {/* Swipe Delete Action */}
                          <div className="apple-swipe-actions">
                            <button
                              type="button"
                              className="apple-swipe-delete-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteHistoryItem('snapshot', s.id, item.idKey);
                              }}
                            >
                              <Trash2 size={16} />
                              <span>Löschen</span>
                            </button>
                          </div>
                        </div>
                      );
                    }

                    return null;
                  })}
                </div>
              );
            })()}
          </div>
        )}

        {/* ========================================================================= */}
        {/* ========================================================================= */}
        {/* TAB: SETTINGS & TARIFFS */}
        {/* ========================================================================= */}
        {/* ========================================================================= */}
        {/* TAB: SETTINGS & TARIFFS (APPLE HIG INSET GROUPED) */}
        {/* ========================================================================= */}
        {activeTab === 'settings' && (
          <div>
            <div className="apple-settings-grid">
              {/* Desktop Column 1: Appearance, Tariffs & Backup */}
              <div>
                {/* 1. Darstellung (Appearance) */}
                <div className="settings-section-header">Darstellung</div>
                <div className="apple-grouped-card">
                  <div className="apple-row">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <Settings size={17} style={{ color: 'var(--text-muted)' }} />
                      <span className="apple-row-label">Themen-Modus</span>
                    </div>
                    <div className="apple-row-content">
                      <select
                        id="dashboard-theme"
                        value={dashboardTheme}
                        onChange={(event) => setDashboardTheme(event.target.value as 'oled' | 'blue')}
                        className="apple-row-select"
                      >
                        <option value="oled">Apple OLED Schwarz</option>
                        <option value="blue">Dunkles Blau</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* 2. Ladetarife & Strompreise */}
                <div className="settings-section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Ladetarife & Strompreise</span>
                  <button
                    type="button"
                    className="apple-history-tool-btn"
                    style={{ color: 'var(--primary)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                    onClick={() => setIsAddTariffOpen(true)}
                  >
                    <Plus size={14} /> Neu
                  </button>
                </div>

                <div className="apple-grouped-card">
                  {tariffs.length === 0 ? (
                    <div className="apple-row" style={{ justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.9rem', padding: '24px 16px' }}>
                      Keine Ladetarife hinterlegt
                    </div>
                  ) : (
                    tariffs.map((t) => {
                      const isCollapsing = deletingTariffId === t.id;
                      const isFullSwiped = fullSwipedTariffId === t.id;
                      const isSwiped = swipedTariffId === t.id;
                      const rowClass = `apple-swipe-row ${isCollapsing ? 'collapsing' : ''} ${isFullSwiped ? 'full-swiped' : ''} ${isSwiped ? 'swiped' : ''}`.trim();

                      return (
                        <div
                          key={t.id}
                          className={rowClass}
                          onTouchStart={handleTouchStart}
                          onTouchMove={handleTouchMove}
                          onTouchEnd={(e) =>
                            handleTouchEnd(
                              e,
                              () => setSwipedTariffId(t.id),
                              () => { if (swipedTariffId === t.id) setSwipedTariffId(null); },
                              () => {
                                setFullSwipedTariffId(t.id);
                                handleDeleteTariffItem(t.id, t.bezeichnung);
                              },
                            )
                          }
                          onClick={() => {
                            if (swipedTariffId) setSwipedTariffId(null);
                          }}
                        >
                          <div className="apple-swipe-content">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1 }}>
                              <div className="tariff-icon-badge">
                                <Zap size={16} />
                              </div>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: '0.92rem', fontWeight: 600, color: '#ffffff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {t.bezeichnung}
                                </div>
                                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                                  ID: <code>{t.quelle}</code> · Gültig ab {t.gueltig_ab}
                                </div>
                              </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                              <span style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--ev-color)', fontVariantNumeric: 'tabular-nums' }}>
                                {formatNum(t.preis_pro_kwh, 3)} €/kWh
                              </span>
                            </div>
                          </div>

                          <div className="apple-swipe-actions">
                            <button
                              type="button"
                              className="apple-swipe-delete-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteTariffItem(t.id, t.bezeichnung);
                              }}
                            >
                              <Trash2 size={16} />
                              <span>Löschen</span>
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}

                  <button
                    type="button"
                    className="apple-row-action-btn"
                    onClick={() => setIsAddTariffOpen(true)}
                  >
                    <Plus size={15} style={{ color: 'var(--primary)' }} />
                    <span>Neuen Tarif anlegen...</span>
                  </button>
                </div>

                {/* 3. Datensicherung */}
                <div className="settings-section-header">Datensicherung</div>
                <div className="apple-grouped-card">
                  <div className="apple-row">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <Database size={17} style={{ color: 'var(--primary)' }} />
                      <span className="apple-row-label">Tägliche Datensicherung</span>
                    </div>
                    <div className="apple-row-content">
                      <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Automatisch aktiv</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="apple-row-action-btn"
                    onClick={handleBackup}
                  >
                    <Database size={15} style={{ color: 'var(--primary)' }} />
                    <span>Manuelles Backup jetzt ausführen</span>
                  </button>
                </div>
              </div>

              {/* Desktop Column 2: Kia Connect Telemetry & Credentials */}
              <div>
                {/* 4. Kia Connect Telemetrie */}
                <div className="settings-section-header">Kia Connect Telemetrie</div>
                <div className="apple-grouped-card">
                  <div className="apple-row">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <RefreshCw size={17} style={{ color: 'var(--primary)' }} />
                      <span className="apple-row-label">Cloud-Verbindung</span>
                    </div>
                    <div className="apple-row-content">
                      <span className={kiaStatus?.configured ? 'settings-badge-ok' : 'settings-badge-pending'}>
                        {kiaStatus?.configured ? `Verbunden (${kiaStatus.username})` : 'Nicht eingerichtet'}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="apple-row-action-btn"
                    onClick={() => handleKiaSync(false)}
                    disabled={isKiaSyncing}
                  >
                    <RefreshCw size={15} className={isKiaSyncing ? 'spin' : ''} style={{ color: 'var(--primary)' }} />
                    <span>{isKiaSyncing ? 'Synchronisiere...' : 'Telemetrie abrufen (Cache)'}</span>
                  </button>

                  <button
                    type="button"
                    className="apple-row-action-btn"
                    onClick={() => handleKiaSync(true)}
                    disabled={isKiaSyncing}
                    title="Weckt das Auto auf für Live-Daten"
                  >
                    <Radio size={15} style={{ color: 'var(--fuel-color)' }} />
                    <span>Live-Fahrzeugabfrage erzwingen</span>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>Weckt Auto</span>
                  </button>
                </div>

                {/* 5. Kia Zugangsdaten */}
                <div className="settings-section-header">Kia Zugangsdaten</div>
                <form onSubmit={handleSaveKiaConfig}>
                  <div className="apple-grouped-card">
                    <div className="apple-row">
                      <span className="apple-row-label">E-Mail / Benutzer *</span>
                      <div className="apple-row-content">
                        <input
                          type="email"
                          value={kiaUsernameInput}
                          onChange={(e) => setKiaUsernameInput(e.target.value)}
                          required
                          placeholder="kia-account@beispiel.at"
                          className="apple-row-input"
                          style={{ maxWidth: '220px' }}
                        />
                      </div>
                    </div>

                    <div className="apple-row">
                      <span className="apple-row-label">Passwort {kiaStatus?.configured ? '(optional)' : '*'}</span>
                      <div className="apple-row-content">
                        <input
                          type="password"
                          value={kiaPasswordInput}
                          onChange={(e) => setKiaPasswordInput(e.target.value)}
                          placeholder={kiaStatus?.configured ? '••••••••' : 'Passwort'}
                          className="apple-row-input"
                          style={{ maxWidth: '160px' }}
                        />
                      </div>
                    </div>

                    <div className="apple-row">
                      <span className="apple-row-label">PIN (optional)</span>
                      <div className="apple-row-content">
                        <input
                          type="password"
                          value={kiaPinInput}
                          onChange={(e) => setKiaPinInput(e.target.value)}
                          placeholder="PIN"
                          maxLength={6}
                          className="apple-row-input"
                          style={{ maxWidth: '100px' }}
                        />
                      </div>
                    </div>

                    <div className="apple-row">
                      <span className="apple-row-label">Standardmäßig Live-Abfrage</span>
                      <div className="apple-row-content">
                        <label className="apple-toggle-label" style={{ margin: 0 }}>
                          <input
                            type="checkbox"
                            checked={kiaForceRefresh}
                            onChange={(e) => setKiaForceRefresh(e.target.checked)}
                          />
                        </label>
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="apple-row-action-btn"
                      style={{ color: 'var(--primary)', fontWeight: 600, justifyContent: 'center' }}
                    >
                      <CheckCircle2 size={15} />
                      <span>Zugangsdaten speichern</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>

            {/* Apple Modal Form Sheet: Neuer Tarif */}
            {isAddTariffOpen && (
              <div className="apple-modal-overlay" onClick={() => setIsAddTariffOpen(false)}>
                <div className="apple-modal-sheet" onClick={(e) => e.stopPropagation()}>
                  <div className="apple-modal-nav" style={{ padding: '0 0 16px' }}>
                    <button
                      type="button"
                      className="apple-nav-action-btn apple-nav-cancel"
                      onClick={() => setIsAddTariffOpen(false)}
                    >
                      Abbrechen
                    </button>
                    <span className="apple-nav-title">Neuer Tarif</span>
                    <button
                      type="submit"
                      form="add-tariff-modal-form"
                      className="apple-nav-action-btn apple-nav-save"
                    >
                      Sichern
                    </button>
                  </div>

                  <form id="add-tariff-modal-form" onSubmit={handleAddTariff}>
                    <div className="apple-grouped-card" style={{ marginBottom: 0 }}>
                      <div className="apple-row">
                        <span className="apple-row-label">Kennung *</span>
                        <div className="apple-row-content">
                          <input
                            type="text"
                            name="quelle"
                            required
                            placeholder="z.B. vkw, enbw"
                            className="apple-row-input"
                            style={{ maxWidth: '180px' }}
                            autoFocus
                          />
                        </div>
                      </div>

                      <div className="apple-row">
                        <span className="apple-row-label">Bezeichnung *</span>
                        <div className="apple-row-content">
                          <input
                            type="text"
                            name="bezeichnung"
                            required
                            placeholder="z.B. VKW Ladetarif 2026"
                            className="apple-row-input"
                            style={{ maxWidth: '200px' }}
                          />
                        </div>
                      </div>

                      <div className="apple-row">
                        <span className="apple-row-label">Preis (€/kWh) *</span>
                        <div className="apple-row-content">
                          <input
                            type="text"
                            name="preis_pro_kwh"
                            required
                            placeholder="0,38"
                            inputMode="decimal"
                            className="apple-row-input"
                            style={{ maxWidth: '100px' }}
                          />
                          <span className="apple-row-suffix">€</span>
                        </div>
                      </div>

                      <div className="apple-row">
                        <span className="apple-row-label">Gültig ab *</span>
                        <div className="apple-row-content">
                          <input
                            type="date"
                            name="gueltig_ab"
                            required
                            defaultValue={new Date().toISOString().slice(0, 10)}
                            className="apple-row-datetime"
                          />
                        </div>
                      </div>
                    </div>
                  </form>
                </div>
              </div>
            )}
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
    </div>
  );
}

export default App;
