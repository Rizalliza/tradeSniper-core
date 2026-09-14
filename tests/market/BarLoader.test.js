import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BarLoader } from '../../src/market/BarLoader.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const TEST_CSV = `symbol,date,time,open,high,low,close,volume
AAPL,2026-02-02,09:30:00,150.00,151.00,149.50,150.50,100000
AAPL,2026-02-02,09:31:00,150.50,152.00,150.20,151.80,150000
AAPL,2026-02-02,09:32:00,151.80,152.50,151.00,152.20,120000
TSLA,2026-02-02,09:30:00,400.00,405.00,398.00,402.00,200000
TSLA,2026-02-02,09:31:00,402.00,410.00,401.00,408.00,250000`;

test('fromCSV parses CSV correctly', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'barloader-'));
    const filePath = path.join(tmpDir, 'test.csv');
    fs.writeFileSync(filePath, TEST_CSV);

    const bars = BarLoader.fromCSV(filePath);
    assert.equal(bars.length, 5);
    assert.equal(bars[0].symbol, 'AAPL');
    assert.equal(bars[0].date, '2026-02-02');
    assert.equal(bars[0].open, 150.0);
    assert.equal(bars[0].high, 151.0);
    assert.equal(bars[0].low, 149.5);
    assert.equal(bars[0].close, 150.5);
    assert.equal(bars[0].volume, 100000);

    fs.rmSync(tmpDir, { recursive: true });
});

test('fromCSV returns empty array for header-only file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'barloader-'));
    const filePath = path.join(tmpDir, 'empty.csv');
    fs.writeFileSync(filePath, 'symbol,date,time,open,high,low,close,volume\n');

    const bars = BarLoader.fromCSV(filePath);
    assert.equal(bars.length, 0);

    fs.rmSync(tmpDir, { recursive: true });
});

test('toBarsMap groups by symbol and date', () => {
    const bars = [
        { symbol: 'AAPL', date: '2026-02-02', time: '09:31:00' },
        { symbol: 'AAPL', date: '2026-02-02', time: '09:30:00' },
        { symbol: 'TSLA', date: '2026-02-02', time: '09:30:00' },
    ];
    const map = BarLoader.toBarsMap(bars);
    assert.equal(map['AAPL|2026-02-02'].length, 2);
    assert.equal(map['TSLA|2026-02-02'].length, 1);
    // Should be sorted by time
    assert.equal(map['AAPL|2026-02-02'][0].time, '09:30:00');
});

test('filterWindow filters bars by time', () => {
    const bars = [
        { time: '09:29:00' },
        { time: '09:30:00' },
        { time: '09:35:00' },
        { time: '09:44:00' },
        { time: '09:45:00' },
        { time: '09:50:00' },
    ];
    const filtered = BarLoader.filterWindow(bars, '09:30:00', '09:45:00');
    assert.equal(filtered.length, 3); // 09:30, 09:35, 09:44
    assert.equal(filtered[0].time, '09:30:00');
    assert.equal(filtered[2].time, '09:44:00');
});

test('aggregate combines bars', () => {
    const bars = [];
    for (let i = 0; i < 5; i++) {
        bars.push({
            symbol: 'AAPL', date: '2026-02-02', time: `09:3${i}:00`,
            open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 1000,
        });
    }
    const agg = BarLoader.aggregate(bars, 2);
    assert.equal(agg.length, 3); // ceil(5/2) = 3
    // First aggregated bar: high = max(101, 102) = 102, low = min(99, 100) = 99
    assert.equal(agg[0].high, 102);
    assert.equal(agg[0].low, 99);
    assert.equal(agg[0].close, 101.5);
    assert.equal(agg[0].volume, 2000);
});

test('aggregate with period=1 returns copy', () => {
    const bars = [
        { symbol: 'AAPL', time: '09:30:00', open: 100, high: 101, low: 99, close: 100.5, volume: 100 },
    ];
    const agg = BarLoader.aggregate(bars, 1);
    assert.equal(agg.length, 1);
    assert.notEqual(agg[0], bars[0]);
});
