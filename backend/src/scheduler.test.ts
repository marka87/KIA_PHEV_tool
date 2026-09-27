import { test } from 'node:test';
import assert from 'node:assert/strict';
import cron from 'node-cron';
import {
  initScheduler,
  getSchedulerStatus,
} from './scheduler.js';
import { AUTO_SYNC_CRON, AUTO_SYNC_ENABLED, AUTO_SYNC_TIMEZONE } from './config.js';

test('Scheduler: default configuration is 07:00 and 20:00 Uhr', () => {
  const status = getSchedulerStatus();
  assert.equal(status.enabled, true);
  assert.equal(status.cron, '0 7,20 * * *');
  assert.ok(cron.validate(status.cron), `Cron expression ${status.cron} should be valid`);
});

test('Scheduler: cron expression validates successfully for morning and evening', () => {
  assert.ok(cron.validate(AUTO_SYNC_CRON));
  assert.ok(cron.validate('0 7 * * *'));
  assert.ok(cron.validate('0 20 * * *'));
});
