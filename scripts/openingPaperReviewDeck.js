#!/usr/bin/env node
/**
 * Build a static chart deck for opening sniper paper replay review.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {
        pressure: 'data/pressure-pilot-2026-09-09_2026-09-15.json',
        paper: 'data/opening-sniper-paper-2026-09-09_2026-09-15.json',
        out: 'webapp/opening-paper-review.html',
    };
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--pressure': opts.pressure = args[++i]; break;
            case '--paper': opts.paper = args[++i]; break;
            case '--out': opts.out = args[++i]; break;
        }
    }
    return opts;
}

function num(value, digits = 2) {
    return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '-';
}

function pct(value) {
    return Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(2)}%` : '-';
}

function esc(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

function timeToSeconds(time) {
    const [hh = 0, mm = 0, ss = 0] = String(time).split(':').map(Number);
    return hh * 3600 + mm * 60 + ss;
}

function buildPackMap(pressure) {
    const map = new Map();
    for (const symbolPack of pressure.results || []) {
        for (const pack of symbolPack.packs || []) map.set(`${pack.symbol}|${pack.date}`, pack);
    }
    return map;
}

function candleChart(row, pack) {
    const first2 = pack.bars?.open_first_2_min_aggregated_seconds || [];
    const validation = pack.bars?.open_aggregated_seconds || [];
    const bars = [...first2, ...validation.slice(0, 15)];
    if (!bars.length) return '<svg class="chart"></svg>';

    const width = 1040;
    const height = 330;
    const pad = { left: 52, right: 24, top: 18, bottom: 28 };
    const prices = bars.flatMap(bar => [bar.high, bar.low]);
    const f2 = pack.windows?.open_first_2_min || {};
    for (const value of [f2.high, f2.low, row.trade?.entryPrice, row.trade?.exitPrice]) {
        if (Number.isFinite(Number(value))) prices.push(Number(value));
    }
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const span = Math.max(max - min, 0.01);
    const y = price => pad.top + ((max - price) / span) * (height - pad.top - pad.bottom);
    const x = index => pad.left + index * ((width - pad.left - pad.right) / Math.max(bars.length - 1, 1));
    const candleW = Math.max(3, Math.min(10, (width - pad.left - pad.right) / bars.length * 0.55));
    const regularStart = bars.findIndex(bar => bar.time >= '09:32:00');

    const chartParts = [];
    chartParts.push(`<rect x="0" y="0" width="${width}" height="${height}" rx="8" fill="#101419"/>`);
    if (regularStart >= 0) {
        chartParts.push(`<rect x="${x(regularStart) - candleW}" y="${pad.top}" width="${width - x(regularStart) + candleW}" height="${height - pad.top - pad.bottom}" fill="#17202a"/>`);
        chartParts.push(`<text x="${x(regularStart) + 8}" y="34" fill="#7f8fa3" font-size="11">09:32+ validation</text>`);
    }

    const levels = [
        ['F2-H', Number(f2.high), '#ffb454'],
        ['F2-M', Number.isFinite(Number(f2.high)) && Number.isFinite(Number(f2.low)) ? (Number(f2.high) + Number(f2.low)) / 2 : NaN, '#93a4b7'],
        ['F2-L', Number(f2.low), '#4cc38a'],
    ].filter(([, value]) => Number.isFinite(value));
    for (const [label, value, color] of levels) {
        const yy = y(value);
        chartParts.push(`<line x1="${pad.left}" x2="${width - pad.right}" y1="${yy}" y2="${yy}" stroke="${color}" stroke-width="1" stroke-dasharray="5 5" opacity="0.8"/>`);
        chartParts.push(`<text x="${width - pad.right - 64}" y="${yy - 5}" fill="${color}" font-size="11">${label} ${num(value)}</text>`);
    }

    bars.forEach((bar, index) => {
        const xx = x(index);
        const up = bar.close >= bar.open;
        const color = up ? '#36c486' : '#f26464';
        chartParts.push(`<line x1="${xx}" x2="${xx}" y1="${y(bar.high)}" y2="${y(bar.low)}" stroke="${color}" stroke-width="1"/>`);
        const bodyY = Math.min(y(bar.open), y(bar.close));
        const bodyH = Math.max(Math.abs(y(bar.open) - y(bar.close)), 1);
        chartParts.push(`<rect x="${xx - candleW / 2}" y="${bodyY}" width="${candleW}" height="${bodyH}" fill="${color}" opacity="0.9"/>`);
    });

    for (const label of ['09:30:00', '09:31:00', '09:32:00']) {
        const index = bars.findIndex(bar => bar.time >= label);
        if (index >= 0) {
            chartParts.push(`<text x="${x(index) - 18}" y="${height - 9}" fill="#7f8fa3" font-size="10">${label.slice(0, 5)}</text>`);
        }
    }

    if (row.trade) {
        const entryIndex = Math.max(0, bars.findIndex(bar => bar.time >= row.trade.entryTime));
        const exitIndex = Math.max(0, bars.findIndex(bar => bar.time >= row.trade.exitTime));
        const entryColor = row.trade.direction === 'BUY' ? '#54d990' : '#ff6b6b';
        chartParts.push(marker(x(entryIndex), y(row.trade.entryPrice), entryColor, row.trade.direction === 'BUY' ? 'BUY' : 'SELL'));
        chartParts.push(marker(x(exitIndex), y(row.trade.exitPrice), '#67b7ff', row.trade.exitReason.replaceAll('_', ' ')));
    } else {
        const block = row.events?.find(event => event.type === 'PAPER_BLOCK');
        if (block) chartParts.push(`<text x="${pad.left + 10}" y="${pad.top + 22}" fill="#ffcc66" font-size="13">BLOCKED: ${esc(block.direction)} vs ${esc(block.localBias)}</text>`);
    }

    chartParts.push(`<text x="${pad.left}" y="${height - 9}" fill="#b8c6d8" font-size="11">${num(min)} - ${num(max)}</text>`);
    return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img">${chartParts.join('')}</svg>`;
}

function marker(x, y, color, label) {
    return [
        `<circle cx="${x}" cy="${y}" r="5" fill="${color}" stroke="#fff" stroke-width="1.5"/>`,
        `<text x="${x + 8}" y="${y - 7}" fill="${color}" font-size="11" font-weight="700">${esc(label)}</text>`,
    ].join('');
}

function card(row, pack) {
    const trade = row.trade;
    const outcome = trade?.outcome || row.phase;
    const tone = outcome === 'WON' ? 'win' : outcome === 'LOST' ? 'loss' : row.phase === 'BLOCKED' ? 'blocked' : 'neutral';
    const details = trade
        ? `${trade.direction} ${trade.entryTime} -> ${trade.exitTime} · ${trade.exitReason.replaceAll('_', ' ')} · ${pct(trade.pnlPct)}`
        : `No trade · ${row.phase}`;
    return `
      <article class="card ${tone}">
        <header>
          <div>
            <h2>${esc(row.symbol)} ${esc(row.date)}</h2>
            <p>${esc(details)}</p>
          </div>
          <div class="badge">${esc(outcome)}</div>
        </header>
        ${candleChart(row, pack)}
      </article>`;
}

function html(paper, packMap) {
    const summary = paper.summary || {};
    const cards = (paper.results || [])
        .map(row => card(row, packMap.get(`${row.symbol}|${row.date}`)))
        .join('\n');
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Opening Paper Review</title>
  <style>
    body{margin:0;background:#0b0f14;color:#d8e2ef;font-family:Inter,Arial,sans-serif}
    main{max-width:1180px;margin:0 auto;padding:24px}
    h1{font-size:24px;margin:0 0 6px}
    .sub{color:#91a1b5;margin:0 0 18px}
    .summary{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:18px}
    .metric{background:#121821;border:1px solid #223044;border-radius:8px;padding:12px}
    .metric b{display:block;font-size:18px;color:#fff}
    .metric span{font-size:12px;color:#91a1b5}
    .card{background:#121821;border:1px solid #263244;border-radius:8px;margin:14px 0;padding:14px}
    .card.win{border-left:4px solid #36c486}.card.loss{border-left:4px solid #f26464}.card.blocked{border-left:4px solid #ffcc66}
    header{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:10px}
    h2{font-size:16px;margin:0 0 4px}
    p{margin:0;color:#91a1b5;font-size:13px}
    .badge{font-size:12px;text-transform:uppercase;background:#1b2533;border:1px solid #344357;border-radius:999px;padding:6px 10px;color:#d8e2ef}
    .chart{width:100%;height:auto;display:block}
    @media(max-width:760px){main{padding:12px}.summary{grid-template-columns:repeat(2,1fr)}}
  </style>
</head>
<body>
<main>
  <h1>Opening Sniper Paper Review</h1>
  <p class="sub">${esc(paper.input)} · generated ${esc(paper.generated_at)} · historical 2-second replay</p>
  <section class="summary">
    <div class="metric"><b>${summary.sessions ?? '-'}</b><span>sessions</span></div>
    <div class="metric"><b>${summary.paperEntries ?? '-'}</b><span>entries</span></div>
    <div class="metric"><b>${summary.blocked ?? '-'}</b><span>blocked</span></div>
    <div class="metric"><b>${summary.runners ?? '-'}</b><span>runners</span></div>
    <div class="metric"><b>${pct(summary.winRate)}</b><span>win rate</span></div>
    <div class="metric"><b>${pct(summary.avgPnlPct)}</b><span>avg gross</span></div>
  </section>
  ${cards}
</main>
</body>
</html>`;
}

async function main() {
    const opts = parseArgs();
    const pressure = JSON.parse(await fs.readFile(opts.pressure, 'utf8'));
    const paper = JSON.parse(await fs.readFile(opts.paper, 'utf8'));
    const output = html(paper, buildPackMap(pressure));
    await fs.mkdir(path.dirname(opts.out), { recursive: true });
    await fs.writeFile(opts.out, output);
    console.log(`Wrote ${opts.out}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
