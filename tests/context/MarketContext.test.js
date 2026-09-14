import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MarketContext, VOLATILITY_REGIMES } from '../../src/context/MarketContext.js';

test('MarketContext initializes with defaults', () => {
    const ctx = new MarketContext();
    assert.equal(ctx.vix, 20);
    assert.deepEqual(ctx.earningsDates, {});
    assert.deepEqual(ctx.fomcDates, []);
    assert.equal(ctx.indexTrend, 'NEUTRAL');
});

test('MarketContext accepts custom config', () => {
    const ctx = new MarketContext({
        vix: 30,
        earningsDates: { AAPL: '2026-02-25' },
        fomcDates: ['2026-01-28'],
        indexTrend: 'BULLISH',
    });
    assert.equal(ctx.vix, 30);
    assert.equal(ctx.earningsDates.AAPL, '2026-02-25');
    assert.equal(ctx.fomcDates.length, 1);
    assert.equal(ctx.indexTrend, 'BULLISH');
});

test('getRegime returns NORMAL for VIX 20', () => {
    const ctx = new MarketContext({ vix: 20 });
    const regime = ctx.getRegime();
    assert.equal(regime.name, 'NORMAL');
});

test('getRegime returns LOW for VIX 15', () => {
    const ctx = new MarketContext({ vix: 15 });
    assert.equal(ctx.getRegime().name, 'LOW');
});

test('getRegime returns HIGH for VIX 30', () => {
    const ctx = new MarketContext({ vix: 30 });
    assert.equal(ctx.getRegime().name, 'HIGH');
});

test('getRegime returns EXTREME for VIX 40', () => {
    const ctx = new MarketContext({ vix: 40 });
    assert.equal(ctx.getRegime().name, 'EXTREME');
});

test('getRegime returns EXTREME_LOW for VIX 10', () => {
    const ctx = new MarketContext({ vix: 10 });
    assert.equal(ctx.getRegime().name, 'EXTREME_LOW');
});

test('shouldSkip returns true on FOMC day', () => {
    const ctx = new MarketContext({ fomcDates: ['2026-01-28', '2026-03-18'] });
    const result = ctx.shouldSkip('AAPL', '2026-01-28');
    assert.equal(result.skip, true);
    assert.equal(result.reason, 'FOMC_DAY');
});

test('shouldSkip returns false on non-FOMC day', () => {
    const ctx = new MarketContext({ fomcDates: ['2026-01-28'] });
    const result = ctx.shouldSkip('AAPL', '2026-02-10');
    assert.equal(result.skip, false);
});

test('shouldSkip returns true before earnings', () => {
    const ctx = new MarketContext({
        earningsDates: { AAPL: '2026-02-25' },
        earningsSkipDays: 2,
    });
    const result = ctx.shouldSkip('AAPL', '2026-02-23');
    assert.equal(result.skip, true);
    assert.equal(result.reason, 'EARNINGS_SOON');
    assert.equal(result.daysUntilEarnings, 2);
});

test('shouldSkip returns false far from earnings', () => {
    const ctx = new MarketContext({
        earningsDates: { AAPL: '2026-02-25' },
        earningsSkipDays: 2,
    });
    const result = ctx.shouldSkip('AAPL', '2026-02-10');
    assert.equal(result.skip, false);
});

test('shouldSkip checks only the specified symbol', () => {
    const ctx = new MarketContext({
        earningsDates: { AAPL: '2026-02-25' },
        earningsSkipDays: 2,
    });
    const result = ctx.shouldSkip('TSLA', '2026-02-23');
    assert.equal(result.skip, false);
});

test('adjustParams widens buffer in high VIX', () => {
    const ctx = new MarketContext({ vix: 30 }); // HIGH regime
    const result = ctx.adjustParams({ bufferPct: 0.0015 });
    // HIGH regime bufferMult = 1.5
    assert.equal(result.adjusted.bufferPct, 0.0015 * 1.5);
    assert.equal(result.regime, 'HIGH');
});

test('adjustParams tightens buffer in low VIX', () => {
    const ctx = new MarketContext({ vix: 15 }); // LOW regime
    const result = ctx.adjustParams({ bufferPct: 0.0015 });
    assert.equal(result.adjusted.bufferPct, 0.0015 * 0.85);
});

test('adjustParams increases reverse count in high VIX', () => {
    const ctx = new MarketContext({ vix: 30 }); // HIGH, reverseMult = 1.33
    const result = ctx.adjustParams({ reverseStopCount: 3 });
    assert.equal(result.adjusted.reverseStopCount, 4); // 3 * 1.33 = 3.99 → 4
});

test('adjustParams decreases reverse count in low VIX', () => {
    const ctx = new MarketContext({ vix: 10 }); // EXTREME_LOW, reverseMult = 0.67
    const result = ctx.adjustParams({ reverseStopCount: 3 });
    assert.equal(result.adjusted.reverseStopCount, 2); // 3 * 0.67 = 2.01 → 2
});

test('adjustParams reverse count never below 1', () => {
    const ctx = new MarketContext({ vix: 10 });
    const result = ctx.adjustParams({ reverseStopCount: 1 });
    assert.ok(result.adjusted.reverseStopCount >= 1);
});

test('summary returns context overview', () => {
    const ctx = new MarketContext({
        vix: 25,
        earningsDates: { AAPL: '2026-02-25', TSLA: '2026-03-01' },
        fomcDates: ['2026-01-28', '2026-03-18'],
        indexTrend: 'BULLISH',
    });
    const s = ctx.summary();
    assert.equal(s.vix, 25);
    assert.equal(s.regime, 'HIGH');
    assert.equal(s.indexTrend, 'BULLISH');
    assert.equal(s.fomcDates, 2);
    assert.equal(s.trackedEarnings, 2);
});

test('VOLATILITY_REGIMES has all 5 levels', () => {
    const keys = Object.keys(VOLATILITY_REGIMES);
    assert.ok(keys.includes('EXTREME_LOW'));
    assert.ok(keys.includes('LOW'));
    assert.ok(keys.includes('NORMAL'));
    assert.ok(keys.includes('HIGH'));
    assert.ok(keys.includes('EXTREME'));
});
