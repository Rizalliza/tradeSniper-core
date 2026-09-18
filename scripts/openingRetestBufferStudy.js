#!/usr/bin/env node
/**
 * Compare opening sniper retest-buffer settings on the same pressure-pilot data.
 *
 * This is a research harness only. It does not change live/paper execution rules.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { replayOpeningSniperPaper } from '../src/microstructure/OpeningSniperPaperTrader.js';

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {
        input: 'data/pressure-pilot-2026-09-09_2026-09-15.json',
        out: 'data/opening-retest-buffer-study-2026-09-09_2026-09-15.json',
        bps: [1, 2.5, 5, 7.5, 10, 15],
        zonePct: 0.0015,
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
            case '--bps': opts.bps = args[++i].split(',').map(Number).filter(Number.isFinite); break;
            case '--zone-pct': opts.zonePct = Number(args[++i]); break;
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
        .filter(b => b.time && Number.isFinite(Number(b.open)) && Number.isFinite(Number(b.high)) &&
            Number.isFinite(Number(b.low)) && Number.isFinite(Number(b.close)))
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

function summarize(results) {
    const trades = results.filter(row => row.trade);
    const wins = trades.filter(row => row.trade.outcome === 'WON').length;
    const losses = trades.filter(row => row.trade.outcome === 'LOST').length;
    const pnlPct = trades.reduce((sum, row) => sum + (row.trade.pnlPct || 0), 0);
    const blocked = results.filter(row => row.phase === 'BLOCKED').length;
    return {
        sessions: results.length,
        entries: trades.length,
        blocked,
        noRetest: results.filter(row => row.phase === 'NO_RETEST').length,
        wins,
        losses,
        runners: trades.filter(row => row.trade.runner).length,
        winRate: wins + losses ? wins / (wins + losses) : null,
        avgPnlPct: trades.length ? pnlPct / trades.length : 0,
        totalPnlPct: pnlPct,
        hardStops: trades.filter(row => row.trade.exitReason === 'HARD_STOP').length,
        scalpTargets: trades.filter(row => row.trade.exitReason === 'SCALP_TARGET').length,
        runnerTrails: trades.filter(row => row.trade.exitReason === 'RUNNER_TRAIL').length,
        touchBuckets: bucketTouches(trades),
    };
}

function bucketTouches(rows) {
    const buckets = {
        'pierced': 0,
        '0-2bp': 0,
        '2-5bp': 0,
        '5-10bp': 0,
        '10bp+': 0,
        unknown: 0,
    };
    for (const row of rows) {
        const bps = row.retestDistanceBps;
        if (!Number.isFinite(bps)) buckets.unknown += 1;
        else if (bps < 0) buckets.pierced += 1;
        else if (bps <= 2) buckets['0-2bp'] += 1;
        else if (bps <= 5) buckets['2-5bp'] += 1;
        else if (bps <= 10) buckets['5-10bp'] += 1;
        else buckets['10bp+'] += 1;
    }
    return buckets;
}

function annotateRetestDistance(result, bars) {
    if (!result.trade) return null;
    const bar = bars[result.trade.entryIndex];
    if (!bar) return null;
    const level = result.trade.entryPrice;
    if (result.trade.direction === 'BUY') return round(((bar.low - level) / level) * 10000, 2);
    return round(((level - bar.high) / level) * 10000, 2);
}

function pct(value) {
    return value == null ? '-' : `${(value * 100).toFixed(2)}%`;
}

function round(value, digits = 6) {
    return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

async function main() {
    const opts = parseArgs();
    const payload = JSON.parse(await fs.readFile(opts.input, 'utf8'));
    const packed = [];
    for (const symbolPack of payload.results || []) {
        for (const pack of symbolPack.packs || []) {
            const first2Bars = normalizeBars(pack.bars?.open_first_2_min_aggregated_seconds || []);
            const validationBars = normalizeBars(pack.bars?.open_aggregated_seconds || []);
            packed.push({ symbol: pack.symbol, date: pack.date, first2Bars, validationBars });
        }
    }

    const scenarios = [];
    for (const bps of opts.bps) {
        const baseConfig = {
            zonePct: opts.zonePct,
            retestZonePct: bps / 10000,
            retestCloseZoneMultiplier: opts.retestCloseZoneMultiplier,
            scalpTargetPct: opts.scalpTargetPct,
            hardStopPct: opts.hardStopPct,
            runnerTriggerPct: opts.runnerTriggerPct,
            runnerTrailPct: opts.runnerTrailPct,
            reclaimFlipBars: opts.reclaimFlipBars,
        };

        for (const guard of [true, false]) {
            const config = { ...baseConfig, wrongSideGuard: guard };
            const results = packed.map(pack => {
                const result = replayOpeningSniperPaper({ ...pack, config });
                const bars = [...pack.first2Bars, ...pack.validationBars];
                return {
                    symbol: pack.symbol,
                    date: pack.date,
                    phase: result.phase,
                    trade: result.trade,
                    retestDistanceBps: annotateRetestDistance(result, bars),
                };
            });
            scenarios.push({
                retestZoneBps: bps,
                wrongSideGuard: guard,
                summary: summarize(results),
                results,
            });
        }
    }

    const output = {
        generated_at: new Date().toISOString(),
        input: opts.input,
        note: 'Research-only retest buffer comparison. 09:30-09:32 uses 2-second bars; 09:32-10:00 validation uses 1-minute bars from pressurePilot.',
        scenarios,
    };
    await fs.mkdir(path.dirname(opts.out), { recursive: true });
    await fs.writeFile(opts.out, JSON.stringify(output, null, 2) + '\n');

    console.log(`Retest buffer study: ${opts.input}`);
    for (const row of scenarios) {
        const s = row.summary;
        console.log(`${String(row.retestZoneBps).padStart(4)}bp guard=${row.wrongSideGuard ? 'Y' : 'N'} entries=${String(s.entries).padStart(2)} blocked=${s.blocked} W/L=${s.wins}/${s.losses} WR=${pct(s.winRate)} avg=${pct(s.avgPnlPct)} total=${pct(s.totalPnlPct)} stops=${s.hardStops}`);
    }
    console.log(`Wrote ${opts.out}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
