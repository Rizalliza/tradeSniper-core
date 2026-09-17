import { buildConfluenceZones } from './LevelConfluenceEngine.js';

export const LEVEL_INTERACTION_TYPES = Object.freeze({
    TOUCH: 'TOUCH',
    CROSS_UP: 'CROSS_UP',
    CROSS_DOWN: 'CROSS_DOWN',
    RETEST_FROM_ABOVE: 'RETEST_FROM_ABOVE',
    RETEST_FROM_BELOW: 'RETEST_FROM_BELOW',
    REJECT_DOWN: 'REJECT_DOWN',
    RECLAIM_UP: 'RECLAIM_UP',
    ACCEPT_ABOVE: 'ACCEPT_ABOVE',
    ACCEPT_BELOW: 'ACCEPT_BELOW',
});

export class LevelInteractionEngine {
    constructor({
        levels = [],
        zones = null,
        zonePct = 0.0015,
        acceptBars = 2,
    } = {}) {
        this.acceptBars = acceptBars;
        this.zones = zones || buildConfluenceZones(levels, { zonePct });
        this.state = new Map();
        for (const zone of this.zones) {
            this.state.set(zone.id, {
                previousRelation: null,
                aboveRun: 0,
                belowRun: 0,
                touched: false,
                acceptedAbove: false,
                acceptedBelow: false,
            });
        }
    }

    processBar(bar, index = 0) {
        const normalized = normalizeBar(bar);
        const events = [];

        for (const zone of this.zones) {
            const state = this.state.get(zone.id);
            const relation = relationToZone(normalized.close, zone);
            const hit = touchesZone(normalized, zone);

            state.aboveRun = relation === 'ABOVE' ? state.aboveRun + 1 : 0;
            state.belowRun = relation === 'BELOW' ? state.belowRun + 1 : 0;

            if (hit && !state.touched) {
                state.touched = true;
                events.push(makeEvent(zone, LEVEL_INTERACTION_TYPES.TOUCH, normalized, index, {
                    relation,
                    penetrationBps: penetrationBps(normalized, zone),
                }));
            }

            if (state.previousRelation === 'BELOW' && relation === 'ABOVE') {
                events.push(makeEvent(zone, LEVEL_INTERACTION_TYPES.CROSS_UP, normalized, index));
            }
            if (state.previousRelation === 'ABOVE' && relation === 'BELOW') {
                events.push(makeEvent(zone, LEVEL_INTERACTION_TYPES.CROSS_DOWN, normalized, index));
            }

            if (hit && state.previousRelation === 'ABOVE' && relation === 'ABOVE') {
                events.push(makeEvent(zone, LEVEL_INTERACTION_TYPES.RETEST_FROM_ABOVE, normalized, index));
            }
            if (hit && state.previousRelation === 'BELOW' && relation === 'BELOW') {
                events.push(makeEvent(zone, LEVEL_INTERACTION_TYPES.RETEST_FROM_BELOW, normalized, index));
            }

            if (hit && normalized.high > zone.high && normalized.close < zone.low) {
                events.push(makeEvent(zone, LEVEL_INTERACTION_TYPES.REJECT_DOWN, normalized, index));
            }
            if (hit && normalized.low < zone.low && normalized.close > zone.high) {
                events.push(makeEvent(zone, LEVEL_INTERACTION_TYPES.RECLAIM_UP, normalized, index));
            }

            if (!state.acceptedAbove && state.aboveRun >= this.acceptBars) {
                state.acceptedAbove = true;
                events.push(makeEvent(zone, LEVEL_INTERACTION_TYPES.ACCEPT_ABOVE, normalized, index, {
                    bars: state.aboveRun,
                }));
            }
            if (!state.acceptedBelow && state.belowRun >= this.acceptBars) {
                state.acceptedBelow = true;
                events.push(makeEvent(zone, LEVEL_INTERACTION_TYPES.ACCEPT_BELOW, normalized, index, {
                    bars: state.belowRun,
                }));
            }

            state.previousRelation = relation;
        }

        return events;
    }

    processBars(bars = []) {
        return bars.flatMap((bar, index) => this.processBar(bar, index));
    }
}

export function classifyLevelInteractions(bars, opts = {}) {
    return new LevelInteractionEngine(opts).processBars(bars);
}

function normalizeBar(bar = {}) {
    const normalized = {
        time: bar.time ?? null,
        open: Number(bar.open),
        high: Number(bar.high),
        low: Number(bar.low),
        close: Number(bar.close),
        volume: Number(bar.volume) || 0,
    };
    for (const field of ['open', 'high', 'low', 'close']) {
        if (!Number.isFinite(normalized[field])) {
            throw new Error(`LevelInteractionEngine bar requires finite ${field}`);
        }
    }
    return normalized;
}

function relationToZone(close, zone) {
    if (close > zone.high) return 'ABOVE';
    if (close < zone.low) return 'BELOW';
    return 'INSIDE';
}

function touchesZone(bar, zone) {
    return bar.high >= zone.low && bar.low <= zone.high;
}

function makeEvent(zone, type, bar, index, extra = {}) {
    return {
        type,
        zoneId: zone.id,
        level: zone.levels?.map(level => level.name).join('+') || zone.id,
        value: round(zone.center, 4),
        zoneLow: round(zone.low, 4),
        zoneHigh: round(zone.high, 4),
        confluence: zone.confluence,
        time: bar.time,
        index,
        close: round(bar.close, 4),
        high: round(bar.high, 4),
        low: round(bar.low, 4),
        ...extra,
    };
}

function penetrationBps(bar, zone) {
    const center = zone.center;
    if (!Number.isFinite(center) || center === 0) return 0;
    if (bar.high > zone.high) return round(((bar.high - center) / center) * 10000, 2);
    if (bar.low < zone.low) return round(((bar.low - center) / center) * 10000, 2);
    return 0;
}

function round(value, digits = 6) {
    return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}
