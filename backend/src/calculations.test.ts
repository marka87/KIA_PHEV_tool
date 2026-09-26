import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseLocaleNumber,
  calculateEvMetrics,
  calculateFuelMetrics,
  calculateBreakEven,
} from './calculations.js';

test('parseLocaleNumber: parses comma and dot numbers correctly', () => {
  assert.strictEqual(parseLocaleNumber(15.5), 15.5);
  assert.strictEqual(parseLocaleNumber('15.5'), 15.5);
  assert.strictEqual(parseLocaleNumber('15,5'), 15.5);
  assert.strictEqual(parseLocaleNumber('0,285'), 0.285);
  assert.strictEqual(parseLocaleNumber('1.250,50'), 1250.5);
  assert.strictEqual(parseLocaleNumber('1,250.50'), 1250.5);
  assert.strictEqual(parseLocaleNumber(' 42 '), 42);

  assert.throws(() => parseLocaleNumber(''), /darf nicht leer sein/);
  assert.throws(() => parseLocaleNumber(null), /darf nicht leer sein/);
  assert.throws(() => parseLocaleNumber('abc'), /Ungültige Zahl/);
});

test('calculateEvMetrics: computes real consumption and cost per km when ev km recorded', () => {
  // 50 kWh over 300 km, total cost 15.00 € (0.30 €/kWh)
  const result = calculateEvMetrics({
    totalKwh: 50,
    totalCost: 15.0,
    totalEvKm: 300,
  });

  assert.strictEqual(result.isEstimate, false);
  assert.strictEqual(result.totalKwh, 50);
  assert.strictEqual(result.totalCost, 15);
  assert.strictEqual(result.totalEvKm, 300);
  // (50 / 300) * 100 = 16.67 kWh/100km
  assert.strictEqual(result.kwhPer100Km, 16.67);
  // 15 / 300 = 0.05 €/km
  assert.strictEqual(result.costPerKm, 0.05);
  // 0.05 * 100 = 5.00 €/100km
  assert.strictEqual(result.costPer100Km, 5.0);
});

test('calculateEvMetrics: falls back to estimated baseline when ev km is 0', () => {
  const result = calculateEvMetrics({
    totalKwh: 0,
    totalCost: 0,
    totalEvKm: 0,
    defaultKwhPer100Km: 16.0,
    averagePricePerKwh: 0.30,
  });

  assert.strictEqual(result.isEstimate, true);
  assert.strictEqual(result.kwhPer100Km, 16.0);
  // 16.0 * 0.30 = 4.80 €/100km -> 0.048 €/km
  assert.strictEqual(result.costPer100Km, 4.8);
  assert.strictEqual(result.costPerKm, 0.048);
});

test('calculateFuelMetrics: computes real consumption and cost per km when fuel km recorded', () => {
  // 35 Liters over 600 km, total cost 56.00 € (1.60 €/L)
  const result = calculateFuelMetrics({
    totalLiter: 35,
    totalCost: 56.0,
    totalFuelKm: 600,
  });

  assert.strictEqual(result.isEstimate, false);
  assert.strictEqual(result.totalLiter, 35);
  assert.strictEqual(result.totalCost, 56);
  assert.strictEqual(result.totalFuelKm, 600);
  // (35 / 600) * 100 = 5.83 L/100km
  assert.strictEqual(result.literPer100Km, 5.83);
  // 56 / 600 = 0.0933 €/km
  assert.strictEqual(result.costPerKm, 0.0933);
  assert.strictEqual(result.costPer100Km, 9.33);
});

test('calculateFuelMetrics: falls back to baseline when fuel km is 0', () => {
  const result = calculateFuelMetrics({
    totalLiter: 0,
    totalCost: 0,
    totalFuelKm: 0,
    defaultLPer100Km: 5.5,
    averagePricePerLiter: 1.65,
  });

  assert.strictEqual(result.isEstimate, true);
  assert.strictEqual(result.literPer100Km, 5.5);
  // 5.5 * 1.65 = 9.08 €/100km
  assert.strictEqual(result.costPer100Km, 9.08);
  assert.strictEqual(result.costPerKm, 0.0908);
});

test('calculateBreakEven: correctly determines break-even price and savings', () => {
  // Kia Ceed SW PHEV realistic baseline:
  // EV: 16.0 kWh/100km, Fuel: 5.5 L/100km
  // Spritpreis: 1.65 €/L -> 5.5 * 1.65 = 9.075 €/100km
  // Strompreis zuhause: 0.28 €/kWh -> 16.0 * 0.28 = 4.48 €/100km
  // Break-even price: 9.075 / 16.0 = 0.5672 €/kWh
  const resultHome = calculateBreakEven({
    evKwhPer100Km: 16.0,
    fuelLiterPer100Km: 5.5,
    fuelPricePerLiter: 1.65,
    electricityPricePerKwh: 0.28,
  });

  assert.strictEqual(resultHome.breakEvenElectricityPricePerKwh, 0.5672);
  assert.strictEqual(resultHome.costPer100KmFuel, 9.08);
  assert.strictEqual(resultHome.costPer100KmEv, 4.48);
  assert.strictEqual(resultHome.savingsPer100Km, 4.6);
  assert.strictEqual(resultHome.isEvCheaper, true);

  // Expensive public DC charging: 0.65 €/kWh (above break-even of 0.5672)
  const resultPublicExpensive = calculateBreakEven({
    evKwhPer100Km: 16.0,
    fuelLiterPer100Km: 5.5,
    fuelPricePerLiter: 1.65,
    electricityPricePerKwh: 0.65,
  });

  assert.strictEqual(resultPublicExpensive.isEvCheaper, false);
  assert.ok(resultPublicExpensive.savingsPer100Km < 0); // Negative savings = EV is more expensive
});

test('calculateBreakEven: rejects non-positive EV consumption', () => {
  assert.throws(() => {
    calculateBreakEven({
      evKwhPer100Km: 0,
      fuelLiterPer100Km: 5.5,
      fuelPricePerLiter: 1.65,
      electricityPricePerKwh: 0.28,
    });
  }, /EV Verbrauch muss größer als 0 sein/);
});
