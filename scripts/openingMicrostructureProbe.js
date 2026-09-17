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
import { buildConfluenceZones } from '../src/microstructure/LevelConfluenceEngine.js';
import { LevelInteractionEngine } from '../src/microstructure/LevelInteractionEngine.js';
import { analyzeF2InternalSequence } from '../src/microstructure/F2InternalSequenceProbe.js';

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

function referenceLevels(pack) {
    const markerLevels = (pack.marker_list || []).map(marker => ({
        name: marker.name,
        value: Number(marker.value),
        role: marker.tier || marker.type || 'marker',
        type: marker.type || 'marker',
        source: 'marker_list',
    }));
    const premarket = pack.windows?.premarket || {};
    const pmHigh = Number(premarket.high);
    const pmLow = Number(premarket.low);
    const pmMid = Number.isFinite(pmHigh) && Number.isFinite(pmLow) ? (pmHigh + pmLow) / 2 : NaN;

    return [
        ...markerLevels,
        { name: 'PM-H', value: pmHigh, role: 'premarket', type: 'opening_context', source: 'premarket' },
        { name: 'PM-M', value: pmMid, role: 'premarket', type: 'opening_context', source: 'premarket' },
        { name: 'PM-L', value: pmLow, role: 'premarket', type: 'opening_context', source: 'premarket' },
    ].filter(level => Number.isFinite(level.value));
}

function classifyZonePath(zone, bars, opts) {
    const engine = new LevelInteractionEngine({
        zones: [zone],
        acceptBars: opts.acceptBars,
    });
    const events = engine.processBars(bars);
    return {
        zoneId: zone.id,
        level: zone.levels.map(level => level.name).join('+'),
        value: num(zone.center),
        zoneLow: num(zone.low),
        zoneHigh: num(zone.high),
        confluence: zone.confluence,
        levels: zone.levels.map(level => ({
            name: level.name,
            value: num(level.value),
            role: level.role,
            source: level.source,
        })),
        events,
    };
}

function classifyLevelPath(level, bars, opts) {
    const zone = buildConfluenceZones([level], { zonePct: opts.zonePct })[0];
    const report = classifyZonePath(zone, bars, opts);
    return {
        level: level.name,
        value: num(level.value),
        zone: num(Math.max(level.value - report.zoneLow, report.zoneHigh - level.value)),
        events: report.events.map(event => ({
            ...event,
            type: event.type === 'TOUCH' ? 'FIRST_TOUCH' : event.type,
            level: level.name,
        })),
    };
}

function summarizeSignal(zoneReports, pack) {
    const events = zoneReports.flatMap(report => report.events.map(e => ({
        ...e,
        zoneId: report.zoneId,
        levelNames: report.levels.map(level => level.name),
        levelValue: report.value,
    })));
    const acceptAbove = events.find(e => e.type === 'ACCEPT_ABOVE');
    const acceptBelow = events.find(e => e.type === 'ACCEPT_BELOW');
    const f2HighReject = events.find(e => e.levelNames.includes('F2-H') && e.type === 'REJECT_DOWN');
    const f2LowReclaim = events.find(e => e.levelNames.includes('F2-L') && e.type === 'RECLAIM_UP');
    const f2MidAcceptAbove = events.find(e => e.levelNames.includes('F2-M') && e.type === 'ACCEPT_ABOVE');
    const f2MidAcceptBelow = events.find(e => e.levelNames.includes('F2-M') && e.type === 'ACCEPT_BELOW');

    let signal = 'NO_SIGNAL';
    let reason = 'No strong F2 acceptance/rejection event found at bar resolution';

    if (f2HighReject || f2MidAcceptBelow) {
        signal = 'BEARISH_F2_FAILURE';
        reason = f2HighReject
            ? `Rejected ${f2HighReject.level} and closed back below retest zone`
            : 'Accepted below F2-M after the first-two-minute map formed';
    } else if (f2LowReclaim || f2MidAcceptAbove) {
        signal = 'BULLISH_F2_RECLAIM';
        reason = f2LowReclaim
            ? `Swept below ${f2LowReclaim.level} and reclaimed above the zone`
            : 'Accepted above F2-M after the first-two-minute map formed';
    } else if (acceptAbove) {
        signal = acceptAbove.levelNames?.some(name => name.startsWith('F2-'))
            ? 'BULLISH_ACCEPTANCE'
            : 'CONTEXT_BULLISH_ACCEPTANCE';
        reason = `Accepted above ${acceptAbove.level}`;
    } else if (acceptBelow) {
        signal = acceptBelow.levelNames?.some(name => name.startsWith('F2-'))
            ? 'BEARISH_ACCEPTANCE'
            : 'CONTEXT_BEARISH_ACCEPTANCE';
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
            const firstTwoBars = normalizeBars(pack.bars?.open_first_2_min_aggregated_seconds || []);
            const levels = firstTwoMinuteLevels(pack);
            const confluenceLevels = [...levels, ...referenceLevels(pack)];
            const zones = buildConfluenceZones(confluenceLevels, { zonePct: opts.zonePct });
            const zoneReports = zones.map(zone => classifyZonePath(zone, validationBars, opts));
            const levelReports = levels.map(level => classifyLevelPath(level, validationBars, opts));
            const signal = summarizeSignal(zoneReports, pack);
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
                internalSequence: analyzeF2InternalSequence(firstTwoBars, opts),
                zones: zoneReports,
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
