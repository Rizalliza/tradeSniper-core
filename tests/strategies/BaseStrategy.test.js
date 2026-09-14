import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BaseStrategy } from '../../src/strategies/BaseStrategy.js';

test('BaseStrategy initializes with IDLE phase', () => {
    const s = new BaseStrategy();
    assert.equal(s.phase, 'IDLE');
    assert.deepEqual(s.trades, []);
});

test('BaseStrategy constructor accepts config', () => {
    const s = new BaseStrategy({ foo: 'bar' });
    assert.equal(s.config.foo, 'bar');
});

test('BaseStrategy.reset clears state', () => {
    const s = new BaseStrategy();
    s.phase = 'IN_TRADE';
    s.trades = [{ pnl: 100 }];
    s.reset([], {});
    assert.equal(s.phase, 'IDLE');
    assert.deepEqual(s.trades, []);
    assert.deepEqual(s.markers, []);
});

test('BaseStrategy.evaluate throws for base class', () => {
    const s = new BaseStrategy();
    assert.throws(() => s.evaluate({}), /Subclasses must implement/);
});

test('BaseStrategy.finalize returns state', () => {
    const s = new BaseStrategy();
    const state = s.finalize({});
    assert.equal(state.phase, 'IDLE');
    assert.deepEqual(state.trades, []);
});

test('BaseStrategy.getState returns copy of trades', () => {
    const s = new BaseStrategy();
    const state1 = s.getState();
    state1.trades.push({ fake: true });
    const state2 = s.getState();
    assert.equal(state2.trades.length, 0);
});
