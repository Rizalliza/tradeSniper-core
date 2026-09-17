import test from 'node:test';
import assert from 'node:assert/strict';
import {
    LEVEL_INTERACTION_TYPES,
    LevelInteractionEngine,
} from '../../src/microstructure/LevelInteractionEngine.js';

test('LevelInteractionEngine classifies touch, cross, retest, and acceptance', () => {
    const engine = new LevelInteractionEngine({
        levels: [{ name: 'F2-M', value: 100 }],
        zonePct: 0.001,
        acceptBars: 2,
    });

    const events = [
        { time: '09:30:01', open: 99.5, high: 99.8, low: 99.3, close: 99.6 },
        { time: '09:30:05', open: 99.7, high: 100.25, low: 99.7, close: 100.2 },
        { time: '09:30:07', open: 100.2, high: 100.3, low: 100.02, close: 100.18 },
        { time: '09:30:11', open: 100.18, high: 100.5, low: 100.12, close: 100.4 },
    ].flatMap((bar, index) => engine.processBar(bar, index));

    assert(events.some(e => e.type === LEVEL_INTERACTION_TYPES.TOUCH));
    assert(events.some(e => e.type === LEVEL_INTERACTION_TYPES.CROSS_UP));
    assert(events.some(e => e.type === LEVEL_INTERACTION_TYPES.RETEST_FROM_ABOVE));
    assert(events.some(e => e.type === LEVEL_INTERACTION_TYPES.ACCEPT_ABOVE));
});

test('LevelInteractionEngine classifies rejection and reclaim around a zone', () => {
    const rejectEngine = new LevelInteractionEngine({
        levels: [{ name: 'F2-H', value: 100 }],
        zonePct: 0.001,
    });
    const rejectEvents = rejectEngine.processBar({
        time: '09:31:00',
        open: 100.2,
        high: 100.4,
        low: 99.7,
        close: 99.8,
    }, 0);

    assert(rejectEvents.some(e => e.type === LEVEL_INTERACTION_TYPES.REJECT_DOWN));

    const reclaimEngine = new LevelInteractionEngine({
        levels: [{ name: 'F2-L', value: 100 }],
        zonePct: 0.001,
    });
    const reclaimEvents = reclaimEngine.processBar({
        time: '09:31:05',
        open: 99.8,
        high: 100.3,
        low: 99.6,
        close: 100.2,
    }, 0);

    assert(reclaimEvents.some(e => e.type === LEVEL_INTERACTION_TYPES.RECLAIM_UP));
});
