import test from 'node:test';
import assert from 'node:assert/strict';
import { OpeningMicrostructureLiveState } from '../../src/microstructure/OpeningMicrostructureLiveState.js';

test('OpeningMicrostructureLiveState exposes provisional F2 map before 09:32', () => {
    const state = new OpeningMicrostructureLiveState({
        symbol: 'AAPL',
        session: '2026-09-15',
    });

    state.process({ type: 'TRADE', symbol: 'AAPL', date: '2026-09-15', time: '09:30:05', price: 100, size: 100 });
    state.process({ type: 'TRADE', symbol: 'AAPL', date: '2026-09-15', time: '09:30:11', price: 101, size: 200 });

    const snapshot = state.snapshot();
    assert.equal(snapshot.complete, true);
    assert.equal(snapshot.isFinal, false);
    assert.equal(snapshot.phase, 'FORMING');
    assert.equal(snapshot.f2.high, 101);
    assert.equal(snapshot.f2.low, 100);
    assert.equal(snapshot.f2.elapsedMs, 11000);
    assert.deepEqual(snapshot.f2.levels.map(level => level.name), ['F2-H', 'F2-M', 'F2-L']);
});

test('OpeningMicrostructureLiveState marks F2 final after the two-minute window', () => {
    const state = new OpeningMicrostructureLiveState({
        symbol: 'AAPL',
        session: '2026-09-15',
    });

    state.process({ type: 'TRADE', symbol: 'AAPL', date: '2026-09-15', time: '09:30:05', price: 100, size: 100 });
    state.process({ type: 'TRADE', symbol: 'AAPL', date: '2026-09-15', time: '09:31:59', price: 102, size: 100 });
    state.process({ type: 'QUOTE', symbol: 'AAPL', date: '2026-09-15', time: '09:32:00', bid: 102, ask: 102.01 });

    const snapshot = state.snapshot();
    assert.equal(snapshot.isFinal, true);
    assert.equal(snapshot.phase, 'FINAL');
    assert.equal(snapshot.f2.isFinal, true);
    assert.equal(snapshot.f2.elapsedMs, 120000);
});
