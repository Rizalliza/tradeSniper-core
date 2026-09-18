import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SniperStrategy } from '../../src/strategies/SniperStrategy.js';
import { MarkerService } from '../../src/market/MarkerService.js';

// Helper: create simple marker list
function makeMarkers() {
    return [
        { name: 'weekly_high', value: 180, type: 'resistance', tier: 'weekly' },
        { name: 'daily_high', value: 160, type: 'resistance', tier: 'daily' },
        { name: 'prior_day_close', value: 150, type: 'neutral', tier: 'daily' },
        { name: 'prior_day_open', value: 145, type: 'neutral', tier: 'daily' },
        { name: 'daily_low', value: 130, type: 'support', tier: 'daily' },
        { name: 'weekly_low', value: 110, type: 'support', tier: 'weekly' },
    ];
}

function makeBar(time, price, spread = 0.1) {
    return { time, open: price, high: price + spread, low: price - spread, close: price };
}

test('SniperStrategy initializes with correct defaults', () => {
    const s = new SniperStrategy();
    assert.equal(s.bufferPct, 0.0015);
    assert.equal(s.windowStart, '09:30:00');
    assert.equal(s.windowEnd, '09:45:00');
    assert.equal(s.reverseStopCount, 3);
    assert.equal(s.trailingStop, true);
});

test('SniperStrategy accepts custom config', () => {
    const s = new SniperStrategy({ bufferPct: 0.005, reverseStopCount: 2 });
    assert.equal(s.bufferPct, 0.005);
    assert.equal(s.reverseStopCount, 2);
});

test('reset clears all state', () => {
    const s = new SniperStrategy();
    const markers = makeMarkers();
    s.reset(markers, {});
    assert.equal(s.phase, 'IDLE');
    assert.equal(s.crossMarker, null);
    assert.equal(s.entryPrice, null);
    assert.deepEqual(s.trades, []);
    assert.deepEqual(s.reverseCrossings, []);
});

// ---- Cross detection ----

test('detects cross DOWN through a marker', () => {
    const s = new SniperStrategy();
    s.reset(makeMarkers(), {});
    // First bar sets prev at 170 (between daily_high 160 and weekly_high 180)
    s.evaluate(makeBar('09:30:00', 170, 1));
    // Second bar drops through daily_high (160)
    s.evaluate(makeBar('09:30:01', 155, 1));
    const state = s.getState();
    assert.equal(state.phase, 'CROSSED');
    assert.equal(state.crossMarker, 'daily_high');
    assert.equal(state.crossDir, 'DOWN');
});

test('detects cross UP through a marker', () => {
    const s = new SniperStrategy();
    s.reset(makeMarkers(), {});
    s.evaluate(makeBar('09:30:00', 140, 1));
    s.evaluate(makeBar('09:30:01', 155, 1)); // crosses prior_day_close (150)
    const state = s.getState();
    assert.equal(state.phase, 'CROSSED');
    assert.equal(state.crossMarker, 'prior_day_close');
    assert.equal(state.crossDir, 'UP');
});

test('no cross outside entry window', () => {
    const s = new SniperStrategy();
    s.reset(makeMarkers(), {});
    s.evaluate(makeBar('09:20:00', 170, 1));
    s.evaluate(makeBar('09:20:01', 155, 1));
    assert.equal(s.getState().phase, 'IDLE');
});

test('no cross on first bar (need prev bar)', () => {
    const s = new SniperStrategy();
    s.reset(makeMarkers(), {});
    s.evaluate(makeBar('09:30:00', 155, 1));
    assert.equal(s.getState().phase, 'IDLE');
});

// ---- Retest / entry ----

test('SELL entry: cross down then retest to marker', () => {
    const s = new SniperStrategy();
    s.reset(makeMarkers(), {});
    // Start above daily_high (160)
    s.evaluate(makeBar('09:30:00', 170, 0.5));
    // Cross down through 160
    s.evaluate(makeBar('09:30:01', 158, 0.5));
    assert.equal(s.getState().phase, 'CROSSED');
    // Retest: price goes back up to 159.9 (within buffer of 160)
    // buffer = 160 * 0.0015 = 0.24. So retest needs high >= 159.76
    s.evaluate(makeBar('09:30:02', 159.8, 0.3)); // high = 160.1
    const state = s.getState();
    assert.equal(state.phase, 'IN_TRADE');
    assert.equal(state.entryDir, 'SELL');
    assert.equal(state.entryPrice, 160);
    assert.equal(state.entryMarker, 'daily_high');
});

test('BUY entry: cross up then retest to marker', () => {
    const s = new SniperStrategy();
    s.reset(makeMarkers(), {});
    s.evaluate(makeBar('09:30:00', 140, 0.5));
    s.evaluate(makeBar('09:30:01', 155, 0.5)); // crosses 150 up
    assert.equal(s.getState().phase, 'CROSSED');
    // Retest: price drops back to 150.1 (within buffer)
    s.evaluate(makeBar('09:30:02', 150.2, 0.3)); // low = 149.9
    const state = s.getState();
    assert.equal(state.phase, 'IN_TRADE');
    assert.equal(state.entryDir, 'BUY');
    assert.equal(state.entryPrice, 150);
    assert.equal(state.entryMarker, 'prior_day_close');
});

test('no retest if price is too far from marker', () => {
    const s = new SniperStrategy({ bufferPct: 0.001 }); // tighter buffer
    s.reset(makeMarkers(), {});
    s.evaluate(makeBar('09:30:00', 170, 0.5));
    s.evaluate(makeBar('09:30:01', 158, 0.5));
    // Retest only to 159 (1% away = 1 point, buffer = 0.16) → should not enter
    s.evaluate(makeBar('09:30:02', 159, 0.1)); // high = 159.1, need >= 159.84
    assert.equal(s.getState().phase, 'CROSSED');
});

test('contextual filter blocks counter-bias BUY into nearby resistance', () => {
    const s = new SniperStrategy({ contextualEntryFilter: true, opposingLevelMaxPct: 0.004 });
    s.reset(makeMarkers(), {
        pressure: { label: 'BEARISH' },
        flowLevels: [
            { name: 'first2_high', value: 150.35, type: 'flow', tier: 'opening' },
        ],
    });
    s.evaluate(makeBar('09:30:00', 140, 0.5));
    s.evaluate(makeBar('09:30:01', 155, 0.5)); // crosses 150 up
    s.evaluate(makeBar('09:30:02', 150.2, 0.3)); // would normally BUY

    const state = s.getState();
    assert.equal(state.phase, 'BLOCKED');
    assert.equal(state.trades.length, 0);
    assert.equal(state.blockedSignal.reason, 'COUNTER_BIAS_NEAR_OPPOSING_LEVEL');
    assert.equal(state.blockedSignal.direction, 'BUY');
    assert.equal(state.blockedSignal.opposingLevel.name, 'first2_high');
});

test('contextual filter does not block aligned BUY', () => {
    const s = new SniperStrategy({ contextualEntryFilter: true, opposingLevelMaxPct: 0.004 });
    s.reset(makeMarkers(), {
        pressure: { label: 'BULLISH' },
        flowLevels: [
            { name: 'first2_high', value: 150.35, type: 'flow', tier: 'opening' },
        ],
    });
    s.evaluate(makeBar('09:30:00', 140, 0.5));
    s.evaluate(makeBar('09:30:01', 155, 0.5));
    s.evaluate(makeBar('09:30:02', 150.2, 0.3));

    const state = s.getState();
    assert.equal(state.phase, 'IN_TRADE');
    assert.equal(state.entryDir, 'BUY');
});

test('profit target hit on SELL trade', () => {
    const s = new SniperStrategy();
    s.reset(makeMarkers(), {});
    s.evaluate(makeBar('09:30:00', 170, 0.5));
    s.evaluate(makeBar('09:30:01', 158, 0.5)); // cross daily_high (160) down
    s.evaluate(makeBar('09:30:02', 159.8, 0.3)); // retest → SELL entry at 160
    // Now drop through prior_day_close (150) = profit target
    // next marker down from daily_high = prior_day_close at 150
    s.evaluate(makeBar('09:30:03', 148, 1));
    const state = s.getState();
    assert.equal(state.phase, 'CLOSED');
    assert.equal(state.trades.length, 1);
    assert.equal(state.trades[0].exitReason, 'MARKER_PROFIT');
    assert.equal(state.trades[0].outcome, 'WON');
    assert.equal(state.trades[0].exitPrice, 150);
});

test('profit target hit on BUY trade', () => {
    const s = new SniperStrategy();
    s.reset(makeMarkers(), {});
    s.evaluate(makeBar('09:30:00', 140, 0.5));
    s.evaluate(makeBar('09:30:01', 155, 0.5)); // cross prior_day_close (150) up
    s.evaluate(makeBar('09:30:02', 150.2, 0.3)); // retest → BUY at 150
    // Go up to daily_high (160) = target
    s.evaluate(makeBar('09:30:03', 162, 1));
    const state = s.getState();
    assert.equal(state.phase, 'CLOSED');
    assert.equal(state.trades[0].exitReason, 'MARKER_PROFIT');
    assert.equal(state.trades[0].outcome, 'WON');
});

test('confirmed hard stop can cancel wick touch that recovers', () => {
    const s = new SniperStrategy({ exitConfirmMode: 'close-through', hardStopPct: 0.01 });
    s.reset(makeMarkers(), {});
    s.evaluate(makeBar('09:30:00', 140, 0.5));
    s.evaluate(makeBar('09:30:01', 155, 0.5));
    s.evaluate(makeBar('09:30:02', 150.2, 0.3)); // BUY at 150

    s.evaluate({ time: '09:30:03', open: 150, high: 151, low: 148.4, close: 149.1 });
    assert.equal(s.getState().phase, 'IN_TRADE');
    assert.equal(s.getState().pendingExit.reason, 'HARD_STOP');

    s.evaluate({ time: '09:30:04', open: 149.2, high: 151, low: 149, close: 150.5 });
    assert.equal(s.getState().pendingExit, null);

    s.evaluate(makeBar('09:30:05', 162, 1));
    const state = s.getState();
    assert.equal(state.phase, 'CLOSED');
    assert.equal(state.trades[0].exitReason, 'MARKER_PROFIT');
    assert.equal(state.trades[0].outcome, 'WON');
});

test('confirmed hard stop exits after adverse close through stop', () => {
    const s = new SniperStrategy({ exitConfirmMode: 'close-through', hardStopPct: 0.01 });
    s.reset(makeMarkers(), {});
    s.evaluate(makeBar('09:30:00', 140, 0.5));
    s.evaluate(makeBar('09:30:01', 155, 0.5));
    s.evaluate(makeBar('09:30:02', 150.2, 0.3)); // BUY at 150

    s.evaluate({ time: '09:30:03', open: 150, high: 150.5, low: 148.4, close: 148.2 });
    const state = s.getState();
    assert.equal(state.phase, 'CLOSED');
    assert.equal(state.trades[0].exitReason, 'HARD_STOP_CONFIRMED');
    assert.equal(state.trades[0].outcome, 'LOST');
    assert.equal(state.trades[0].exitConfirmation.mode, 'close-through');
});

test('breakeven trigger protects a proven trade', () => {
    const s = new SniperStrategy({ breakevenAfterPct: 0.003, hardStopPct: 0 });
    s.reset(makeMarkers(), {});
    s.evaluate(makeBar('09:30:00', 140, 0.5));
    s.evaluate(makeBar('09:30:01', 155, 0.5));
    s.evaluate(makeBar('09:30:02', 150.2, 0.3)); // BUY at 150

    s.evaluate({ time: '09:30:03', open: 150.2, high: 151, low: 150.1, close: 150.8 });
    assert.equal(s.getState().trailingActive, true);
    assert.equal(s.getState().trailingLevel, 150);

    s.evaluate({ time: '09:30:04', open: 150.5, high: 150.6, low: 149.9, close: 150.1 });
    const state = s.getState();
    assert.equal(state.phase, 'CLOSED');
    assert.equal(state.trades[0].exitReason, 'TRAILING_STOP');
    assert.equal(state.trades[0].outcome, 'BREAKEVEN');
});

test('reverse stop after N crossings', () => {
    const s = new SniperStrategy({ reverseStopCount: 3, trailingStop: false });
    s.reset(makeMarkers(), {});
    s.evaluate(makeBar('09:30:00', 170, 0.5));
    s.evaluate(makeBar('09:30:01', 158, 0.5)); // cross down 160
    s.evaluate(makeBar('09:30:02', 159.8, 0.3)); // SELL at 160
    // Create 3 reverse crossings by oscillating around 160
    let t = 3;
    for (let i = 0; i < 3; i++) {
        s.evaluate(makeBar(`09:30:${String(t++).padStart(2, '0')}`, 159.5, 0.3)); // below
        s.evaluate(makeBar(`09:30:${String(t++).padStart(2, '0')}`, 160.5, 0.3)); // crosses up → reverse
    }
    const state = s.getState();
    assert.equal(state.phase, 'CLOSED');
    assert.equal(state.trades[0].exitReason, 'REVERSE_STOP');
    assert.equal(state.trades[0].outcome, 'BREAKEVEN');
});

test('trailing stop: 2nd reverse with profitable close activates trailing', () => {
    const s = new SniperStrategy({ reverseStopCount: 2, trailingStop: true, trailingStepPct: 0.005 });
    s.reset(makeMarkers(), {});
    s.evaluate(makeBar('09:30:00', 170, 0.5));
    s.evaluate(makeBar('09:30:01', 158, 0.5)); // cross down 160
    s.evaluate(makeBar('09:30:02', 159.8, 0.3)); // SELL at 160

    // 1st reverse
    s.evaluate(makeBar('09:30:03', 159.5, 0.3)); // below
    s.evaluate(makeBar('09:30:04', 160.2, 0.3)); // high=160.5 → 1st reverse
    assert.equal(s.getState().reverseCrossings.length, 1);

    // Back down
    s.evaluate(makeBar('09:30:05', 159.5, 0.3));

    // 2nd reverse: close stays below 160 (profitable for SELL), high crosses 160
    s.evaluate(makeBar('09:30:06', 159.8, 0.3)); // high=160.1, close=159.8
    const state = s.getState();
    assert.equal(state.reverseCrossings.length, 2);
    assert.equal(state.trailingActive, true);
    assert.equal(state.trailingLevel, 160); // at entry, no forward crosses yet
});

test('EOD finalize: RUNNER for profitable open trade', () => {
    const s = new SniperStrategy();
    s.reset(makeMarkers(), {});
    s.evaluate(makeBar('09:30:00', 170, 0.5));
    s.evaluate(makeBar('09:30:01', 158, 0.5));
    s.evaluate(makeBar('09:30:02', 159.8, 0.3)); // SELL at 160
    // Trade is open, price is 155 (in profit for SELL)
    const lastBar = makeBar('16:00:00', 155, 0.5);
    s.finalize(lastBar);
    const state = s.getState();
    assert.equal(state.phase, 'CLOSED');
    assert.equal(state.trades[0].exitReason, 'RUNNER');
    assert.equal(state.trades[0].outcome, 'WON');
});

test('EOD finalize: EOD_UNFAVORABLE for losing open trade', () => {
    const s = new SniperStrategy({ hardStopPct: 0 });
    s.reset(makeMarkers(), {});
    s.evaluate(makeBar('09:30:00', 170, 0.5));
    s.evaluate(makeBar('09:30:01', 158, 0.5));
    s.evaluate(makeBar('09:30:02', 159.8, 0.3)); // SELL at 160
    // Price moved up (loss for SELL)
    const lastBar = makeBar('16:00:00', 165, 0.5);
    s.finalize(lastBar);
    const state = s.getState();
    assert.equal(state.trades[0].exitReason, 'EOD_UNFAVORABLE');
    assert.equal(state.trades[0].outcome, 'LOST');
});

test('finalize NO_RETEST when cross but no entry', () => {
    const s = new SniperStrategy();
    s.reset(makeMarkers(), {});
    s.evaluate(makeBar('09:30:00', 170, 0.5));
    s.evaluate(makeBar('09:30:01', 158, 0.5)); // cross but no retest
    s.finalize(makeBar('16:00:00', 155, 0.5));
    assert.equal(s.getState().phase, 'NO_RETEST');
});

test('finalize NO_CROSS when no cross at all', () => {
    const s = new SniperStrategy();
    s.reset(makeMarkers(), {});
    s.evaluate(makeBar('09:30:00', 170, 0.5));
    s.evaluate(makeBar('09:30:01', 171, 0.5));
    s.finalize(makeBar('16:00:00', 170, 0.5));
    assert.equal(s.getState().phase, 'NO_CROSS');
});

test('tracks best price during trade', () => {
    const s = new SniperStrategy();
    s.reset(makeMarkers(), {});
    s.evaluate(makeBar('09:30:00', 170, 0.5));
    s.evaluate(makeBar('09:30:01', 158, 0.5));
    s.evaluate(makeBar('09:30:02', 159.8, 0.3)); // SELL at 160
    s.evaluate(makeBar('09:30:03', 155, 0.5)); // low 154.5 = best so far
    s.evaluate(makeBar('09:30:04', 157, 0.5)); // price goes up (worse)
    const state = s.getState();
    // For SELL, best price = lowest low = 154.5
    assert.equal(s.bestPrice, 154.5);
});
