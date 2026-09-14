import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SniperStrategy } from '../../src/strategies/SniperStrategy.js';
import { MarkerService } from '../../src/market/MarkerService.js';
import { BacktestRunner } from '../../src/backtest/BacktestRunner.js';
import { BacktestStats } from '../../src/backtest/BacktestStats.js';
import { BufferSensitivity } from '../../src/analysis/BufferSensitivity.js';
import { MarketContext } from '../../src/context/MarketContext.js';

const dailyBars = {
    TEST: [
        { date: '2026-01-26', o: 190, h: 195, l: 188, c: 192 },
        { date: '2026-01-27', o: 193, h: 200, l: 190, c: 198 },
        { date: '2026-01-28', o: 199, h: 205, l: 195, c: 202 },
        { date: '2026-01-29', o: 203, h: 210, l: 198, c: 208 },
        { date: '2026-01-30', o: 209, h: 215, l: 204, c: 212 },
        { date: '2026-02-02', o: 213, h: 220, l: 208, c: 218 },
        { date: '2026-02-03', o: 219, h: 225, l: 210, c: 215 },
    ],
};

function makeBars(dayDate, pattern) {
    const bars = [];
    let price = pattern.start;
    const time = (h, m, s = 0) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

    // Generate minute bars from 09:30 to 16:00
    for (let m = 0; m < 390; m++) {
        const minuteOfDay = m;
        const h = 9 + Math.floor((30 + m) / 60);
        const min = (30 + m) % 60;
        const t = time(h, min);

        // Apply pattern
        let spread = 0.5;
        if (minuteOfDay < 5) {
            // Cross down phase
            price -= 2;
        } else if (minuteOfDay < 10) {
            // Retest phase
            price += 0.8;
        } else if (minuteOfDay < 30) {
            // Drop to target
            price -= 1.5;
        } else if (minuteOfDay < 100) {
            // Oscillate
            price += (minuteOfDay % 2 === 0) ? 1 : -0.5;
        } else {
            // Gradual drift
            price += 0.1;
        }

        bars.push({
            symbol: 'TEST',
            date: dayDate,
            time: t,
            open: price - spread/2,
            high: price + spread,
            low: price - spread,
            close: price,
            volume: 10000 + m * 10,
        });
    }
    return bars;
}

test('full backtest runs end-to-end', () => {
    const bars = makeBars('2026-02-03', { start: 222 });
    const barsMap = { 'TEST|2026-02-03': bars };

    const runner = new BacktestRunner({
        symbols: ['TEST'],
        dailyBars,
        barsMap,
        shares: 100,
        strategyFactory: (config = {}) => new SniperStrategy(config),
    });

    const result = runner.run();
    assert.ok(result);
    assert.ok(result.stats);
    assert.ok(result.setups.length > 0);
    assert.equal(typeof result.stats.win_rate, 'number');
    assert.equal(typeof result.stats.net_pnl, 'number');
});

test('backtest produces equity curve', () => {
    const bars = makeBars('2026-02-03', { start: 222 });
    const barsMap = { 'TEST|2026-02-03': bars };

    const runner = new BacktestRunner({
        symbols: ['TEST'],
        dailyBars,
        barsMap,
        shares: 100,
        strategyFactory: (config = {}) => new SniperStrategy(config),
    });

    const result = runner.run();
    assert.ok(Array.isArray(result.equity));
});

test('backtest with market context adjusts parameters', () => {
    const bars = makeBars('2026-02-03', { start: 222 });
    const barsMap = { 'TEST|2026-02-03': bars };

    const ctx = new MarketContext({ vix: 35 }); // EXTREME regime
    const runner = new BacktestRunner({
        symbols: ['TEST'],
        dailyBars,
        barsMap,
        shares: 100,
        strategyFactory: (config = {}) => new SniperStrategy(config),
        marketContext: ctx,
    });

    const result = runner.run();
    assert.ok(result.setups.length > 0);
    // Should have context info
    assert.ok(result.setups[0].context_regime);
    assert.equal(result.setups[0].context_vix, 35);
});

test('backtest with FOMC day skips trading', () => {
    const bars = makeBars('2026-02-03', { start: 222 });
    const barsMap = { 'TEST|2026-02-03': bars };

    const ctx = new MarketContext({ fomcDates: ['2026-02-03'] });
    const runner = new BacktestRunner({
        symbols: ['TEST'],
        dailyBars,
        barsMap,
        shares: 100,
        strategyFactory: (config = {}) => new SniperStrategy(config),
        marketContext: ctx,
    });

    const result = runner.run();
    const daySetup = result.setups.find(s => s.date === '2026-02-03');
    assert.ok(daySetup);
    assert.ok(daySetup.exit_reason?.includes('FOMC'));
    assert.equal(daySetup.status, 'SKIPPED');
});

test('buffer sensitivity analysis integrated with strategy', () => {
    const markers = MarkerService.compute(dailyBars.TEST, 6);
    const markerList = MarkerService.buildList(markers);
    const bars = makeBars('2026-02-03', { start: 222 });

    const results = BufferSensitivity.analyze(bars, markerList, {
        buffers: [0.001, 0.0015, 0.002, 0.003],
    });

    assert.equal(results.length, 4);
    const optimal = BufferSensitivity.findOptimal(results);
    assert.ok(optimal);
});

test('BacktestStats integration with multi-day data', () => {
    const setups = [
        { symbol: 'TEST', date: '2026-02-02', status: 'WON', pnl: 500, exit_reason: 'MARKER_PROFIT' },
        { symbol: 'TEST', date: '2026-02-03', status: 'LOST', pnl: -200, exit_reason: 'REVERSE_STOP' },
    ];
    const stats = BacktestStats.compute(setups);
    assert.equal(stats.wins, 1);
    assert.equal(stats.losses, 1);
    assert.equal(stats.net_pnl, 300);
});

test('strategy reset between days is clean', () => {
    const markers = MarkerService.compute(dailyBars.TEST, 6);
    const markerList = MarkerService.buildList(markers);
    const strategy = new SniperStrategy();

    // Day 1
    strategy.reset(markerList, {});
    const bars1 = makeBars('2026-02-02', { start: 222 });
    for (const bar of bars1) strategy.evaluate(bar);
    strategy.finalize(bars1[bars1.length - 1]);

    const state1 = strategy.getState();
    assert.ok(state1.trades.length >= 0);

    // Day 2 - reset should clear everything
    strategy.reset(markerList, {});
    const state2 = strategy.getState();
    assert.equal(state2.phase, 'IDLE');
    assert.equal(state2.trades.length, 0);
    assert.equal(state2.crossMarker, null);
    assert.equal(state2.entryPrice, null);
});
