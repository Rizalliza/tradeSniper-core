#!/usr/bin/env node
/**
 * Assessment layer for the multi-event opening scanner.
 *
 * Uses a hindsight session direction as a temporary "news bias" proxy so we can
 * study whether bias-aligned leniency would reduce noise or improve selection.
 * This is research-only and intentionally not part of production execution.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {
        pressure: 'data/pressure-pilot-2026-09-09_2026-09-15.json',
        study: 'data/opening-multi-event-study-2026-09-09_2026-09-15.json',
        out: 'data/opening-multi-event-assessment-2026-09-09_2026-09-15.json',
        maxSelectedPerSession: 2,
        minSelectedGapSeconds: 20,
        touchZonePct: 0.00035,
        biasThresholdPct: 0.001,
    };
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--pressure': opts.pressure = args[++i]; break;
            case '--study': opts.study = args[++i]; break;
            case '--out': opts.out = args[++i]; break;
            case '--max-selected-per-session': opts.maxSelectedPerSession = Number(args[++i]); break;
            case '--min-selected-gap-seconds': opts.minSelectedGapSeconds = Number(args[++i]); break;
            case '--touch-zone-pct': opts.touchZonePct = Number(args[++i]); break;
            case '--bias-threshold-pct': opts.biasThresholdPct = Number(args[++i]); break;
        }
    }
    return opts;
}

function buildPackMap(pressure) {
    const map = new Map();
    for (const symbolPack of pressure.results || []) {
        for (const pack of symbolPack.packs || []) map.set(`${pack.symbol}|${pack.date}`, pack);
    }
    return map;
}

function normalizeBars(bars = []) {
    return bars
        .filter(b => b.time && finite(b.open) && finite(b.high) && finite(b.low) && finite(b.close))
        .map((b, index) => ({
            index,
            time: b.time,
            open: Number(b.open),
            high: Number(b.high),
            low: Number(b.low),
            close: Number(b.close),
            volume: Number(b.volume) || 0,
        }))
        .sort((a, b) => a.time.localeCompare(b.time));
}

function assessSession({ session, pack, config }) {
    const first2Bars = normalizeBars(pack.bars?.open_first_2_min_aggregated_seconds || []);
    const validationBars = normalizeBars(pack.bars?.open_aggregated_seconds || []);
    const allBars = [...first2Bars, ...validationBars].map((bar, index) => ({ ...bar, index }));
    const bias = hindsightBias(allBars, config);
    const annotations = buildLevelAnnotations({ first2Bars, f2Window: pack.windows?.open_first_2_min || {}, config });
    const candidates = (session.candidates || []).map(candidate => scoreCandidate({ candidate, bias }));
    const selected = selectCandidates({ candidates, config });
    const selectedStats = summarizeCandidates(selected);
    const allStats = summarizeCandidates(candidates.filter(c => c.trade));
    const actionBrief = buildBrief({ session, bias, annotations, candidates, selected, selectedStats, allStats });
    return {
        symbol: session.symbol,
        date: session.date,
        bias,
        annotationSummary: summarizeAnnotations(annotations),
        annotations,
        candidates,
        selectedCandidates: selected,
        selectedStats,
        allStats,
        actionBrief,
    };
}

function hindsightBias(bars, config) {
    const first = bars[0];
    const last = bars.at(-1);
    if (!first || !last) return { direction: 'NEUTRAL', returnPct: 0, source: 'NONE' };
    const returnPct = (last.close - first.open) / first.open;
    const direction = returnPct >= config.biasThresholdPct
        ? 'BUY'
        : returnPct <= -config.biasThresholdPct
            ? 'SELL'
            : 'NEUTRAL';
    return {
        direction,
        returnPct: round(returnPct, 6),
        source: 'HINDSIGHT_SESSION_RETURN_PROXY',
        open: round(first.open),
        close: round(last.close),
    };
}

function buildLevelAnnotations({ first2Bars, f2Window, config }) {
    const levels = [
        { level: 'F2-H', value: Number(f2Window.high) },
        { level: 'F2-M', value: finite(f2Window.high) && finite(f2Window.low) ? (Number(f2Window.high) + Number(f2Window.low)) / 2 : NaN },
        { level: 'F2-L', value: Number(f2Window.low) },
    ].filter(row => finite(row.value));
    const counters = new Map();
    const annotations = [];
    for (let i = 1; i < first2Bars.length; i++) {
        const prev = first2Bars[i - 1];
        const bar = first2Bars[i];
        for (const level of levels) {
            const zone = level.value * config.touchZonePct;
            const crossedUp = prev.close <= level.value && bar.close > level.value;
            const crossedDown = prev.close >= level.value && bar.close < level.value;
            const touched = bar.low <= level.value + zone && bar.high >= level.value - zone;
            if (crossedUp) annotations.push(annotation({ counters, bar, level, side: 'BUY', kind: 'CROSS' }));
            if (crossedDown) annotations.push(annotation({ counters, bar, level, side: 'SELL', kind: 'CROSS' }));
            if (touched && !crossedUp && !crossedDown) {
                const side = bar.close >= level.value ? 'BUY' : 'SELL';
                annotations.push(annotation({ counters, bar, level, side, kind: 'TOUCH' }));
            }
        }
    }
    return annotations;
}

function annotation({ counters, bar, level, side, kind }) {
    const key = `${side}|${kind}|${level.level}`;
    const ordinal = (counters.get(key) || 0) + 1;
    counters.set(key, ordinal);
    return {
        time: bar.time,
        barIndex: bar.index,
        side,
        kind,
        ordinal,
        label: `${side === 'BUY' ? 'B' : 'S'}${ordinal} ${kind} ${level.level}`,
        level: level.level,
        levelValue: round(level.value),
        price: round(bar.close),
    };
}

function scoreCandidate({ candidate, bias }) {
    const biasAlignment = bias.direction === 'NEUTRAL'
        ? 'NEUTRAL'
        : candidate.direction === bias.direction ? 'ALIGNED' : 'COUNTER';
    const biasMultiplier = biasAlignment === 'ALIGNED' ? 2 : biasAlignment === 'COUNTER' ? 0.5 : 1;
    const sepBps = Number(candidate.separation?.maxExcursionBps) || 0;
    const confirmationBonus = candidate.confirmation?.status === 'CONFIRMED' ? 10 : -8;
    const fillBonus = candidate.fill?.status === 'FILLED' ? 8 : -4;
    const triggerBonus = candidate.triggerType === 'RETEST_CANDIDATE'
        ? 8
        : candidate.triggerType === 'RECLAIM_RETEST_CANDIDATE'
            ? 6
            : 3;
    const elapsedPenalty = Math.max(0, (Number(candidate.separation?.barsElapsed) || 0) - 5) * 1.5;
    const outcomePct = Number(candidate.trade?.pnlPct) || 0;
    const outcomeTag = candidate.trade?.runner
        ? 'RUNNER'
        : candidate.trade?.outcome || candidate.lifecycle;
    const preOutcomeScore = round((sepBps + triggerBonus + confirmationBonus + fillBonus - elapsedPenalty) * biasMultiplier, 3);
    const hindsightScore = round(preOutcomeScore + outcomePct * 10000, 3);
    const alignedMinimum = biasAlignment === 'ALIGNED' ? 12 : biasAlignment === 'NEUTRAL' ? 20 : 36;
    const selected = candidate.fill?.status === 'FILLED' && preOutcomeScore >= alignedMinimum;
    return {
        ...candidate,
        biasAlignment,
        biasMultiplier,
        preOutcomeScore,
        hindsightScore,
        selected,
        decision: selected ? 'SELECTED_RESEARCH' : rejectionReason({ candidate, preOutcomeScore, alignedMinimum, biasAlignment }),
        outcomeTag,
    };
}

function rejectionReason({ candidate, preOutcomeScore, alignedMinimum, biasAlignment }) {
    if (candidate.fill?.status !== 'FILLED') return candidate.lifecycle;
    if (preOutcomeScore < alignedMinimum) return `LOW_SCORE_${biasAlignment}`;
    return 'NOT_SELECTED';
}

function selectCandidates({ candidates, config }) {
    const selected = [];
    const ranked = candidates
        .filter(candidate => candidate.selected)
        .sort((a, b) => b.preOutcomeScore - a.preOutcomeScore || String(a.entryCandidateTime).localeCompare(String(b.entryCandidateTime)));
    for (const candidate of ranked) {
        if (selected.length >= config.maxSelectedPerSession) break;
        const tooClose = selected.some(row =>
            row.direction === candidate.direction &&
            Math.abs(timeToSeconds(row.entryCandidateTime) - timeToSeconds(candidate.entryCandidateTime)) < config.minSelectedGapSeconds
        );
        if (!tooClose) selected.push(candidate);
    }
    return selected.sort((a, b) => String(a.entryCandidateTime).localeCompare(String(b.entryCandidateTime)));
}

function summarizeCandidates(candidates) {
    const trades = candidates.filter(c => c.trade);
    const wins = trades.filter(c => c.trade.outcome === 'WON').length;
    const losses = trades.filter(c => c.trade.outcome === 'LOST').length;
    const totalPnlPct = trades.reduce((sum, c) => sum + (Number(c.trade.pnlPct) || 0), 0);
    return {
        candidates: candidates.length,
        trades: trades.length,
        wins,
        losses,
        winRate: wins + losses ? wins / (wins + losses) : null,
        totalPnlPct: round(totalPnlPct, 6),
        avgPnlPct: trades.length ? round(totalPnlPct / trades.length, 6) : null,
        runners: trades.filter(c => c.trade.runner).length,
        exits: countBy(trades, c => c.trade.exitReason),
        directions: countBy(candidates, c => c.direction),
        biasAlignment: countBy(candidates, c => c.biasAlignment),
    };
}

function summarizeAnnotations(annotations) {
    return {
        total: annotations.length,
        bySide: countBy(annotations, row => row.side),
        byKind: countBy(annotations, row => row.kind),
        byLevel: countBy(annotations, row => row.level),
    };
}

function buildBrief({ session, bias, annotations, candidates, selected, selectedStats, allStats }) {
    const selectedText = selected.length
        ? selected.map(c => `${c.candidateId} ${c.entryCandidateTime} ${c.direction} ${c.triggerType} score ${c.preOutcomeScore} -> ${c.trade?.exitReason || c.lifecycle} ${pct(c.trade?.pnlPct)}`).join('; ')
        : 'No selected candidates after guardrails.';
    const noisy = candidates.length > 18
        ? `High noise: ${candidates.length} candidates. Prioritize duplicate-cycle suppression and stronger separation filters.`
        : `Candidate count manageable: ${candidates.length}.`;
    const biasText = bias.direction === 'NEUTRAL'
        ? `Bias proxy neutral from session return ${pct(bias.returnPct)}.`
        : `Bias proxy ${bias.direction} from session return ${pct(bias.returnPct)}; aligned candidate score is doubled.`;
    const discrepancy = selectedStats.totalPnlPct < allStats.totalPnlPct
        ? 'Selection missed some profitable activity; inspect whether rules are too strict or late.'
        : 'Selection improved or simplified the raw candidate set on this session.';
    return [
        `${session.symbol} ${session.date}: ${biasText}`,
        `${noisy} Touch/cross labels recorded: ${annotations.length}.`,
        `Selected: ${selectedText}`,
        `Selected total ${pct(selectedStats.totalPnlPct)} vs all filled total ${pct(allStats.totalPnlPct)}. ${discrepancy}`,
    ];
}

function summarizeAll(sessions) {
    const selected = sessions.flatMap(s => s.selectedCandidates);
    const candidates = sessions.flatMap(s => s.candidates);
    return {
        sessions: sessions.length,
        rawCandidates: candidates.length,
        selectedCandidates: selected.length,
        selectedStats: summarizeCandidates(selected),
        rawFilledStats: summarizeCandidates(candidates.filter(c => c.trade)),
        bias: countBy(sessions, s => s.bias.direction),
        selectedByBiasAlignment: countBy(selected, c => c.biasAlignment),
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
    return Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(2)}%` : '-';
}

function timeToSeconds(time) {
    const [hh = 0, mm = 0, ss = 0] = String(time).split(':').map(Number);
    return hh * 3600 + mm * 60 + ss;
}

function finite(value) {
    return Number.isFinite(Number(value));
}

function round(value, digits = 6) {
    return Number.isFinite(Number(value)) ? Number(value.toFixed(digits)) : null;
}

async function main() {
    const opts = parseArgs();
    const config = {
        maxSelectedPerSession: opts.maxSelectedPerSession,
        minSelectedGapSeconds: opts.minSelectedGapSeconds,
        touchZonePct: opts.touchZonePct,
        biasThresholdPct: opts.biasThresholdPct,
    };
    const pressure = JSON.parse(await fs.readFile(opts.pressure, 'utf8'));
    const study = JSON.parse(await fs.readFile(opts.study, 'utf8'));
    const packMap = buildPackMap(pressure);
    const sessions = (study.sessions || [])
        .map(session => {
            const pack = packMap.get(`${session.symbol}|${session.date}`);
            return pack ? assessSession({ session, pack, config }) : null;
        })
        .filter(Boolean);
    const output = {
        generated_at: new Date().toISOString(),
        pressure: opts.pressure,
        study: opts.study,
        note: 'Research-only assessment. Hindsight session return is used only as a temporary bias proxy until real news/context feed is wired.',
        config,
        summary: summarizeAll(sessions),
        sessions,
    };
    await fs.mkdir(path.dirname(opts.out), { recursive: true });
    await fs.writeFile(opts.out, JSON.stringify(output, null, 2) + '\n');

    console.log(`Opening multi-event assessment: ${opts.study}`);
    const s = output.summary;
    console.log(`sessions=${s.sessions} raw=${s.rawCandidates} selected=${s.selectedCandidates} selected W/L=${s.selectedStats.wins}/${s.selectedStats.losses} WR=${pct(s.selectedStats.winRate)} total=${pct(s.selectedStats.totalPnlPct)} rawFilledTotal=${pct(s.rawFilledStats.totalPnlPct)}`);
    for (const session of sessions.filter(row => row.symbol === 'TSLA' && (row.date === '2026-09-09' || row.date === '2026-09-10'))) {
        console.log(`\n${session.symbol} ${session.date} bias=${session.bias.direction} selected=${session.selectedCandidates.length}`);
        for (const line of session.actionBrief) console.log(`- ${line}`);
    }
    console.log(`Wrote ${opts.out}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
