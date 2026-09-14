import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MarkerService, MARKER_TYPES } from '../../src/market/MarkerService.js';

const dailyBars = [
    { date: '2026-01-26', o: 100, h: 105, l: 95, c: 102 },
    { date: '2026-01-27', o: 103, h: 110, l: 98, c: 108 },
    { date: '2026-01-28', o: 109, h: 115, l: 105, c: 112 },
    { date: '2026-01-29', o: 113, h: 120, l: 108, c: 118 },
    { date: '2026-01-30', o: 119, h: 125, l: 114, c: 122 },
    { date: '2026-02-02', o: 121, h: 130, l: 118, c: 128 },
];

test('MarkerService.compute returns null for index 0', () => {
    const result = MarkerService.compute(dailyBars, 0);
    assert.equal(result, null);
});

test('MarkerService.compute returns all 8 markers', () => {
    const result = MarkerService.compute(dailyBars, 3);
    assert.ok(result);
    assert.equal(typeof result.prior_day_open, 'number');
    assert.equal(typeof result.prior_day_close, 'number');
    assert.equal(typeof result.daily_high, 'number');
    assert.equal(typeof result.daily_low, 'number');
    assert.equal(typeof result.weekly_high, 'number');
    assert.equal(typeof result.weekly_low, 'number');
    assert.equal(typeof result.monthly_high, 'number');
    assert.equal(typeof result.monthly_low, 'number');
});

test('MarkerService.compute uses prior day for daily markers', () => {
    const result = MarkerService.compute(dailyBars, 3);
    assert.equal(result.daily_high, 115);
    assert.equal(result.daily_low, 105);
    assert.equal(result.prior_day_open, 109);
    assert.equal(result.prior_day_close, 112);
});

test('MarkerService.compute weekly looks back 5 days', () => {
    const result = MarkerService.compute(dailyBars, 5);
    // 5 prior days: indices 0-4, lows: 95, 98, 105, 108, 114 → min = 95
    assert.equal(result.weekly_high, 125); // max of 5 prior days
    assert.equal(result.weekly_low, 95);   // min of 5 prior days
});

test('MarkerService.buildList returns sorted high to low', () => {
    const markers = MarkerService.compute(dailyBars, 3);
    const list = MarkerService.buildList(markers);
    for (let i = 1; i < list.length; i++) {
        assert.ok(list[i - 1].value >= list[i].value, `index ${i} out of order`);
    }
});

test('MarkerService.buildList includes type and tier for each marker', () => {
    const markers = MarkerService.compute(dailyBars, 3);
    const list = MarkerService.buildList(markers);
    for (const m of list) {
        assert.ok(['support', 'resistance', 'neutral'].includes(m.type), `bad type: ${m.type}`);
        assert.ok(m.tier, 'tier missing');
    }
});

test('MarkerService.buildList merges markers within $0.01', () => {
    const markers = {
        monthly_high: 100.00,
        weekly_high: 100.005,  // within 0.01 of monthly_high
        daily_high: 100.008,   // also within 0.01
        prior_day_close: 95,
        prior_day_open: 94,
        daily_low: 90,
        weekly_low: 89.995,
        monthly_low: 89.998,
    };
    const list = MarkerService.buildList(markers);
    assert.ok(list.length < 8, 'should have merged some markers');
});

test('MarkerService.nextMarker finds next marker UP', () => {
    // Use markers with distinct values so no dedup issues
    const markers = {
        monthly_high: 200, weekly_high: 180, daily_high: 160,
        prior_day_close: 150, prior_day_open: 140,
        daily_low: 130, weekly_low: 110, monthly_low: 100,
    };
    const list = MarkerService.buildList(markers);
    // List is high→low. UP = lower index = higher price
    const result = MarkerService.nextMarker(list, 'daily_high', 'UP');
    assert.ok(result);
    assert.equal(result.name, 'weekly_high');
    assert.equal(result.value, 180);
});

test('MarkerService.nextMarker finds next marker DOWN', () => {
    const markers = {
        monthly_high: 200, weekly_high: 180, daily_high: 160,
        prior_day_close: 150, prior_day_open: 140,
        daily_low: 130, weekly_low: 110, monthly_low: 100,
    };
    const list = MarkerService.buildList(markers);
    const result = MarkerService.nextMarker(list, 'daily_high', 'DOWN');
    assert.ok(result);
    assert.equal(result.name, 'prior_day_close');
    assert.equal(result.value, 150);
});

test('MarkerService.nextMarker returns null at boundary', () => {
    const markers = MarkerService.compute(dailyBars, 3);
    const list = MarkerService.buildList(markers);
    const top = MarkerService.nextMarker(list, list[0].name, 'UP');
    assert.equal(top, null);
    const bottom = MarkerService.nextMarker(list, list[list.length - 1].name, 'DOWN');
    assert.equal(bottom, null);
});

test('MarkerService.nextMarker returns null for unknown name', () => {
    const markers = MarkerService.compute(dailyBars, 3);
    const list = MarkerService.buildList(markers);
    const result = MarkerService.nextMarker(list, 'nonexistent', 'UP');
    assert.equal(result, null);
});

test('MarkerService.classify finds nearest support and resistance', () => {
    const markers = {
        monthly_high: 200, weekly_high: 180, daily_high: 160,
        prior_day_close: 150, prior_day_open: 145,
        daily_low: 130, weekly_low: 110, monthly_low: 100,
    };
    const list = MarkerService.buildList(markers);
    const cls = MarkerService.classify(list, 155);
    assert.equal(cls.nearestResistance.name, 'daily_high');
    assert.equal(cls.nearestResistance.value, 160);
    assert.equal(cls.nearestSupport.name, 'prior_day_close');
    assert.equal(cls.nearestSupport.value, 150);
});

test('MARKER_TYPES has correct resistance/support labels', () => {
    assert.equal(MARKER_TYPES.monthly_high.type, 'resistance');
    assert.equal(MARKER_TYPES.weekly_high.type, 'resistance');
    assert.equal(MARKER_TYPES.daily_high.type, 'resistance');
    assert.equal(MARKER_TYPES.prior_day_close.type, 'neutral');
    assert.equal(MARKER_TYPES.prior_day_open.type, 'neutral');
    assert.equal(MARKER_TYPES.daily_low.type, 'support');
    assert.equal(MARKER_TYPES.weekly_low.type, 'support');
    assert.equal(MARKER_TYPES.monthly_low.type, 'support');
});
