#!/usr/bin/env node
/**
 * Bar-level probe for the first-two-minute opening map.
 *
 * This is intentionally not a WebSocket/tick test. It consumes pressurePilot
 * output and checks whether later opening bars interact with F2-H/F2-M/F2-L.
 *
 * Usage:
 *   node scripts/openingMicrostructureProbe.js \
 *     --input data/pressure-pilot-2026-09-09_2026-09-15.json \
 *     --out data/opening-microstructure-probe-2026-09-09_2026-09-15.json
 */

import fs from 'node:fs/promises';
import path from 'node:path';

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {
        input: 'data/pressure-pilot-2026-09-09_2026-09-15.json',
        out: null,
        zonePct: 0.0015,
        acceptBars: 2,
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--input': opts.input = args[++i]; break;
            case '--out': opts.out = args[++i]; break;
            case '--zone-pct': opts.zonePct = Number(args[++i]); break;
            case '--accept-bars': opts.acceptBars = Number(args[++i]); break;
        }
    }

    opts.out ||= opts.input.replace(/\.json$/, '-microstructure-probe.json');
    return opts;
}

function num(value, digits = 4) {
    return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function relation(close, level, zone) {
    if (close > level + zone) return 'ABOVE';
    if (close < level - zone) return 'BELOW';
    return 'INSIDE';
}

function touches(bar, level, zone) {
    return bar.high >= level - zone && bar.low <= level + zone;
}

function normalizeBars(bars = []) {
    return bars
        .filter(b => Number.isFinite(Number(b.open)) && Number.isFinite(Number(b.high)) &&
            Number.isFinite(Number(b.low)) && Number.isFinite(Number(b.close)) && b.time)
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

function firstTwoMinuteLevels(pack) {
    const f2 = pack.windows?.open_first_2_min || {};
    return [
        { name: 'F2-H', value: Number(f2.high), role: 'upper' },
        { name: 'F2-M', value: Number.isFinite(Number(f2.high)) && Number.isFinite(Number(f2.low)) ? (Number(f2.high) + Number(f2.low)) / 2 : NaN, role: 'mid' },
        { name: 'F2-L', value: Number(f2.low), role: 'lower' },
    ].filter(level => Number.isFinite(level.value));
}

function classifyLevelPath(level, bars, opts) {
    const zone = level.value * opts.zonePct;
    const events = [];
    let prev = null;
    let aboveRun = 0;
    let belowRun = 0;
    let acceptedAbove = false;
    let acceptedBelow = false;

    for (let i = 0; i < bars.length; i++) {
        const bar = bars[i];
        const rel = relation(bar.close, level.value, zone);
        const hit = touches(bar, level.value, zone);

        aboveRun = rel === 'ABOVE' ? aboveRun + 1 : 0;
        belowRun = rel === 'BELOW' ? belowRun + 1 : 0;

        if (hit && !events.some(e => e.type === 'FIRST_TOUCH')) {
            events.push(event(level, 'FIRST_TOUCH', bar, i, {
                relation: rel,
                penetrationBps: penetrationBps(bar, level.value, zone),
            }));
        }

        if (prev && prev.relation === 'BELOW' && rel === 'ABOVE') {
            events.push(event(level, 'CROSS_UP', bar, i));
        }
        if (prev && prev.relation === 'ABOVE' && rel === 'BELOW') {
            events.push(event(level, 'CROSS_DOWN', bar, i));
        }

        if (!acceptedAbove && aboveRun >= opts.acceptBars) {
            acceptedAbove = true;
            events.push(event(level, 'ACCEPT_ABOVE', bar, i, { bars: aboveRun }));
        }
        if (!acceptedBelow && belowRun >= opts.acceptBars) {
            acceptedBelow = true;
            events.push(event(level, 'ACCEPT_BELOW', bar, i, { bars: belowRun }));
        }

        const rejectedFromAbove = hit && bar.high > level.value + zone && bar.close < level.value - zone;
        const rejectedFromBelow = hit && bar.low < level.value - zone && bar.close > level.value + zone;
        if (rejectedFromAbove) events.push(event(level, 'REJECT_DOWN', bar, i));
        if (rejectedFromBelow) events.push(event(level, 'RECLAIM_UP', bar, i));

        prev = { relation: rel, close: bar.close };
    }

    return {
        level: level.name,
        value: num(level.value),
        zone: num(zone),
        events,
    };
}

function event(level, type, bar, index, extra = {}) {
    return {
        type,
        level: level.name,
        value: num(level.value),
        time: bar.time,
        index,
        close: num(bar.close),
        high: num(bar.high),
        low: num(bar.low),
        ...extra,
    };
}

function penetrationBps(bar, level, zone) {
    if (bar.high > level + zone) return num(((bar.high - level) / level) * 10000, 2);
    if (bar.low < level - zone) return num(((bar.low - level) / level) * 10000, 2);
    return 0;
}

function summarizeSignal(levelReports, pack) {
    const events = levelReports.flatMap(report => report.events.map(e => ({ ...e, levelValue: report.value })));
    const acceptAbove = events.find(e => e.type === 'ACCEPT_ABOVE');
    const acceptBelow = events.find(e => e.type === 'ACCEPT_BELOW');
    const f2HighReject = events.find(e => e.level === 'F2-H' && e.type === 'REJECT_DOWN');
    const f2LowReclaim = events.find(e => e.level === 'F2-L' && e.type === 'RECLAIM_UP');
    const f2MidAcceptAbove = events.find(e => e.level === 'F2-M' && e.type === 'ACCEPT_ABOVE');
    const f2MidAcceptBelow = events.find(e => e.level === 'F2-M' && e.type === 'ACCEPT_BELOW');

    let signal = 'NO_SIGNAL';
    let reason = 'No strong F2 acceptance/rejection event found at bar resolution';

    if (f2HighReject || f2MidAcceptBelow) {
        signal = 'BEARISH_F2_FAILURE';
        reason = f2HighReject
            ? 'Rejected F2-H and closed back below retest zone'
            : 'Accepted below F2-M after the first-two-minute map formed';
    } else if (f2LowReclaim || f2MidAcceptAbove) {
        signal = 'BULLISH_F2_RECLAIM';
        reason = f2LowReclaim
            ? 'Swept below F2-L and reclaimed above the zone'
            : 'Accepted above F2-M after the first-two-minute map formed';
    } else if (acceptAbove) {
        signal = 'BULLISH_ACCEPTANCE';
        reason = `Accepted above ${acceptAbove.level}`;
    } else if (acceptBelow) {
        signal = 'BEARISH_ACCEPTANCE';
        reason = `Accepted below ${acceptBelow.level}`;
    }

    return {
        signal,
        reason,
        pressureLabel: pack.pressure?.label || 'UNKNOWN',
        firstEvent: events[0] || null,
        eventCount: events.length,
    };
}

async function main() {
    const opts = parseArgs();
    const payload = JSON.parse(await fs.readFile(opts.input, 'utf8'));
    const results = [];

    for (const symbolPack of payload.results || []) {
        for (const pack of symbolPack.packs || []) {
            const validationBars = normalizeBars(pack.bars?.open_aggregated_seconds || []);
            const levels = firstTwoMinuteLevels(pack);
            const levelReports = levels.map(level => classifyLevelPath(level, validationBars, opts));
            const signal = summarizeSignal(levelReports, pack);
            results.push({
                symbol: pack.symbol,
                date: pack.date,
                pressure: pack.pressure?.label || 'UNKNOWN',
                f2: {
                    high: num(pack.windows?.open_first_2_min?.high),
                    midpoint: levels.find(l => l.name === 'F2-M')?.value ? num(levels.find(l => l.name === 'F2-M').value) : null,
                    low: num(pack.windows?.open_first_2_min?.low),
                    rangePct: num(pack.windows?.open_first_2_min?.range_pct, 6),
                    volume: pack.windows?.open_first_2_min?.volume || 0,
                },
                signal,
                levels: levelReports,
            });
        }
    }

    const output = {
        generated_at: new Date().toISOString(),
        input: opts.input,
        limitation: 'Bar-level probe only. It cannot prove tick/NBBO ordering or millisecond edge.',
        config: {
            zonePct: opts.zonePct,
            acceptBars: opts.acceptBars,
        },
        results,
    };

    await fs.mkdir(path.dirname(opts.out), { recursive: true });
    await fs.writeFile(opts.out, JSON.stringify(output, null, 2) + '\n');

    console.log(`Opening microstructure probe: ${opts.input}`);
    console.log(`Zone: ±${(opts.zonePct * 100).toFixed(2)}%, acceptBars=${opts.acceptBars}`);
    console.log('');
    for (const row of results) {
        console.log(`${row.date} ${row.symbol.padEnd(5)} pressure=${row.pressure.padEnd(7)} signal=${row.signal.signal.padEnd(22)} events=${String(row.signal.eventCount).padStart(2)} reason=${row.signal.reason}`);
    }
    console.log('');
    console.log(`Wrote ${opts.out}`);
}

main().catch(err => {
    console.error(`ERROR: ${err.message}`);
    console.error(err.stack?.slice(0, 800));
    process.exit(1);
});
