/**
 * Pure calculation logic for PHEV cost tracking and break-even analysis.
 */

export interface EvMetricsInput {
  totalKwh: number;
  totalCost: number;
  totalEvKm: number;
  measuredKwh?: number;
  measuredEvKm?: number;
  defaultKwhPer100Km?: number;
  averagePricePerKwh?: number;
}

export interface EvMetricsResult {
  totalKwh: number;
  totalCost: number;
  totalEvKm: number;
  kwhPer100Km: number;
  costPerKm: number;
  costPer100Km: number;
  isEstimate: boolean;
}

export interface FuelMetricsInput {
  totalLiter: number;
  totalCost: number;
  totalFuelKm: number;
  measuredLiter?: number;
  measuredFuelKm?: number;
  defaultLPer100Km?: number;
  averagePricePerLiter?: number;
}

export interface FuelMetricsResult {
  totalLiter: number;
  totalCost: number;
  totalFuelKm: number;
  literPer100Km: number;
  costPerKm: number;
  costPer100Km: number;
  isEstimate: boolean;
}

export interface BreakEvenInput {
  evKwhPer100Km: number;
  fuelLiterPer100Km: number;
  fuelPricePerLiter: number;
  electricityPricePerKwh: number;
}

export interface BreakEvenResult {
  breakEvenElectricityPricePerKwh: number;
  costPer100KmEv: number;
  costPer100KmFuel: number;
  savingsPer100Km: number;
  savingsPerKm: number;
  isEvCheaper: boolean;
  evKwhPer100Km: number;
  fuelLiterPer100Km: number;
  fuelPricePerLiter: number;
  electricityPricePerKwh: number;
}

/**
 * Parses a localized number string (supports comma and dot separators).
 * E.g., "15,5" -> 15.5, "1.234,56" -> 1234.56, 12.3 -> 12.3
 */
export function parseLocaleNumber(val: unknown): number {
  if (typeof val === 'number') {
    if (isNaN(val)) throw new Error('Ungültige Zahl: NaN');
    return val;
  }
  if (val === null || val === undefined) {
    throw new Error('Zahlwert darf nicht leer sein');
  }
  const s = String(val).trim();
  if (s === '') {
    throw new Error('Zahlwert darf nicht leer sein');
  }

  // Handle German formatting: 1.234,56 -> 1234.56 or simple 15,5 -> 15.5
  let normalized = s;
  if (s.includes(',') && s.includes('.')) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      // 1.234,56 -> comma is decimal separator
      normalized = s.replace(/\./g, '').replace(',', '.');
    } else {
      // 1,234.56 -> dot is decimal separator
      normalized = s.replace(/,/g, '');
    }
  } else if (s.includes(',')) {
    // Only comma: 15,5 -> 15.5
    normalized = s.replace(',', '.');
  }

  const num = Number(normalized);
  if (isNaN(num)) {
    throw new Error(`Ungültige Zahl: "${val}"`);
  }
  return num;
}

/**
 * Calculates EV consumption and cost metrics.
 * Uses paired measured sessions (with ev_km > 0) to compute true specific consumption (kWh/100km),
 * preventing unmeasured sessions (e.g. public charging imports) from artificially inflating consumption.
 */
export function calculateEvMetrics(input: EvMetricsInput): EvMetricsResult {
  const {
    totalKwh,
    totalCost,
    totalEvKm,
    measuredKwh,
    measuredEvKm,
    defaultKwhPer100Km = 15.5,
    averagePricePerKwh = totalKwh > 0 ? totalCost / totalKwh : 0.30,
  } = input;

  // Case A: We have paired measurements (measuredEvKm > 0 and measuredKwh > 0)
  if (measuredEvKm !== undefined && measuredEvKm > 0 && measuredKwh !== undefined && measuredKwh > 0) {
    const kwhPer100Km = (measuredKwh / measuredEvKm) * 100;
    // Projected effective EV distance covering all charged energy
    const effectiveKm = (totalKwh / kwhPer100Km) * 100;
    const costPerKm = effectiveKm > 0 ? totalCost / effectiveKm : (kwhPer100Km / 100) * averagePricePerKwh;
    return {
      totalKwh: round2(totalKwh),
      totalCost: round2(totalCost),
      totalEvKm: round2(effectiveKm),
      kwhPer100Km: round2(kwhPer100Km),
      costPerKm: round4(costPerKm),
      costPer100Km: round2(costPerKm * 100),
      isEstimate: false,
    };
  }

  // Case B: Direct totalEvKm provided
  if (totalEvKm > 0 && totalKwh > 0) {
    const kwhPer100Km = (totalKwh / totalEvKm) * 100;
    const costPerKm = totalCost / totalEvKm;
    return {
      totalKwh: round2(totalKwh),
      totalCost: round2(totalCost),
      totalEvKm: round2(totalEvKm),
      kwhPer100Km: round2(kwhPer100Km),
      costPerKm: round4(costPerKm),
      costPer100Km: round2(costPerKm * 100),
      isEstimate: false,
    };
  }

  // Fallback if no electric km have been recorded yet
  const costPer100Km = defaultKwhPer100Km * averagePricePerKwh;
  const costPerKm = costPer100Km / 100;
  return {
    totalKwh: round2(totalKwh),
    totalCost: round2(totalCost),
    totalEvKm: 0,
    kwhPer100Km: round2(defaultKwhPer100Km),
    costPerKm: round4(costPerKm),
    costPer100Km: round2(costPer100Km),
    isEstimate: true,
  };
}

/**
 * Calculates Fuel consumption and cost metrics.
 * Uses paired measured sessions (with fuel_km > 0) to compute true specific consumption (L/100km).
 */
export function calculateFuelMetrics(input: FuelMetricsInput): FuelMetricsResult {
  const {
    totalLiter,
    totalCost,
    totalFuelKm,
    measuredLiter,
    measuredFuelKm,
    defaultLPer100Km = 5.5,
    averagePricePerLiter = totalLiter > 0 ? totalCost / totalLiter : 1.65,
  } = input;

  if (measuredFuelKm !== undefined && measuredFuelKm > 0 && measuredLiter !== undefined && measuredLiter > 0) {
    const literPer100Km = (measuredLiter / measuredFuelKm) * 100;
    const effectiveKm = totalFuelKm > 0 ? totalFuelKm : (totalLiter / literPer100Km) * 100;
    const costPerKm = effectiveKm > 0 ? totalCost / effectiveKm : (literPer100Km / 100) * averagePricePerLiter;
    return {
      totalLiter: round2(totalLiter),
      totalCost: round2(totalCost),
      totalFuelKm: round2(effectiveKm),
      literPer100Km: round2(literPer100Km),
      costPerKm: round4(costPerKm),
      costPer100Km: round2(costPerKm * 100),
      isEstimate: false,
    };
  }

  if (totalFuelKm > 0 && totalLiter > 0) {
    const literPer100Km = (totalLiter / totalFuelKm) * 100;
    const costPerKm = totalCost / totalFuelKm;
    return {
      totalLiter: round2(totalLiter),
      totalCost: round2(totalCost),
      totalFuelKm: round2(totalFuelKm),
      literPer100Km: round2(literPer100Km),
      costPerKm: round4(costPerKm),
      costPer100Km: round2(costPerKm * 100),
      isEstimate: false,
    };
  }

  // Fallback if no fuel km have been recorded yet
  const costPer100Km = defaultLPer100Km * averagePricePerLiter;
  const costPerKm = costPer100Km / 100;
  return {
    totalLiter: round2(totalLiter),
    totalCost: round2(totalCost),
    totalFuelKm: 0,
    literPer100Km: round2(defaultLPer100Km),
    costPerKm: round4(costPerKm),
    costPer100Km: round2(costPer100Km),
    isEstimate: true,
  };
}

/**
 * Calculates break-even electricity price and current savings per 100 km.
 *
 * Formula:
 * BreakEvenPrice (€/kWh) = (FuelConsumption [L/100km] * FuelPrice [€/L]) / EvConsumption [kWh/100km]
 */
export function calculateBreakEven(input: BreakEvenInput): BreakEvenResult {
  const {
    evKwhPer100Km,
    fuelLiterPer100Km,
    fuelPricePerLiter,
    electricityPricePerKwh,
  } = input;

  if (evKwhPer100Km <= 0) {
    throw new Error('EV Verbrauch muss größer als 0 sein für Break-Even-Berechnung');
  }

  const costPer100KmFuel = fuelLiterPer100Km * fuelPricePerLiter;
  const costPer100KmEv = evKwhPer100Km * electricityPricePerKwh;

  const breakEvenElectricityPricePerKwh = costPer100KmFuel / evKwhPer100Km;
  const savingsPer100Km = costPer100KmFuel - costPer100KmEv;
  const savingsPerKm = savingsPer100Km / 100;

  return {
    breakEvenElectricityPricePerKwh: round4(breakEvenElectricityPricePerKwh),
    costPer100KmEv: round2(costPer100KmEv),
    costPer100KmFuel: round2(costPer100KmFuel),
    savingsPer100Km: round2(savingsPer100Km),
    savingsPerKm: round4(savingsPerKm),
    isEvCheaper: electricityPricePerKwh <= breakEvenElectricityPricePerKwh,
    evKwhPer100Km: round2(evKwhPer100Km),
    fuelLiterPer100Km: round2(fuelLiterPer100Km),
    fuelPricePerLiter: round3(fuelPricePerLiter),
    electricityPricePerKwh: round3(electricityPricePerKwh),
  };
}

function round2(n: number): number {
  return Math.round((n + 1e-9) * 100) / 100;
}

function round3(n: number): number {
  return Math.round((n + 1e-9) * 1000) / 1000;
}

function round4(n: number): number {
  return Math.round((n + 1e-9) * 10000) / 10000;
}
