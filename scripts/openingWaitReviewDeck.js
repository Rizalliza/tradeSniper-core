#!/usr/bin/env node
/**
 * Build a static chart deck for WAIT confirmation study review.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {
        pressure: 'data/pressure-pilot-2026-09-09_2026-09-15.json',
        study: 'data/opening-wait-confirmation-study-2026-09-09_2026-09-15.json',
        policy: 'WAIT_2_HOLD_LEVEL',
        fillModel: 'WAIT_LIMIT_RETEST_WITH_EXPIRY',
        baseline: 'IMMEDIATE',
        baselineFillModel: 'IMMEDIATE',
        out: 'webapp/opening-wait-review.html',
    };
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--pressure': opts.pressure = args[++i]; break;
            case '--study': opts.study = args[++i]; break;
            case '--policy': opts.policy = args[++i]; break;
            case '--fill-model': opts.fillModel = args[++i]; break;
            case '--baseline': opts.baseline = args[++i]; break;
            case '--baseline-fill-model': opts.baselineFillModel = args[++i]; break;
            case '--out': opts.out = args[++i]; break;
        }
    }
    return opts;
}

function esc(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

function num(value, digits = 2) {
    return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '-';
}

function pct(value) {
    return Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(2)}%` : '-';
}

function buildPackMap(pressure) {
    const map = new Map();
    for (const symbolPack of pressure.results || []) {
        for (const pack of symbolPack.packs || []) map.set(`${pack.symbol}|${pack.date}`, pack);
    }
    return map;
}

function byKey(rows = []) {
    return new Map(rows.map(row => [`${row.symbol}|${row.date}`, row]));
}

function findBarIndex(bars, time) {
    return Math.max(0, bars.findIndex(bar => bar.time >= time));
}

function eventTime(row, type) {
    return row.events?.find(event => event.type === type)?.time || null;
}

function chart({ waitRow, immediateRow, pack }) {
    const first2 = pack.bars?.open_first_2_min_aggregated_seconds || [];
    const validation = pack.bars?.open_aggregated_seconds || [];
    const bars = [...first2, ...validation];
    if (!bars.length) return '<svg class="chart"></svg>';

    const width = 1120;
    const height = 360;
    const pad = { left: 54, right: 26, top: 20, bottom: 34 };
    const f2 = pack.windows?.open_first_2_min || {};
    const prices = bars.flatMap(bar => [bar.high, bar.low]);
    for (const value of [
        f2.high, f2.low,
        waitRow.trade?.entryPrice, waitRow.trade?.exitPrice,
        immediateRow.trade?.entryPrice, immediateRow.trade?.exitPrice,
    ]) {
        if (Number.isFinite(Number(value))) prices.push(Number(value));
    }

    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const span = Math.max(max - min, 0.01);
    const y = price => pad.top + ((max - price) / span) * (height - pad.top - pad.bottom);
    const x = index => pad.left + index * ((width - pad.left - pad.right) / Math.max(bars.length - 1, 1));
    const candleW = Math.max(3, Math.min(9, (width - pad.left - pad.right) / bars.length * 0.55));
    const parts = [];

    parts.push(`<rect x="0" y="0" width="${width}" height="${height}" rx="8" fill="#101419"/>`);
    const validationStart = bars.findIndex(bar => bar.time >= '09:32:00');
    if (validationStart >= 0) {
        parts.push(`<rect x="${x(validationStart) - candleW}" y="${pad.top}" width="${width - x(validationStart) + candleW}" height="${height - pad.top - pad.bottom}" fill="#17202a"/>`);
        parts.push(`<text x="${x(validationStart) + 8}" y="36" fill="#7f8fa3" font-size="11">09:32-10:00 1m validation</text>`);
    }

    const levels = [
        ['F2-H', Number(f2.high), '#ffb454'],
        ['F2-M', Number.isFinite(Number(f2.high)) && Number.isFinite(Number(f2.low)) ? (Number(f2.high) + Number(f2.low)) / 2 : NaN, '#93a4b7'],
        ['F2-L', Number(f2.low), '#4cc38a'],
    ].filter(([, value]) => Number.isFinite(value));
    for (const [label, value, color] of levels) {
        const yy = y(value);
        parts.push(`<line x1="${pad.left}" x2="${width - pad.right}" y1="${yy}" y2="${yy}" stroke="${color}" stroke-width="1" stroke-dasharray="5 5" opacity="0.82"/>`);
        parts.push(`<text x="${width - pad.right - 74}" y="${yy - 5}" fill="${color}" font-size="11">${label} ${num(value)}</text>`);
    }

    bars.forEach((bar, index) => {
        const xx = x(index);
        const up = bar.close >= bar.open;
        const color = up ? '#36c486' : '#f26464';
        parts.push(`<line x1="${xx}" x2="${xx}" y1="${y(bar.high)}" y2="${y(bar.low)}" stroke="${color}" stroke-width="1"/>`);
        const bodyY = Math.min(y(bar.open), y(bar.close));
        const bodyH = Math.max(Math.abs(y(bar.open) - y(bar.close)), 1);
        parts.push(`<rect x="${xx - candleW / 2}" y="${bodyY}" width="${candleW}" height="${bodyH}" fill="${color}" opacity="0.9"/>`);
    });

    for (const label of ['09:30:00', '09:31:00', '09:32:00', '09:45:00', '10:00:00']) {
        const index = bars.findIndex(bar => bar.time >= label);
        if (index >= 0) parts.push(`<text x="${x(index) - 18}" y="${height - 11}" fill="#7f8fa3" font-size="10">${label.slice(0, 5)}</text>`);
    }

    const candidateTime = eventTime(waitRow, 'RETEST_CANDIDATE');
    if (candidateTime) {
        const candidateIndex = findBarIndex(bars, candidateTime);
        const event = waitRow.events.find(e => e.type === 'RETEST_CANDIDATE');
        parts.push(marker(x(candidateIndex), y(event.close), '#ffcc66', 'CAND', 'diamond'));
    }

    if (immediateRow.trade) {
        const entryIndex = findBarIndex(bars, immediateRow.trade.entryTime);
        const exitIndex = findBarIndex(bars, immediateRow.trade.exitTime);
        parts.push(marker(x(entryIndex), y(immediateRow.trade.entryPrice), '#f59e0b', `IMM ${immediateRow.trade.direction}`, 'hollow'));
        parts.push(marker(x(exitIndex), y(immediateRow.trade.exitPrice), '#d97706', `IMM ${shortExit(immediateRow.trade.exitReason)}`, 'hollow'));
    }

    if (waitRow.trade) {
        const entryIndex = findBarIndex(bars, waitRow.trade.entryTime);
        const exitIndex = findBarIndex(bars, waitRow.trade.exitTime);
        const entryColor = waitRow.trade.direction === 'BUY' ? '#54d990' : '#ff6b6b';
        parts.push(marker(x(entryIndex), y(waitRow.trade.entryPrice), entryColor, `FILL ${waitRow.trade.direction}`, 'solid'));
        parts.push(marker(x(exitIndex), y(waitRow.trade.exitPrice), '#67b7ff', shortExit(waitRow.trade.exitReason), 'solid'));
    } else {
        const textY = pad.top + 22;
        const label = waitRow.phase === 'NO_FILL' ? 'NO FILL' : waitRow.phase === 'EXPIRED' ? 'EXPIRED' : 'WAIT CANCELLED';
        parts.push(`<text x="${pad.left + 10}" y="${textY}" fill="#ffcc66" font-size="13" font-weight="700">${label}</text>`);
    }

    parts.push(`<text x="${pad.left}" y="${height - 11}" fill="#b8c6d8" font-size="11">${num(min)} - ${num(max)}</text>`);
    return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img">${parts.join('')}</svg>`;
}

function marker(x, y, color, label, variant = 'solid') {
    if (variant === 'diamond') {
        return `<g><rect x="${x - 5}" y="${y - 5}" width="10" height="10" transform="rotate(45 ${x} ${y})" fill="${color}" stroke="#111827" stroke-width="1.5"/><text x="${x + 9}" y="${y - 7}" fill="${color}" font-size="11" font-weight="700">${esc(label)}</text></g>`;
    }
    const fill = variant === 'hollow' ? '#101419' : color;
    return [
        `<circle cx="${x}" cy="${y}" r="5" fill="${fill}" stroke="${color}" stroke-width="2"/>`,
        `<text x="${x + 8}" y="${y - 7}" fill="${color}" font-size="11" font-weight="700">${esc(label)}</text>`,
    ].join('');
}

function shortExit(reason = '') {
    return String(reason).replaceAll('_', ' ').replace('SCALP TARGET', 'TARGET').replace('RUNNER TRAIL', 'TRAIL').replace('HARD STOP', 'STOP');
}

function card({ waitRow, immediateRow, pack }) {
    const wait = waitRow.trade;
    const immediate = immediateRow.trade;
    const outcome = wait?.outcome || waitRow.phase;
    const tone = outcome === 'WON' ? 'win' : outcome === 'LOST' ? 'loss' : 'cancelled';
    const immediateText = immediate
        ? `Immediate: ${immediate.direction} ${immediate.entryTime}->${immediate.exitTime} ${shortExit(immediate.exitReason)} ${pct(immediate.pnlPct)}`
        : 'Immediate: no trade';
    const waitText = wait
        ? `Fill: ${wait.direction} ${wait.entryTime}->${wait.exitTime} ${shortExit(wait.exitReason)} ${pct(wait.pnlPct)}`
        : `${waitRow.phase}: ${waitRow.fill?.reason || waitRow.confirmation?.reason || ''} | MFE ${pct(waitRow.opportunityCost?.mfePct)}`;

    return `
      <article class="card ${tone}">
        <header>
          <div>
            <h2>${esc(waitRow.symbol)} ${esc(waitRow.date)}</h2>
            <p>${esc(waitText)} · ${esc(immediateText)}</p>
          </div>
          <div class="badge">${esc(outcome)}</div>
        </header>
        ${chart({ waitRow, immediateRow, pack })}
      </article>`;
}

function metric(label, value) {
    return `<div class="metric"><b>${esc(value)}</b><span>${esc(label)}</span></div>`;
}

function html({ study, waitScenario, immediateScenario, packMap, policy, fillModel, baseline, baselineFillModel }) {
    const waitMap = byKey(waitScenario.results);
    const immediateMap = byKey(immediateScenario.results);
    const rows = [...waitMap.values()];
    const cards = rows
        .map(waitRow => {
            const key = `${waitRow.symbol}|${waitRow.date}`;
            const immediateRow = immediateMap.get(key);
            const pack = packMap.get(key);
            return pack && immediateRow ? card({ waitRow, immediateRow, pack }) : '';
        })
        .join('\n');
    const s = waitScenario.summary;
    const b = immediateScenario.summary;
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Opening Wait Review</title>
  <style>
    body{margin:0;background:#0b0f14;color:#d8e2ef;font-family:Inter,Arial,sans-serif}
    main{max-width:1220px;margin:0 auto;padding:24px}
    h1{font-size:24px;margin:0 0 6px}
    .sub{color:#91a1b5;margin:0 0 18px}
    .summary{display:grid;grid-template-columns:repeat(7,1fr);gap:10px;margin-bottom:18px}
    .metric{background:#121821;border:1px solid #223044;border-radius:8px;padding:12px}
    .metric b{display:block;font-size:18px;color:#fff}
    .metric span{font-size:12px;color:#91a1b5}
    .card{background:#121821;border:1px solid #263244;border-radius:8px;margin:14px 0;padding:14px}
    .card.win{border-left:4px solid #36c486}.card.loss{border-left:4px solid #f26464}.card.cancelled{border-left:4px solid #ffcc66}
    header{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:10px}
    h2{font-size:16px;margin:0 0 4px}
    p{margin:0;color:#91a1b5;font-size:13px}
    .badge{font-size:12px;text-transform:uppercase;background:#1b2533;border:1px solid #344357;border-radius:999px;padding:6px 10px;color:#d8e2ef}
    .chart{width:100%;height:auto;display:block}
    @media(max-width:860px){main{padding:12px}.summary{grid-template-columns:repeat(2,1fr)}}
  </style>
</head>
<body>
<main>
  <h1>Opening WAIT Confirmation Review</h1>
  <p class="sub">${esc(policy)}:${esc(fillModel)} vs ${esc(baseline)}:${esc(baselineFillModel)} · ${esc(study.input)} · generated ${esc(study.generated_at)}</p>
  <section class="summary">
    ${metric('wait entries', s.entries ?? '-')}
    ${metric('confirmed', s.confirmed ?? '-')}
    ${metric('filled', s.filled ?? '-')}
    ${metric('no fill', s.noFill ?? '-')}
    ${metric('wait cancelled', s.cancelled ?? '-')}
    ${metric('wait WR', pct(s.winRate))}
    ${metric('fill rate', pct(s.fillRate))}
    ${metric('wait avg', pct(s.avgPnlPct))}
    ${metric('avg / candidate', pct(s.avgPnlPctPerCandidate))}
    ${metric('wait total', pct(s.totalPnlPct))}
    ${metric('wait stops', s.hardStops ?? '-')}
    ${metric('missed runners', s.missedRunners ?? '-')}
    ${metric('missed scalps', s.missedScalps ?? '-')}
    ${metric('no-trade MFE', pct(s.avgNoTradeMfePct))}
    ${metric('baseline total', pct(b.totalPnlPct))}
  </section>
  ${cards}
</main>
</body>
</html>`;
}

async function main() {
    const opts = parseArgs();
    const pressure = JSON.parse(await fs.readFile(opts.pressure, 'utf8'));
    const study = JSON.parse(await fs.readFile(opts.study, 'utf8'));
    const waitScenario = study.scenarios?.find(row => row.policy === opts.policy && row.fillModel === opts.fillModel);
    const immediateScenario = study.scenarios?.find(row => row.policy === opts.baseline && row.fillModel === opts.baselineFillModel);
    if (!waitScenario) throw new Error(`Scenario not found: ${opts.policy}:${opts.fillModel}`);
    if (!immediateScenario) throw new Error(`Baseline not found: ${opts.baseline}:${opts.baselineFillModel}`);
    const output = html({
        study,
        waitScenario,
        immediateScenario,
        packMap: buildPackMap(pressure),
        policy: opts.policy,
        fillModel: opts.fillModel,
        baseline: opts.baseline,
        baselineFillModel: opts.baselineFillModel,
    });
    await fs.mkdir(path.dirname(opts.out), { recursive: true });
    await fs.writeFile(opts.out, output);
    console.log(`Wrote ${opts.out}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
