#!/usr/bin/env node
/**
 * Research harness for WAIT_CONFIRMATION before opening sniper entry.
 *
 * The study finds the same cross/retest candidates as the paper trader, then
 * compares immediate entry with delayed confirmation rules. It does not change
 * live or paper execution defaults.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {
        input: 'data/pressure-pilot-2026-09-09_2026-09-15.json',
        out: 'data/opening-wait-confirmation-study-2026-09-09_2026-09-15.json',
        zonePct: 0.0015,
        retestZonePct: 0.00025,
        retestCloseZoneMultiplier: 2,
        scalpTargetPct: 0.001,
        hardStopPct: 0.001,
        runnerTriggerPct: 0.0015,
        runnerTrailPct: 0.001,
        reclaimFlipBars: 2,
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--input': opts.input = args[++i]; break;
            case '--out': opts.out = args[++i]; break;
            case '--zone-pct': opts.zonePct = Number(args[++i]); break;
            case '--retest-zone-pct': opts.retestZonePct = Number(args[++i]); break;
            case '--retest-close-zone-multiplier': opts.retestCloseZoneMultiplier = Number(args[++i]); break;
            case '--scalp-target-pct': opts.scalpTargetPct = Number(args[++i]); break;
            case '--hard-stop-pct': opts.hardStopPct = Number(args[++i]); break;
            case '--runner-trigger-pct': opts.runnerTriggerPct = Number(args[++i]); break;
            case '--runner-trail-pct': opts.runnerTrailPct = Number(args[++i]); break;
            case '--reclaim-flip-bars': opts.reclaimFlipBars = Number(args[++i]); break;
        }
    }
    return opts;
}

function normalizeBars(bars = []) {
    return bars
        .filter(b => b.time && finite(b.open) && finite(b.high) && finite(b.low) && finite(b.close))
        .map(b => ({
            symbol: b.symbol,
            date: b.date,
            time: b.time,
            open: Number(b.open),
            high: Number(b.high),
            low: Number(b.low),
            close: Number(b.close),
            volume: Number(b.volume) || 0,
        }))
        .sort((a, b) => a.time.localeCompare(b.time));
}

function findCandidate({ symbol, date, first2Bars, config }) {
    let high = null;
    let low = null;
    let prevBar = null;
    let pending = null;
    let localBias = 'NEUTRAL';
    let upPressureRun = 0;
    let downPressureRun = 0;
    const events = [];

    for (let index = 0; index < first2Bars.length; index++) {
        const bar = { ...first2Bars[index], index };
        if (index === 0) {
            high = bar.high;
            low = bar.low;
            prevBar = bar;
            continue;
        }

        const priorHigh = high;
        const priorLow = low;
        const priorMid = (priorHigh + priorLow) / 2;
        const upsidePressure = bar.high > priorHigh && bar.close > priorMid;
        const downsidePressure = bar.low < priorLow && bar.close < priorMid;
        upPressureRun = upsidePressure ? upPressureRun + 1 : 0;
        downPressureRun = downsidePressure ? downPressureRun + 1 : 0;
        if (upPressureRun >= 2) localBias = 'BULLISH';
        if (downPressureRun >= 2) localBias = 'BEARISH';

        if (!pending) {
            pending = detectCross({ prevBar, bar, high, low, index, config });
            if (pending) events.push({ type: pending.eventType, direction: pending.direction, level: pending.level, levelValue: pending.levelValue, time: bar.time });
        } else if (index !== pending.crossIndex) {
            const flip = maybeFlipReclaim(pending, bar, index, config);
            if (flip) {
                events.push(flip);
            } else {
                const retest = detectRetest(pending, bar, config);
                if (retest) {
                    return {
                        symbol,
                        date,
                        direction: pending.direction,
                        level: pending.level,
                        levelValue: pending.levelValue,
                        crossTime: pending.crossTime,
                        crossIndex: pending.crossIndex,
                        entryCandidateTime: bar.time,
                        entryCandidateIndex: index,
                        entryCandidateHigh: bar.high,
                        entryCandidateLow: bar.low,
                        entryCandidateClose: bar.close,
                        fromReclaim: pending.fromReclaim,
                        localBias,
                        events: [...events, { type: 'RETEST_CANDIDATE', direction: pending.direction, time: bar.time, close: bar.close }],
                    };
                }
            }
        }

        high = Math.max(high, bar.high);
        low = Math.min(low, bar.low);
        prevBar = bar;
    }
    return { symbol, date, phase: pending ? 'NO_RETEST' : 'NO_CROSS', events };
}

function detectCross({ prevBar, bar, high, low, index, config }) {
    const levels = [
        { level: 'F2-H', levelValue: high },
        { level: 'F2-M', levelValue: (high + low) / 2 },
        { level: 'F2-L', levelValue: low },
    ].filter(level => finite(level.levelValue));

    for (const level of levels) {
        const zone = level.levelValue * config.zonePct;
        const crossedUp = prevBar.close <= level.levelValue + zone && bar.high > level.levelValue + zone;
        const crossedDown = prevBar.close >= level.levelValue - zone && bar.low < level.levelValue - zone;
        if (crossedUp) return {
            ...level,
            direction: 'BUY',
            eventType: 'CROSS_UP',
            crossTime: bar.time,
            crossIndex: index,
            reclaimCount: 0,
            fromReclaim: false,
        };
        if (crossedDown) return {
            ...level,
            direction: 'SELL',
            eventType: 'CROSS_DOWN',
            crossTime: bar.time,
            crossIndex: index,
            reclaimCount: 0,
            fromReclaim: false,
        };
    }
    return null;
}

function maybeFlipReclaim(pending, bar, index, config) {
    const reclaimed =
        (pending.direction === 'SELL' && bar.close > pending.levelValue) ||
        (pending.direction === 'BUY' && bar.close < pending.levelValue);
    if (!reclaimed) {
        pending.reclaimCount = 0;
        return null;
    }
    pending.reclaimCount += 1;
    if (pending.reclaimCount < config.reclaimFlipBars) return { type: 'RECLAIM_WAIT', direction: pending.direction, time: bar.time };

    const oldDirection = pending.direction;
    pending.direction = oldDirection === 'SELL' ? 'BUY' : 'SELL';
    pending.level = pending.direction === 'BUY' ? 'RECLAIM-H' : 'RECLAIM-L';
    pending.levelValue = pending.direction === 'BUY' ? bar.high : bar.low;
    pending.crossTime = bar.time;
    pending.crossIndex = index;
    pending.reclaimCount = 0;
    pending.fromReclaim = true;
    return { type: 'RECLAIM_FLIP', from: oldDirection, direction: pending.direction, level: pending.level, levelValue: round(pending.levelValue), time: bar.time };
}

function detectRetest(pending, bar, config) {
    const zone = pending.levelValue * config.retestZonePct;
    const closeZone = zone * config.retestCloseZoneMultiplier;
    if (pending.direction === 'BUY') {
        return bar.low <= pending.levelValue + zone &&
            bar.close > pending.levelValue &&
            (!pending.fromReclaim || bar.close <= pending.levelValue + closeZone);
    }
    return bar.high >= pending.levelValue - zone &&
        bar.close < pending.levelValue &&
        (!pending.fromReclaim || bar.close >= pending.levelValue - closeZone);
}

function simulatePolicy({ candidate, first2Bars, validationBars, policy, config }) {
    if (!candidate.direction) return { symbol: candidate.symbol, date: candidate.date, phase: candidate.phase, trade: null, events: candidate.events || [] };
    const allBars = [...first2Bars, ...validationBars].map((bar, index) => ({ ...bar, index }));
    const entryIndex = resolveEntryIndex(candidate, allBars, policy);
    if (entryIndex == null) {
        return {
            symbol: candidate.symbol,
            date: candidate.date,
            phase: 'WAIT_CANCELLED',
            trade: null,
            events: [...candidate.events, { type: 'WAIT_CANCELLED', policy: policy.name }],
        };
    }

    const entryBar = allBars[entryIndex];
    const trade = {
        symbol: candidate.symbol,
        date: candidate.date,
        direction: candidate.direction,
        entryPrice: round(candidate.levelValue),
        entryTime: entryBar.time,
        entryIndex,
        entryReason: entryIndex === candidate.entryCandidateIndex ? 'IMMEDIATE_RETEST' : `WAIT_${policy.name}`,
        crossTime: candidate.crossTime,
        crossLevel: candidate.level,
        runner: false,
        bestPrice: candidate.direction === 'BUY' ? entryBar.high : entryBar.low,
        trailingStop: null,
        exitPrice: null,
        exitTime: null,
        exitReason: null,
        pnlPct: null,
        outcome: null,
    };

    for (let i = entryIndex + 1; i < allBars.length; i++) {
        manageTrade(trade, allBars[i], config, i >= first2Bars.length);
        if (trade.exitReason) break;
    }

    if (!trade.exitReason) {
        const last = allBars.at(-1) || entryBar;
        closeTrade(trade, last.close, trade.runner ? 'RUNNER_HELD_TO_END' : 'UNRESOLVED_WINDOW_END', last.time);
    }
    return { symbol: candidate.symbol, date: candidate.date, phase: 'CLOSED', trade, events: candidate.events };
}

function resolveEntryIndex(candidate, bars, policy) {
    if (policy.confirmBars === 0) return candidate.entryCandidateIndex;
    const start = candidate.entryCandidateIndex;
    const max = Math.min(bars.length - 1, start + policy.confirmBars);
    for (let i = start + 1; i <= max; i++) {
        const bar = bars[i];
        if (violated(candidate, bar)) return null;
        if (confirmed(candidate, bar, policy)) return i;
    }
    return null;
}

function confirmed(candidate, bar, policy) {
    if (policy.type === 'close-through') {
        return candidate.direction === 'BUY'
            ? bar.close > candidate.entryCandidateHigh
            : bar.close < candidate.entryCandidateLow;
    }
    return candidate.direction === 'BUY'
        ? bar.close > candidate.levelValue && bar.low >= candidate.levelValue
        : bar.close < candidate.levelValue && bar.high <= candidate.levelValue;
}

function violated(candidate, bar) {
    return candidate.direction === 'BUY'
        ? bar.close < candidate.levelValue
        : bar.close > candidate.levelValue;
}

function manageTrade(trade, bar, config, allowRunner) {
    const stopPrice = trade.direction === 'BUY'
        ? trade.entryPrice * (1 - config.hardStopPct)
        : trade.entryPrice * (1 + config.hardStopPct);
    const stopHit = trade.direction === 'BUY' ? bar.low <= stopPrice : bar.high >= stopPrice;
    if (stopHit) {
        closeTrade(trade, stopPrice, trade.runner ? 'RUNNER_HARD_STOP' : 'HARD_STOP', bar.time);
        return;
    }

    updateBestPrice(trade, bar);
    if (trade.runner) {
        updateTrail(trade, config);
        const trailHit = trade.direction === 'BUY'
            ? bar.low <= trade.trailingStop
            : bar.high >= trade.trailingStop;
        if (trailHit) closeTrade(trade, trade.trailingStop, 'RUNNER_TRAIL', bar.time);
        return;
    }

    const targetPrice = trade.direction === 'BUY'
        ? trade.entryPrice * (1 + config.scalpTargetPct)
        : trade.entryPrice * (1 - config.scalpTargetPct);
    const targetHit = trade.direction === 'BUY' ? bar.high >= targetPrice : bar.low <= targetPrice;
    if (!targetHit) return;

    const favorablePct = pnlPct(trade, bar.close);
    if (allowRunner || favorablePct >= config.runnerTriggerPct) {
        trade.runner = true;
        updateTrail(trade, config);
        return;
    }
    closeTrade(trade, targetPrice, 'SCALP_TARGET', bar.time);
}

function updateBestPrice(trade, bar) {
    const candidate = trade.direction === 'BUY' ? bar.high : bar.low;
    const better = trade.direction === 'BUY' ? candidate > trade.bestPrice : candidate < trade.bestPrice;
    if (better) trade.bestPrice = candidate;
}

function updateTrail(trade, config) {
    trade.trailingStop = trade.direction === 'BUY'
        ? trade.bestPrice * (1 - config.runnerTrailPct)
        : trade.bestPrice * (1 + config.runnerTrailPct);
}

function closeTrade(trade, price, reason, time) {
    trade.exitPrice = round(price);
    trade.exitTime = time;
    trade.exitReason = reason;
    trade.pnlPct = round(pnlPct(trade, price), 6);
    trade.outcome = trade.pnlPct > 0 ? 'WON' : trade.pnlPct < 0 ? 'LOST' : 'BREAKEVEN';
}

function pnlPct(trade, price) {
    const dir = trade.direction === 'BUY' ? 1 : -1;
    return ((price - trade.entryPrice) / trade.entryPrice) * dir;
}

function summarize(results) {
    const trades = results.filter(row => row.trade);
    const wins = trades.filter(row => row.trade.outcome === 'WON').length;
    const losses = trades.filter(row => row.trade.outcome === 'LOST').length;
    const totalPnlPct = trades.reduce((sum, row) => sum + (row.trade.pnlPct || 0), 0);
    return {
        sessions: results.length,
        entries: trades.length,
        cancelled: results.filter(row => row.phase === 'WAIT_CANCELLED').length,
        wins,
        losses,
        winRate: wins + losses ? wins / (wins + losses) : null,
        avgPnlPct: trades.length ? totalPnlPct / trades.length : 0,
        totalPnlPct,
        hardStops: trades.filter(row => row.trade.exitReason === 'HARD_STOP').length,
        runners: trades.filter(row => row.trade.runner).length,
        exitReasons: countBy(trades, row => row.trade.exitReason),
    };
}

function countBy(rows, fn) {
    return rows.reduce((acc, row) => {
        const key = fn(row) || 'UNKNOWN';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});
}

function pct(value) {
    return value == null ? '-' : `${(value * 100).toFixed(2)}%`;
}

function finite(value) {
    return Number.isFinite(Number(value));
}

function round(value, digits = 6) {
    return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

async function main() {
    const opts = parseArgs();
    const config = {
        zonePct: opts.zonePct,
        retestZonePct: opts.retestZonePct,
        retestCloseZoneMultiplier: opts.retestCloseZoneMultiplier,
        scalpTargetPct: opts.scalpTargetPct,
        hardStopPct: opts.hardStopPct,
        runnerTriggerPct: opts.runnerTriggerPct,
        runnerTrailPct: opts.runnerTrailPct,
        reclaimFlipBars: opts.reclaimFlipBars,
    };
    const policies = [
        { name: 'IMMEDIATE', confirmBars: 0, type: 'immediate' },
        { name: 'WAIT_1_CLOSE_THROUGH', confirmBars: 1, type: 'close-through' },
        { name: 'WAIT_2_CLOSE_THROUGH', confirmBars: 2, type: 'close-through' },
        { name: 'WAIT_1_HOLD_LEVEL', confirmBars: 1, type: 'hold-level' },
        { name: 'WAIT_2_HOLD_LEVEL', confirmBars: 2, type: 'hold-level' },
    ];

    const payload = JSON.parse(await fs.readFile(opts.input, 'utf8'));
    const packs = [];
    for (const symbolPack of payload.results || []) {
        for (const pack of symbolPack.packs || []) {
            const first2Bars = normalizeBars(pack.bars?.open_first_2_min_aggregated_seconds || []);
            const validationBars = normalizeBars(pack.bars?.open_aggregated_seconds || []);
            packs.push({
                symbol: pack.symbol,
                date: pack.date,
                first2Bars,
                validationBars,
                candidate: findCandidate({ symbol: pack.symbol, date: pack.date, first2Bars, config }),
            });
        }
    }

    const scenarios = policies.map(policy => {
        const results = packs.map(pack => simulatePolicy({ ...pack, policy, config }));
        return { policy: policy.name, summary: summarize(results), results };
    });

    const output = {
        generated_at: new Date().toISOString(),
        input: opts.input,
        note: 'Research-only WAIT confirmation comparison. No local bias guard is applied here; this isolates execution decisiveness after retest.',
        config,
        scenarios,
    };

    await fs.mkdir(path.dirname(opts.out), { recursive: true });
    await fs.writeFile(opts.out, JSON.stringify(output, null, 2) + '\n');

    console.log(`Wait confirmation study: ${opts.input}`);
    for (const scenario of scenarios) {
        const s = scenario.summary;
        console.log(`${scenario.policy.padEnd(22)} entries=${String(s.entries).padStart(2)} cancelled=${String(s.cancelled).padStart(2)} W/L=${s.wins}/${s.losses} WR=${pct(s.winRate)} avg=${pct(s.avgPnlPct)} total=${pct(s.totalPnlPct)} stops=${s.hardStops}`);
    }
    console.log(`Wrote ${opts.out}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
