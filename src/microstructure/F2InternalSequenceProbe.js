export const F2_INTERNAL_EVENT_TYPES = Object.freeze({
    TOUCH: 'TOUCH',
    CROSS_UP: 'CROSS_UP',
    CROSS_DOWN: 'CROSS_DOWN',
    RETEST_FROM_ABOVE: 'RETEST_FROM_ABOVE',
    RETEST_FROM_BELOW: 'RETEST_FROM_BELOW',
    REJECT_DOWN: 'REJECT_DOWN',
    RECLAIM_UP: 'RECLAIM_UP',
    ACCEPT_ABOVE: 'ACCEPT_ABOVE',
    ACCEPT_BELOW: 'ACCEPT_BELOW',
    EXPAND_HIGH: 'EXPAND_HIGH',
    EXPAND_LOW: 'EXPAND_LOW',
    RUNNER_UP: 'RUNNER_UP',
    RUNNER_DOWN: 'RUNNER_DOWN',
});

export class F2InternalSequenceProbe {
    constructor({
        zonePct = 0.0015,
        acceptBars = 2,
        runnerBars = 2,
    } = {}) {
        this.zonePct = zonePct;
        this.acceptBars = acceptBars;
        this.runnerBars = runnerBars;
    }

    analyzeBars(bars = []) {
        const cleanBars = bars.map(normalizeBar).sort((a, b) => a.time.localeCompare(b.time));
        const events = [];
        const levelState = new Map();
        let high = null;
        let low = null;
        let highTime = null;
        let lowTime = null;
        let runnerUpRun = 0;
        let runnerDownRun = 0;
        let runnerUpMarked = false;
        let runnerDownMarked = false;

        for (let index = 0; index < cleanBars.length; index++) {
            const bar = cleanBars[index];
            if (high == null || low == null) {
                high = bar.high;
                low = bar.low;
                highTime = bar.time;
                lowTime = bar.time;
                continue;
            }

            const priorHigh = high;
            const priorLow = low;
            const priorMid = (priorHigh + priorLow) / 2;
            const levels = [
                { name: 'F2-H', value: priorHigh, role: 'upper' },
                { name: 'F2-M', value: priorMid, role: 'mid' },
                { name: 'F2-L', value: priorLow, role: 'lower' },
            ];

            for (const level of levels) {
                events.push(...this._levelEvents(level, bar, index, levelState));
            }

            const highZone = priorHigh * this.zonePct;
            const lowZone = priorLow * this.zonePct;
            if (bar.high > priorHigh + highZone) {
                events.push(makeEvent(F2_INTERNAL_EVENT_TYPES.EXPAND_HIGH, 'F2-H', priorHigh, bar, index, {
                    newHigh: round(bar.high),
                    previousHighTime: highTime,
                }));
            }
            if (bar.low < priorLow - lowZone) {
                events.push(makeEvent(F2_INTERNAL_EVENT_TYPES.EXPAND_LOW, 'F2-L', priorLow, bar, index, {
                    newLow: round(bar.low),
                    previousLowTime: lowTime,
                }));
            }

            const upsidePressure = bar.high > priorHigh && bar.close > priorMid;
            const downsidePressure = bar.low < priorLow && bar.close < priorMid;
            runnerUpRun = upsidePressure ? runnerUpRun + 1 : 0;
            runnerDownRun = downsidePressure ? runnerDownRun + 1 : 0;
            if (!runnerUpMarked && runnerUpRun >= this.runnerBars) {
                runnerUpMarked = true;
                events.push(makeEvent(F2_INTERNAL_EVENT_TYPES.RUNNER_UP, 'F2-H', priorHigh, bar, index, {
                    bars: runnerUpRun,
                }));
            }
            if (!runnerDownMarked && runnerDownRun >= this.runnerBars) {
                runnerDownMarked = true;
                events.push(makeEvent(F2_INTERNAL_EVENT_TYPES.RUNNER_DOWN, 'F2-L', priorLow, bar, index, {
                    bars: runnerDownRun,
                }));
            }

            if (bar.high > high) {
                high = bar.high;
                highTime = bar.time;
            }
            if (bar.low < low) {
                low = bar.low;
                lowTime = bar.time;
            }
        }

        return {
            barCount: cleanBars.length,
            firstTime: cleanBars[0]?.time || null,
            lastTime: cleanBars.at(-1)?.time || null,
            final: high == null ? null : {
                high: round(high),
                low: round(low),
                midpoint: round((high + low) / 2),
                highTime,
                lowTime,
            },
            events,
            summary: summarize(events),
        };
    }

    _levelEvents(level, bar, index, levelState) {
        const state = levelState.get(level.name) || {
            previousRelation: null,
            aboveRun: 0,
            belowRun: 0,
            touched: false,
            acceptedAbove: false,
            acceptedBelow: false,
        };
        const zone = Math.abs(level.value) * this.zonePct;
        const zoneLow = level.value - zone;
        const zoneHigh = level.value + zone;
        const relation = relationToZone(bar.close, zoneLow, zoneHigh);
        const hit = bar.high >= zoneLow && bar.low <= zoneHigh;
        const events = [];

        state.aboveRun = relation === 'ABOVE' ? state.aboveRun + 1 : 0;
        state.belowRun = relation === 'BELOW' ? state.belowRun + 1 : 0;

        if (hit && !state.touched) {
            state.touched = true;
            events.push(makeEvent(F2_INTERNAL_EVENT_TYPES.TOUCH, level.name, level.value, bar, index, { relation }));
        }
        if (state.previousRelation === 'BELOW' && relation === 'ABOVE') {
            events.push(makeEvent(F2_INTERNAL_EVENT_TYPES.CROSS_UP, level.name, level.value, bar, index));
        }
        if (state.previousRelation === 'ABOVE' && relation === 'BELOW') {
            events.push(makeEvent(F2_INTERNAL_EVENT_TYPES.CROSS_DOWN, level.name, level.value, bar, index));
        }
        if (hit && state.previousRelation === 'ABOVE' && relation === 'ABOVE') {
            events.push(makeEvent(F2_INTERNAL_EVENT_TYPES.RETEST_FROM_ABOVE, level.name, level.value, bar, index));
        }
        if (hit && state.previousRelation === 'BELOW' && relation === 'BELOW') {
            events.push(makeEvent(F2_INTERNAL_EVENT_TYPES.RETEST_FROM_BELOW, level.name, level.value, bar, index));
        }
        if (hit && bar.high > zoneHigh && bar.close < zoneLow) {
            events.push(makeEvent(F2_INTERNAL_EVENT_TYPES.REJECT_DOWN, level.name, level.value, bar, index));
        }
        if (hit && bar.low < zoneLow && bar.close > zoneHigh) {
            events.push(makeEvent(F2_INTERNAL_EVENT_TYPES.RECLAIM_UP, level.name, level.value, bar, index));
        }
        if (!state.acceptedAbove && state.aboveRun >= this.acceptBars) {
            state.acceptedAbove = true;
            events.push(makeEvent(F2_INTERNAL_EVENT_TYPES.ACCEPT_ABOVE, level.name, level.value, bar, index, {
                bars: state.aboveRun,
            }));
        }
        if (!state.acceptedBelow && state.belowRun >= this.acceptBars) {
            state.acceptedBelow = true;
            events.push(makeEvent(F2_INTERNAL_EVENT_TYPES.ACCEPT_BELOW, level.name, level.value, bar, index, {
                bars: state.belowRun,
            }));
        }

        state.previousRelation = relation;
        levelState.set(level.name, state);
        return events;
    }
}

export function analyzeF2InternalSequence(bars, opts = {}) {
    return new F2InternalSequenceProbe(opts).analyzeBars(bars);
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
            throw new Error(`F2InternalSequenceProbe bar requires finite ${field}`);
        }
    }
    if (!normalized.time) throw new Error('F2InternalSequenceProbe bar requires time');
    return normalized;
}

function relationToZone(close, zoneLow, zoneHigh) {
    if (close > zoneHigh) return 'ABOVE';
    if (close < zoneLow) return 'BELOW';
    return 'INSIDE';
}

function makeEvent(type, level, value, bar, index, extra = {}) {
    return {
        type,
        level,
        value: round(value),
        time: bar.time,
        index,
        close: round(bar.close),
        high: round(bar.high),
        low: round(bar.low),
        ...extra,
    };
}

function summarize(events) {
    const counts = {};
    for (const event of events) counts[event.type] = (counts[event.type] || 0) + 1;
    return {
        eventCount: events.length,
        counts,
        firstEvent: events[0] || null,
        lastEvent: events.at(-1) || null,
        runner: events.find(event => event.type === F2_INTERNAL_EVENT_TYPES.RUNNER_UP || event.type === F2_INTERNAL_EVENT_TYPES.RUNNER_DOWN)?.type || null,
    };
}

function round(value, digits = 6) {
    return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}
