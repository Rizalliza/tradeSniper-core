import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BufferSensitivity } from '../../src/analysis/BufferSensitivity.js';

const markerList = [
    { name: 'weekly_high', value: 115, type: 'resistance', tier: 'weekly' },
    { name: 'daily_high', value: 110, type: 'resistance', tier: 'daily' },
    { name: 'prior_day_close', value: 100, type: 'neutral', tier: 'daily' },
    { name: 'daily_low', value: 90, type: 'support', tier: 'daily' },
    { name: 'weekly_low', value: 85, type: 'support', tier: 'weekly' },
];

function makeBar(time, price, spread = 0.1) {
    return { time, open: price, high: price + spread, low: price - spread, close: price };
}

function generateCleanSellSetup() {
    const bars = [];
    let price = 108;
    for (let s = 0; s < 6; s++) {
        price -= 1.5;
        bars.push(makeBar(`09:30:0${s}`, price, 0.1));
    }
    for (let s = 6; s < 11; s++) {
        price += 0.3;
        bars.push(makeBar(`09:30:${String(s).padStart(2, '0')}`, price, 0.1));
    }
    for (let i = 0; i < 60; i++) {
        price = Math.max(85, price - 0.2);
        bars.push(makeBar(`09:31:${String(i).padStart(2, '0')}`, price, 0.1));
    }
    return bars;
}

test('runs sensitivity analysis across buffer levels', () => {
    const bars = generateCleanSellSetup();
    const results = BufferSensitivity.analyze(bars, markerList, {
        buffers: [0.0005, 0.001, 0.002, 0.005, 0.01],
    });
    assert.equal(results.length, 5);
    const withEntries = results.filter(r => r.hadEntry);
    assert.ok(withEntries.length >= 3, 'should have entries at multiple levels');
});

test('finds optimal buffer level', () => {
    const bars = generateCleanSellSetup();
    const results = BufferSensitivity.analyze(bars, markerList, {
        buffers: [0.0005, 0.001, 0.0015, 0.002, 0.005],
    });
    const optimal = BufferSensitivity.findOptimal(results);
    assert.ok(optimal.optimalPct !== null);
    assert.ok(optimal.optimalBps);
    assert.ok(Array.isArray(optimal.consistentRange));
    assert.ok(optimal.analysis);
    assert.equal(optimal.entryCount, results.filter(r => r.hadEntry).length);
});

test('formatTable produces readable output', () => {
    const bars = generateCleanSellSetup();
    const results = BufferSensitivity.analyze(bars, markerList, {
        buffers: [0.0015, 0.003],
    });
    const table = BufferSensitivity.formatTable(results);
    assert.ok(table.includes('Buffer'));
    assert.ok(table.includes('bps'));
    assert.ok(table.length > 0);
});

test('tight buffer catches fewer entries', () => {
    const bars = [];
    let price = 108;
    for (let s = 0; s < 6; s++) {
        price -= 1.5;
        bars.push(makeBar(`09:30:0${s}`, price, 0.05));
    }
    for (let s = 6; s < 15; s++) {
        price = Math.min(99.5, price + 0.1);
        bars.push(makeBar(`09:30:${String(s).padStart(2, '0')}`, price, 0.05));
    }
    for (let i = 0; i < 30; i++) {
        price -= 0.1;
        bars.push(makeBar(`09:31:${String(i).padStart(2, '0')}`, price, 0.05));
    }
    const results = BufferSensitivity.analyze(bars, markerList, {
        buffers: [0.001, 0.002, 0.005, 0.01],
    });
    const strict = results.find(r => r.bufferPct === 0.001);
    const loose = results.find(r => r.bufferPct === 0.01);
    assert.equal(strict.hadEntry, false);
    assert.equal(loose.hadEntry, true);
});

test('findOptimal handles no entries gracefully', () => {
    const bars = [makeBar('09:30:00', 50, 0.1)]; // no cross, no entry
    const results = BufferSensitivity.analyze(bars, markerList, {
        buffers: [0.001, 0.002],
    });
    const optimal = BufferSensitivity.findOptimal(results);
    assert.equal(optimal.optimalPct, null);
    assert.equal(optimal.entryCount, 0);
    assert.equal(optimal.analysis, 'No entries found at any buffer level');
});

test('result includes bufferBps in basis points', () => {
    const bars = generateCleanSellSetup();
    const results = BufferSensitivity.analyze(bars, markerList, {
        buffers: [0.0015],
    });
    assert.equal(results[0].bufferBps, '15.0');
});

test('result includes trailing state', () => {
    const bars = generateCleanSellSetup();
    const results = BufferSensitivity.analyze(bars, markerList, {
        buffers: [0.005],
    });
    assert.equal(typeof results[0].trailing, 'boolean');
});

test('result includes reverse and forward crossing counts', () => {
    const bars = generateCleanSellSetup();
    const results = BufferSensitivity.analyze(bars, markerList, {
        buffers: [0.0015],
    });
    assert.equal(typeof results[0].reverseCrossings, 'number');
    assert.equal(typeof results[0].forwardCrossings, 'number');
});
