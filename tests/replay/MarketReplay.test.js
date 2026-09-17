import test from 'node:test';
import assert from 'node:assert/strict';
import { MarketReplay } from '../../src/replay/MarketReplay.js';

test('MarketReplay feeds events through the same engine in order', async () => {
    const seen = [];
    const replay = new MarketReplay({
        engine: {
            process(event) {
                seen.push(`${event.type}:${event.sequence}`);
            },
        },
    });

    const result = await replay.replay([
        { type: 'TRADE', symbol: 'AAPL', sipTs: 1000, sequence: 2, price: 10.02, size: 1 },
        { type: 'TRADE', symbol: 'AAPL', sipTs: 1000, sequence: 1, price: 10.01, size: 1 },
    ]);

    assert.equal(result.count, 2);
    assert.deepEqual(seen, ['TRADE:1', 'TRADE:2']);
});
