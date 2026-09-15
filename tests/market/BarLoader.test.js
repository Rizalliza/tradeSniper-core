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

test('aggregate uses clock-based bucketing with seconds bars', () => {
    // 5 second bars, each 1 second apart starting at 09:30:00
    const bars = [];
    for (let i = 0; i < 5; i++) {
        const sec = String(i).padStart(2, '0');
        bars.push({
            symbol: 'AAPL', date: '2026-02-02', time: `09:30:${sec}`,
            open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 1000,
        });
    }
    // Aggregate to 2-second buckets
    // Buckets: 09:30:00 (bars 0,1), 09:30:02 (bars 2,3), 09:30:04 (bar 4) = 3 bars
    const agg = BarLoader.aggregate(bars, 2, 'second');
    assert.equal(agg.length, 3);
    assert.equal(agg[0].time, '09:30:00');
    assert.equal(agg[0].high, 102); // max(101, 102)
    assert.equal(agg[0].low, 99);   // min(99, 100)
    assert.equal(agg[0].close, 101.5);
    assert.equal(agg[0].volume, 2000);
    assert.equal(agg[1].time, '09:30:02');
    assert.equal(agg[2].time, '09:30:04');
});

test('aggregate with period=1 returns copy', () => {
    const bars = [
        { symbol: 'AAPL', time: '09:30:00', open: 100, high: 101, low: 99, close: 100.5, volume: 100 },
    ];
    const agg = BarLoader.aggregate(bars, 1, 'second');
    assert.equal(agg.length, 1);
    assert.notEqual(agg[0], bars[0]);
});

test('aggregate with minute bars works correctly', () => {
    const bars = [
        { symbol: 'AAPL', date: '2026-02-02', time: '09:30:00', open: 100, high: 102, low: 99, close: 101, volume: 100 },
        { symbol: 'AAPL', date: '2026-02-02', time: '09:31:00', open: 101, high: 103, low: 100, close: 102, volume: 200 },
        { symbol: 'AAPL', date: '2026-02-02', time: '09:32:00', open: 102, high: 104, low: 101, close: 103, volume: 300 },
        { symbol: 'AAPL', date: '2026-02-02', time: '09:33:00', open: 103, high: 105, low: 102, close: 104, volume: 400 },
        { symbol: 'AAPL', date: '2026-02-02', time: '09:34:00', open: 104, high: 106, low: 103, close: 105, volume: 500 },
    ];
    // 5-minute aggregation: all 5 bars fit in one 5-min bucket starting at 09:30
    const agg = BarLoader.aggregate(bars, 300, 'minute');
    assert.equal(agg.length, 1);
    assert.equal(agg[0].time, '09:30:00');
    assert.equal(agg[0].open, 100);
    assert.equal(agg[0].high, 106);
    assert.equal(agg[0].low, 99);
    assert.equal(agg[0].close, 105);
    assert.equal(agg[0].volume, 1500);
});

test('aggregate does not cross day boundaries', () => {
    const bars = [
        { symbol: 'AAPL', date: '2026-02-02', time: '15:59:00', open: 100, high: 101, low: 99, close: 100.5, volume: 100 },
        { symbol: 'AAPL', date: '2026-02-02', time: '15:59:30', open: 100.5, high: 101, low: 100, close: 100.8, volume: 150 },
        { symbol: 'AAPL', date: '2026-02-03', time: '09:30:00', open: 102, high: 103, low: 101, close: 102.5, volume: 200 },
    ];
    // 30-second buckets: bars on different dates are in separate buckets
    const agg = BarLoader.aggregate(bars, 30, 'second');
    assert.equal(agg.length, 3);
    assert.equal(agg[0].date, '2026-02-02');
    assert.equal(agg[2].date, '2026-02-03');
});
