import test from 'node:test';
import assert from 'node:assert/strict';
import { replayOpeningSniperPaper } from '../../src/microstructure/OpeningSniperPaperTrader.js';

test('OpeningSniperPaperTrader flips false breakdown into buy retest watch', () => {
    const result = replayOpeningSniperPaper({
        symbol: 'MSFT',
        date: '2026-09-15',
        first2Bars: [
            { time: '09:30:00', open: 500.06, high: 500.95, low: 500, close: 500.01 },
            { time: '09:30:02', open: 500.205, high: 500.52, low: 499.1, close: 499.63 },
            { time: '09:30:04', open: 499.5, high: 500.32, low: 499.25, close: 500.1224 },
            { time: '09:30:06', open: 500.185, high: 500.86, low: 499.99, close: 500.83 },
            { time: '09:30:08', open: 500.85, high: 501.6, low: 500.85, close: 501.34 },
            { time: '09:30:10', open: 501.52, high: 502.2, low: 501.52, close: 502.165 },
            { time: '09:30:12', open: 502.24, high: 502.5, low: 502.04, close: 502.04 },
            { time: '09:30:14', open: 502.265, high: 502.265, low: 501.63, close: 501.7925 },
            { time: '09:30:16', open: 501.6401, high: 502.31, low: 501.6401, close: 502.105 },
        ],
        config: {
            zonePct: 0.0015,
            scalpTargetPct: 0.001,
            hardStopPct: 0.001,
        },
    });

    assert(result.events.some(event => event.type === 'RECLAIM_FLIP' && event.direction === 'BUY'));
    assert.equal(result.trade.direction, 'BUY');
    assert.equal(result.trade.entryTime, '09:30:14');
    assert.notEqual(result.trade.exitReason, 'HARD_STOP');
});
