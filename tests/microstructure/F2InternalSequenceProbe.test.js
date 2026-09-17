import test from 'node:test';
import assert from 'node:assert/strict';
import {
    F2_INTERNAL_EVENT_TYPES,
    analyzeF2InternalSequence,
} from '../../src/microstructure/F2InternalSequenceProbe.js';

test('F2InternalSequenceProbe detects early cross, retest, accept, and runner', () => {
    const result = analyzeF2InternalSequence([
        { time: '09:30:00', open: 100.0, high: 100.2, low: 99.8, close: 99.9 },
        { time: '09:30:02', open: 99.9, high: 100.5, low: 99.9, close: 100.4 },
        { time: '09:30:04', open: 100.4, high: 100.55, low: 100.12, close: 100.45 },
        { time: '09:30:06', open: 100.45, high: 100.8, low: 100.4, close: 100.7 },
    ], {
        zonePct: 0.001,
        acceptBars: 2,
        runnerBars: 2,
    });

    const types = result.events.map(event => event.type);
    assert(types.includes(F2_INTERNAL_EVENT_TYPES.TOUCH));
    assert(types.includes(F2_INTERNAL_EVENT_TYPES.RECLAIM_UP));
    assert(types.includes(F2_INTERNAL_EVENT_TYPES.EXPAND_HIGH));
    assert(types.includes(F2_INTERNAL_EVENT_TYPES.ACCEPT_ABOVE));
    assert(types.includes(F2_INTERNAL_EVENT_TYPES.RUNNER_UP));
    assert.equal(result.final.high, 100.8);
    assert.equal(result.final.low, 99.8);
});

test('F2InternalSequenceProbe detects downside runner', () => {
    const result = analyzeF2InternalSequence([
        { time: '09:30:00', open: 100.0, high: 100.2, low: 99.8, close: 100.1 },
        { time: '09:30:02', open: 100.1, high: 100.1, low: 99.5, close: 99.6 },
        { time: '09:30:04', open: 99.6, high: 99.65, low: 99.2, close: 99.3 },
    ], {
        zonePct: 0.001,
        runnerBars: 2,
    });

    assert(result.events.some(event => event.type === F2_INTERNAL_EVENT_TYPES.EXPAND_LOW));
    assert(result.events.some(event => event.type === F2_INTERNAL_EVENT_TYPES.RUNNER_DOWN));
    assert.equal(result.summary.runner, F2_INTERNAL_EVENT_TYPES.RUNNER_DOWN);
});
