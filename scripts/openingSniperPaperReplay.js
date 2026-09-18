#!/usr/bin/env node
/**
 * Paper replay for first-two-minute opening sniper execution.
 *
 * Replays 2-second bars from 09:30:00-09:32:00, allows paper entries only
 * inside that window, then either exits as a scalp or manages runner state
 * through the validation bars.
 *
 * Usage:
 *   node scripts/openingSniperPaperReplay.js \
 *     --input data/pressure-pilot-2026-09-09_2026-09-15.json \
 *     --out data/opening-sniper-paper-2026-09-09_2026-09-15.json
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { replayOpeningSniperPaper } from '../src/microstructure/OpeningSniperPaperTrader.js';

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {
        input: 'data/pressure-pilot-2026-09-09_2026-09-15.json',
        out: null,
        zonePct: 0.0015,
        retestZonePct: 0.00025,
        retestCloseZoneMultiplier: 2,
        scalpTargetPct: 0.001,
        hardStopPct: 0.001,
        runnerTriggerPct: 0.0015,
        runnerTrailPct: 0.001,
        reclaimFlipBars: 2,
        wrongSideGuard: true,
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
            case '--no-wrong-side-guard': opts.wrongSideGuard = false; break;
        }
    }

    opts.out ||= opts.input.replace(/pressure-pilot/, 'opening-sniper-paper');
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
    const rows = results.filter(row => row.trade);
    const wins = rows.filter(row => row.trade.outcome === 'WON').length;
    const losses = rows.filter(row => row.trade.outcome === 'LOST').length;
    const breakeven = rows.filter(row => row.trade.outcome === 'BREAKEVEN').length;
    const runners = rows.filter(row => row.trade.runner).length;
    const firstWindowEntries = rows.filter(row => row.trade.entryTime < '09:32:00').length;
    const avgPnlPct = rows.length
        ? rows.reduce((sum, row) => sum + (row.trade.pnlPct || 0), 0) / rows.length
        : 0;

    return {
        sessions: results.length,
        paperEntries: rows.length,
        noCross: results.filter(row => row.phase === 'NO_CROSS').length,
        noRetest: results.filter(row => row.phase === 'NO_RETEST').length,
        blocked: results.filter(row => row.phase === 'BLOCKED').length,
        firstWindowEntries,
        runners,
        wins,
        losses,
        breakeven,
        winRate: wins + losses ? wins / (wins + losses) : null,
        avgPnlPct,
        exitReasons: countBy(rows, row => row.trade.exitReason),
    };
}

function countBy(rows, fn) {
    const counts = {};
    for (const row of rows) {
        const key = fn(row) || 'UNKNOWN';
        counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
}

function pct(value) {
    return value == null ? '-' : `${(value * 100).toFixed(2)}%`;
}

async function main() {
    const opts = parseArgs();
    const payload = JSON.parse(await fs.readFile(opts.input, 'utf8'));
    const config = {
        zonePct: opts.zonePct,
        retestZonePct: opts.retestZonePct,
        retestCloseZoneMultiplier: opts.retestCloseZoneMultiplier,
        scalpTargetPct: opts.scalpTargetPct,
        hardStopPct: opts.hardStopPct,
        runnerTriggerPct: opts.runnerTriggerPct,
        runnerTrailPct: opts.runnerTrailPct,
        reclaimFlipBars: opts.reclaimFlipBars,
        wrongSideGuard: opts.wrongSideGuard,
    };
    const controlConfig = { ...config, wrongSideGuard: false };
    const results = [];

    for (const symbolPack of payload.results || []) {
        for (const pack of symbolPack.packs || []) {
            const first2Bars = normalizeBars(pack.bars?.open_first_2_min_aggregated_seconds || []);
            const validationBars = normalizeBars(pack.bars?.open_aggregated_seconds || []);
            const control = replayOpeningSniperPaper({
                symbol: pack.symbol,
                date: pack.date,
                first2Bars,
                validationBars,
                config: controlConfig,
            });
            const result = replayOpeningSniperPaper({
                symbol: pack.symbol,
                date: pack.date,
                first2Bars,
                validationBars,
                config,
            });
            results.push({
                symbol: pack.symbol,
                date: pack.date,
                pressure: pack.pressure?.label || 'UNKNOWN',
                phase: result.phase,
                openingRange: result.openingRange,
                trade: result.trade,
                events: result.events,
                control: {
                    phase: control.phase,
                    trade: control.trade,
                    events: control.events,
                },
            });
        }
    }

    const summary = summarize(results);
    const controlSummary = summarize(results.map(row => ({
        phase: row.control.phase,
        trade: row.control.trade,
        events: row.control.events,
    })));
    const output = {
        generated_at: new Date().toISOString(),
        input: opts.input,
        limitation: 'Historical 2-second/validation-bar paper replay. summary is filtered sniper; controlSummary is raw sniper without local bias blocking. This verifies detection logic, not live broker fill quality or tick/NBBO ordering.',
        config,
        summary,
        controlSummary,
        results,
    };

    await fs.mkdir(path.dirname(opts.out), { recursive: true });
    await fs.writeFile(opts.out, JSON.stringify(output, null, 2) + '\n');

    console.log(`Opening sniper paper replay: ${opts.input}`);
    console.log(`Filtered: entries ${summary.paperEntries}/${summary.sessions}, runners ${summary.runners}, blocked ${summary.blocked}, WR ${pct(summary.winRate)}, avg ${pct(summary.avgPnlPct)}`);
    console.log(`Control:  entries ${controlSummary.paperEntries}/${controlSummary.sessions}, runners ${controlSummary.runners}, blocked ${controlSummary.blocked}, WR ${pct(controlSummary.winRate)}, avg ${pct(controlSummary.avgPnlPct)}`);
    console.log('');
    for (const row of results) {
        const trade = row.trade;
        if (!trade) {
            const block = row.events.find(event => event.type === 'PAPER_BLOCK');
            const reason = block ? ` ${block.reason} ${block.direction} vs ${block.localBias}` : '';
            console.log(`${row.date} ${row.symbol.padEnd(5)} ${row.phase}${reason}`);
            continue;
        }
        console.log(`${row.date} ${row.symbol.padEnd(5)} ${trade.direction.padEnd(4)} entry=${trade.entryTime} exit=${trade.exitTime} ${trade.exitReason.padEnd(22)} pnl=${pct(trade.pnlPct)} runner=${trade.runner ? 'Y' : 'N'} cross=${trade.crossLevel}`);
    }
    console.log('');
    console.log(`Wrote ${opts.out}`);
}

main().catch(err => {
    console.error(`ERROR: ${err.message}`);
    console.error(err.stack?.slice(0, 1000));
    process.exit(1);
});
