import test from 'node:test';
import assert from 'node:assert/strict';
import { MassiveData } from '../../src/data/MassiveData.js';

test('converts intraday aggregate timestamps to New York market time', () => {
  const massive = new MassiveData();
  const bar = massive._convertAggregate('AAPL', {
    t: Date.UTC(2026, 1, 2, 14, 30, 0),
    o: 1,
    h: 2,
    l: 0.5,
    c: 1.5,
    v: 100,
  }, 'minute');

  assert.equal(bar.date, '2026-02-02');
  assert.equal(bar.time, '09:30:00');
});

test('keeps daily aggregate dates on the exchange session date', () => {
  const massive = new MassiveData();
  const bar = massive._convertAggregate('AAPL', {
    t: Date.UTC(2026, 1, 2, 0, 0, 0),
    o: 1,
    h: 2,
    l: 0.5,
    c: 1.5,
    v: 100,
  }, 'day');

  assert.equal(bar.date, '2026-02-02');
  assert.equal(bar.time, '00:00:00');
});

test('converts flat-file timestamps to New York market time', () => {
  const massive = new MassiveData();
  const header = ['ticker', 'window_start', 'open', 'high', 'low', 'close', 'volume', 'transactions'];
  const timestampNs = String(Date.UTC(2026, 1, 2, 14, 30, 0) * 1e6);
  const row = ['AAPL', timestampNs, '1', '2', '0.5', '1.5', '100', '3'];

  const bar = massive._convertFlatRow(row, header);

  assert.equal(bar.date, '2026-02-02');
  assert.equal(bar.time, '09:30:00');
});
