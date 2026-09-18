import test from 'node:test';
import assert from 'node:assert/strict';
import { replayOpeningSniperPaper } from '../../src/microstructure/OpeningSniperPaperTrader.js';

test('OpeningSniperPaperTrader enters on first-window cross and retest', () => {
    const result = replayOpeningSniperPaper({
        symbol: 'AAPL',
        date: '2026-09-15',
        first2Bars: [
            { time: '09:30:00', open: 100, high: 100.2, low: 99.8, close: 99.9 },
            { time: '09:30:02', open: 99.9, high: 100.5, low: 99.9, close: 100.4 },
            { time: '09:30:04', open: 100.4, high: 100.45, low: 100.1, close: 100.22 },
            { time: '09:30:06', open: 100.22, high: 100.3, low: 100.08, close: 100.25 },
        ],
        config: {
            zonePct: 0.001,
            scalpTargetPct: 0.002,
            hardStopPct: 0.002,
        },
    });

    assert.equal(result.trade.direction, 'BUY');
    assert.equal(result.trade.entryTime, '09:30:04');
    assert.equal(result.trade.crossLevel, 'F2-H');
    assert.equal(result.trade.exitReason, 'WINDOW_END_SCALP_EXIT');
    assert(result.events.some(event => event.type === 'PAPER_ENTRY'));
});

test('OpeningSniperPaperTrader exits at scalp target inside first two minutes', () => {
    const result = replayOpeningSniperPaper({
        symbol: 'AAPL',
        date: '2026-09-15',
        first2Bars: [
            { time: '09:30:00', open: 100, high: 100.2, low: 99.8, close: 99.9 },
            { time: '09:30:02', open: 99.9, high: 100.5, low: 99.9, close: 100.4 },
            { time: '09:30:04', open: 100.4, high: 100.45, low: 100.1, close: 100.22 },
            { time: '09:30:06', open: 100.22, high: 100.9, low: 100.16, close: 100.3 },
        ],
        config: {
            zonePct: 0.001,
            scalpTargetPct: 0.001,
            hardStopPct: 0.002,
            runnerTriggerPct: 0.005,
        },
    });

    assert.equal(result.trade.exitReason, 'SCALP_TARGET');
    assert.equal(result.trade.outcome, 'WON');
    assert.equal(result.trade.runner, false);
});

test('OpeningSniperPaperTrader can cancel an unconfirmed stop touch that recovers', () => {
    const result = replayOpeningSniperPaper({
        symbol: 'AAPL',
        date: '2026-09-15',
        first2Bars: [
            { time: '09:30:00', open: 100, high: 100.2, low: 99.8, close: 99.9 },
            { time: '09:30:02', open: 99.9, high: 100.5, low: 99.9, close: 100.4 },
            { time: '09:30:04', open: 100.4, high: 100.45, low: 100.1, close: 100.22 },
            { time: '09:30:06', open: 100.22, high: 100.25, low: 99.98, close: 100.2 },
            { time: '09:30:08', open: 100.2, high: 100.7, low: 100.18, close: 100.6 },
        ],
        config: {
            zonePct: 0.001,
            scalpTargetPct: 0.001,
            hardStopPct: 0.002,
            runnerTriggerPct: 0.005,
            exitConfirmMode: 'close-through',
        },
    });

    assert(result.events.some(event => event.type === 'EXIT_TOUCH'));
    assert(result.events.some(event => event.type === 'EXIT_TOUCH_CANCELLED'));
    assert.equal(result.trade.exitReason, 'SCALP_TARGET');
    assert.equal(result.trade.outcome, 'WON');
});

test('OpeningSniperPaperTrader confirms stop exit on adverse close through level', () => {
    const result = replayOpeningSniperPaper({
        symbol: 'AAPL',
        date: '2026-09-15',
        first2Bars: [
            { time: '09:30:00', open: 100, high: 100.2, low: 99.8, close: 99.9 },
            { time: '09:30:02', open: 99.9, high: 100.5, low: 99.9, close: 100.4 },
            { time: '09:30:04', open: 100.4, high: 100.45, low: 100.1, close: 100.22 },
            { time: '09:30:06', open: 100.22, high: 100.25, low: 99.98, close: 99.95 },
        ],
        config: {
            zonePct: 0.001,
            scalpTargetPct: 0.001,
            hardStopPct: 0.002,
            exitConfirmMode: 'close-through',
        },
    });

    assert.equal(result.trade.exitReason, 'HARD_STOP_CONFIRMED');
    assert.equal(result.trade.outcome, 'LOST');
    assert.equal(result.trade.exitConfirmation.mode, 'close-through');
});

test('OpeningSniperPaperTrader arms runner and manages continuation bars', () => {
    const result = replayOpeningSniperPaper({
        symbol: 'AAPL',
        date: '2026-09-15',
        first2Bars: [
            { time: '09:30:00', open: 100, high: 100.2, low: 99.8, close: 99.9 },
            { time: '09:30:02', open: 99.9, high: 100.5, low: 99.9, close: 100.4 },
            { time: '09:30:04', open: 100.4, high: 100.45, low: 100.1, close: 100.22 },
            { time: '09:30:06', open: 100.22, high: 100.9, low: 100.16, close: 100.75 },
        ],
        validationBars: [
            { time: '09:32:00', open: 100.75, high: 101.4, low: 100.7, close: 101.2 },
            { time: '09:33:00', open: 101.2, high: 101.3, low: 101.05, close: 101.1 },
        ],
        config: {
            zonePct: 0.001,
            scalpTargetPct: 0.001,
            hardStopPct: 0.002,
            runnerTriggerPct: 0.0015,
            runnerTrailPct: 0.001,
        },
    });

    assert.equal(result.trade.runner, true);
    assert(['RUNNER_TRAIL', 'RUNNER_HELD_TO_END'].includes(result.trade.exitReason));
    assert(result.events.some(event => event.type === 'SCALP_TARGET_RUNNER'));
});
