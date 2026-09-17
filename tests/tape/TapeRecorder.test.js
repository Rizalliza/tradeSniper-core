import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { TapeRecorder } from '../../src/tape/TapeRecorder.js';

test('TapeRecorder writes JSONL envelopes', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tradesniper-tape-'));
    const filePath = path.join(dir, 'aapl.jsonl');
    const recorder = new TapeRecorder({ filePath, source: 'test', session: '2026-09-15' });

    await recorder.record({
        type: 'TRADE',
        symbol: 'AAPL',
        date: '2026-09-15',
        time: '09:30:00',
        price: 331,
        size: 100,
    });

    const records = await TapeRecorder.read(filePath);
    assert.equal(records.length, 1);
    assert.equal(records[0].source, 'test');
    assert.equal(records[0].session, '2026-09-15');
    assert.equal(records[0].event.type, 'TRADE');
    assert.equal(records[0].event.symbol, 'AAPL');
});
