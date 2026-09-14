import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAILY_BARS, FEB_SENTIMENT, toBars } from '../../src/data/historicalData.js';

test('DAILY_BARS has AAPL, TSLA, NVDA', () => {
    assert.ok(DAILY_BARS.AAPL);
    assert.ok(DAILY_BARS.TSLA);
    assert.ok(DAILY_BARS.NVDA);
});

test('AAPL daily bars have correct structure', () => {
    const bars = DAILY_BARS.AAPL;
    assert.ok(bars.length > 0);
    for (const b of bars) {
        assert.ok(b.date);
        assert.equal(typeof b.o, 'number');
        assert.equal(typeof b.h, 'number');
        assert.equal(typeof b.l, 'number');
        assert.equal(typeof b.c, 'number');
        assert.ok(b.h >= b.l);
    }
});

test('daily bars are sorted by date', () => {
    const bars = DAILY_BARS.AAPL;
    for (let i = 1; i < bars.length; i++) {
        assert.ok(bars[i].date > bars[i-1].date);
    }
});

test('FEB_SENTIMENT has all 3 symbols', () => {
    assert.ok(FEB_SENTIMENT.AAPL);
    assert.ok(FEB_SENTIMENT.TSLA);
    assert.ok(FEB_SENTIMENT.NVDA);
    assert.equal(typeof FEB_SENTIMENT.AAPL.score, 'number');
    assert.equal(typeof FEB_SENTIMENT.AAPL.summary, 'string');
});

test('toBars returns bars for valid symbol', () => {
    const bars = toBars('AAPL');
    assert.equal(bars.length, DAILY_BARS.AAPL.length);
});

test('toBars returns empty array for unknown symbol', () => {
    const bars = toBars('UNKNOWN');
    assert.deepEqual(bars, []);
});
