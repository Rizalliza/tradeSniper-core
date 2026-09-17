import test from 'node:test';
import assert from 'node:assert/strict';
import { OpeningMicrostructureState } from '../../src/microstructure/OpeningMicrostructureState.js';

test('OpeningMicrostructureState computes F2 map from trade events', () => {
    const state = new OpeningMicrostructureState({
        symbol: 'AAPL',
        session: '2026-09-15',
    });

    const events = [
        { type: 'TRADE', symbol: 'AAPL', date: '2026-09-15', time: '09:29:59', price: 99, size: 100 },
        { type: 'TRADE', symbol: 'AAPL', date: '2026-09-15', time: '09:30:00', price: 100, size: 100 },
        { type: 'TRADE', symbol: 'AAPL', date: '2026-09-15', time: '09:30:20', price: 98, size: 200 },
        { type: 'TRADE', symbol: 'AAPL', date: '2026-09-15', time: '09:31:10', price: 103, size: 100 },
        { type: 'TRADE', symbol: 'AAPL', date: '2026-09-15', time: '09:32:00', price: 104, size: 100 },
    ];

    for (const event of events) state.process(event);
    const snapshot = state.snapshot();

    assert.equal(snapshot.complete, true);
    assert.equal(snapshot.f2.open, 100);
    assert.equal(snapshot.f2.close, 103);
    assert.equal(snapshot.f2.high, 103);
    assert.equal(snapshot.f2.low, 98);
    assert.equal(snapshot.f2.midpoint, 100.5);
    assert.equal(snapshot.f2.volume, 400);
    assert.equal(snapshot.f2.vwap, 99.75);
    assert.equal(snapshot.f2.highTime, '09:31:10');
    assert.equal(snapshot.f2.lowTime, '09:30:20');
    assert.equal(snapshot.f2.firstDirection, 'LOW_TO_HIGH');
    assert.equal(snapshot.f2.isFinal, true);
    assert.equal(snapshot.f2.elapsedMs, 120000);
});

test('OpeningMicrostructureState ignores other symbols and quote events', () => {
    const state = new OpeningMicrostructureState({
        symbol: 'NVDA',
        session: '2026-09-15',
    });

    state.process({ type: 'QUOTE', symbol: 'NVDA', date: '2026-09-15', time: '09:30:00', bid: 100, ask: 100.02 });
    state.process({ type: 'TRADE', symbol: 'AAPL', date: '2026-09-15', time: '09:30:00', price: 100, size: 1 });

    assert.equal(state.snapshot().complete, false);
});
