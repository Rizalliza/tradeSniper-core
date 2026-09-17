import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConfluenceZones } from '../../src/microstructure/LevelConfluenceEngine.js';

test('LevelConfluenceEngine merges nearby levels into one zone', () => {
    const zones = buildConfluenceZones([
        { name: 'F2-M', value: 100.00, role: 'mid' },
        { name: 'PM-H', value: 100.08, role: 'premarket' },
        { name: 'D-H', value: 102.00, role: 'daily' },
    ], { zonePct: 0.0015 });

    assert.equal(zones.length, 2);
    assert.equal(zones[0].id, 'F2-M+PM-H');
    assert.equal(zones[0].confluence, 2);
    assert.deepEqual(zones[0].roles, ['mid', 'premarket']);
    assert.equal(zones[1].id, 'Z2');
});

test('LevelConfluenceEngine keeps separated levels distinct', () => {
    const zones = buildConfluenceZones([
        { name: 'F2-H', value: 101.00 },
        { name: 'F2-L', value: 99.00 },
    ], { zonePct: 0.001 });

    assert.equal(zones.length, 2);
    assert.equal(zones[0].levels[0].name, 'F2-L');
    assert.equal(zones[1].levels[0].name, 'F2-H');
});
