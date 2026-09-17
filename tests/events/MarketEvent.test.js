import test from 'node:test';
import assert from 'node:assert/strict';
import {
    compareMarketEvents,
    normalizeMarketEvent,
    normalizeMassiveMessage,
} from '../../src/events/MarketEvent.js';

test('normalizes trade events', () => {
    const event = normalizeMarketEvent({
        type: 'trade',
        symbol: 'aapl',
        date: '2026-09-15',
        time: '09:30:01',
        sipTs: 1000,
        sequence: 3,
        price: 331.25,
        size: 200,
    });

    assert.equal(event.type, 'TRADE');
    assert.equal(event.symbol, 'AAPL');
    assert.equal(event.date, '2026-09-15');
    assert.equal(event.time, '09:30:01');
    assert.equal(event.price, 331.25);
    assert.equal(event.size, 200);
});

test('normalizes quote events', () => {
    const event = normalizeMarketEvent({
        type: 'QUOTE',
        symbol: 'NVDA',
        bid: 178.1,
        bidSize: 400,
        ask: 178.12,
        askSize: 300,
    });

    assert.equal(event.type, 'QUOTE');
    assert.equal(event.bid, 178.1);
    assert.equal(event.ask, 178.12);
});

test('normalizes Massive trade and quote messages', () => {
    const trade = normalizeMassiveMessage({
        ev: 'T',
        sym: 'MSFT',
        t: 1000,
        q: 10,
        p: 512.34,
        s: 100,
        x: 4,
        c: [12],
    }, 1200);

    const quote = normalizeMassiveMessage({
        ev: 'Q',
        sym: 'MSFT',
        t: 1001,
        q: 11,
        bp: 512.33,
        bs: 200,
        ap: 512.35,
        as: 300,
    }, 1201);

    assert.equal(trade.type, 'TRADE');
    assert.equal(trade.receiveTs, 1200);
    assert.equal(trade.raw.ev, 'T');
    assert.equal(quote.type, 'QUOTE');
    assert.equal(quote.bid, 512.33);
    assert.equal(quote.ask, 512.35);
});

test('compareMarketEvents orders by timestamp then sequence', () => {
    const events = [
        normalizeMarketEvent({ type: 'TRADE', symbol: 'AAPL', sipTs: 1000, sequence: 2, price: 10, size: 1 }),
        normalizeMarketEvent({ type: 'QUOTE', symbol: 'AAPL', sipTs: 999, sequence: 9, bid: 9.99, ask: 10.01 }),
        normalizeMarketEvent({ type: 'TRADE', symbol: 'AAPL', sipTs: 1000, sequence: 1, price: 10.01, size: 1 }),
    ];

    events.sort(compareMarketEvents);
    assert.equal(events[0].type, 'QUOTE');
    assert.equal(events[1].sequence, 1);
    assert.equal(events[2].sequence, 2);
});
