#!/usr/bin/env node
/**
 * Build a static chart deck for the research-only multi-event opening scanner.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {
        pressure: 'data/pressure-pilot-2026-09-09_2026-09-15.json',
        study: 'data/opening-multi-event-study-2026-09-09_2026-09-15.json',
        out: 'webapp/opening-multi-event-review.html',
    };
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--pressure': opts.pressure = args[++i]; break;
            case '--study': opts.study = args[++i]; break;
            case '--out': opts.out = args[++i]; break;
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

function chart({ session, pack }) {
    const first2 = pack.bars?.open_first_2_min_aggregated_seconds || [];
    const validation = pack.bars?.open_aggregated_seconds || [];
    const bars = [...first2, ...validation];
    if (!bars.length) return '<svg class="chart"></svg>';

    const width = 1120;
    const height = 390;
    const pad = { left: 54, right: 26, top: 20, bottom: 34 };
    const f2 = pack.windows?.open_first_2_min || {};
    const prices = bars.flatMap(bar => [bar.high, bar.low]);
    for (const c of session.candidates || []) {
        for (const value of [c.entryCandidateClose, c.fill?.fillPrice, c.trade?.exitPrice, c.levelValue]) {
            if (Number.isFinite(Number(value))) prices.push(Number(value));
        }
    }
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const span = Math.max(max - min, 0.01);
    const y = price => pad.top + ((max - price) / span) * (height - pad.top - pad.bottom);
    const x = index => pad.left + index * ((width - pad.left - pad.right) / Math.max(bars.length - 1, 1));
    const candleW = Math.max(3, Math.min(9, (width - pad.left - pad.right) / bars.length * 0.55));
    const parts = [`<rect x="0" y="0" width="${width}" height="${height}" rx="8" fill="#101419"/>`];

    const validationStart = bars.findIndex(bar => bar.time >= '09:32:00');
    if (validationStart >= 0) {
        parts.push(`<rect x="${x(validationStart) - candleW}" y="${pad.top}" width="${width - x(validationStart) + candleW}" height="${height - pad.top - pad.bottom}" fill="#17202a"/>`);
        parts.push(`<text x="${x(validationStart) + 8}" y="36" fill="#7f8fa3" font-size="11">09:32-10:00 validation</text>`);
    }

    const levels = [
        ['F2-H', Number(f2.high), '#ffb454'],
        ['F2-M', Number.isFinite(Number(f2.high)) && Number.isFinite(Number(f2.low)) ? (Number(f2.high) + Number(f2.low)) / 2 : NaN, '#93a4b7'],
        ['F2-L', Number(f2.low), '#4cc38a'],
    ].filter(([, value]) => Number.isFinite(value));
    for (const [label, value, color] of levels) {
        const yy = y(value);
        parts.push(`<line x1="${pad.left}" x2="${width - pad.right}" y1="${yy}" y2="${yy}" stroke="${color}" stroke-width="1" stroke-dasharray="5 5" opacity="0.82"/>`);
        parts.push(`<text x="${width - pad.right - 76}" y="${yy - 5}" fill="${color}" font-size="11">${label} ${num(value)}</text>`);
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

    for (const c of session.candidates || []) {
        const candidateIndex = findBarIndex(bars, c.entryCandidateTime);
        const color = c.direction === 'BUY' ? '#54d990' : '#ff6b6b';
        parts.push(marker(x(candidateIndex), y(c.entryCandidateClose), color, `${c.candidateId} ${c.direction}`, 'diamond'));
        if (c.fill?.status === 'FILLED') {
            const fillIndex = findBarIndex(bars, c.fill.fillTime);
            parts.push(marker(x(fillIndex), y(c.fill.fillPrice), color, `${c.candidateId} FILL`, 'solid'));
        }
        if (c.trade) {
            const exitIndex = findBarIndex(bars, c.trade.exitTime);
            parts.push(marker(x(exitIndex), y(c.trade.exitPrice), '#67b7ff', `${c.candidateId} ${shortExit(c.trade.exitReason)}`, 'solid'));
        }
    }

    parts.push(`<text x="${pad.left}" y="${height - 11}" fill="#b8c6d8" font-size="11">${num(min)} - ${num(max)}</text>`);
    return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img">${parts.join('')}</svg>`;
}

function marker(x, y, color, label, variant = 'solid') {
    if (variant === 'diamond') {
        return `<g><rect x="${x - 5}" y="${y - 5}" width="10" height="10" transform="rotate(45 ${x} ${y})" fill="${color}" stroke="#111827" stroke-width="1.5"/><text x="${x + 9}" y="${y - 7}" fill="${color}" font-size="10" font-weight="700">${esc(label)}</text></g>`;
    }
    return `<g><circle cx="${x}" cy="${y}" r="5" fill="${color}" stroke="#111827" stroke-width="1.5"/><text x="${x + 8}" y="${y - 7}" fill="${color}" font-size="10" font-weight="700">${esc(label)}</text></g>`;
}

function ledgerTable(session) {
    const rows = (session.ledger || []).map(row => `
      <tr>
        <td>${esc(row.time)}</td>
        <td>${esc(row.candidateId || row.interactionCycleId || '')}</td>
        <td>${esc(row.type)}</td>
        <td>${esc(row.direction || '')}</td>
        <td>${esc(row.level || '')}</td>
        <td>${row.price == null ? '' : esc(num(row.price, 4))}</td>
        <td>${esc(row.message || '')}</td>
      </tr>`).join('');
    return `<table><thead><tr><th>Time</th><th>ID</th><th>Event</th><th>Side</th><th>Level</th><th>Price</th><th>Message</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function candidateRows(session) {
    return (session.candidates || []).map(c => {
        const result = c.trade
            ? `${shortExit(c.trade.exitReason)} ${pct(c.trade.pnlPct)}`
            : c.lifecycle;
        return `
          <tr>
            <td>${esc(c.candidateId)}</td>
            <td>${esc(c.entryCandidateTime)}</td>
            <td>${esc(c.direction)}</td>
            <td>${esc(c.triggerType)}</td>
            <td>${esc(c.level)}</td>
            <td>${num(c.separation?.maxExcursionBps)}</td>
            <td>${esc(c.confirmation?.status || '')}</td>
            <td>${esc(c.fill?.status || '')}</td>
            <td>${esc(result)}</td>
          </tr>`;
    }).join('');
}

function card({ session, pack }) {
    const s = session.summary || {};
    return `
      <article class="card">
        <header>
          <div>
            <h2>${esc(session.symbol)} ${esc(session.date)}</h2>
            <p>${s.candidates || 0} candidates · ${s.confirmed || 0} confirmed · ${s.filled || 0} filled · W/L ${s.wins || 0}/${s.losses || 0} · total ${pct(s.totalPnlPct)}</p>
          </div>
          <div class="badge">${esc(Object.entries(s.lifecycles || {}).map(([k,v]) => `${k}:${v}`).join(' · '))}</div>
        </header>
        ${chart({ session, pack })}
        <section class="candidates">
          <h3>Candidates</h3>
          <table><thead><tr><th>ID</th><th>Time</th><th>Side</th><th>Trigger</th><th>Level</th><th>Sep bps</th><th>Confirm</th><th>Fill</th><th>Result</th></tr></thead><tbody>${candidateRows(session)}</tbody></table>
        </section>
        <section class="ledger">
          <h3>Ledger</h3>
          ${ledgerTable(session)}
        </section>
      </article>`;
}

function html({ study, packMap }) {
    const cards = (study.sessions || [])
        .map(session => {
            const pack = packMap.get(`${session.symbol}|${session.date}`);
            return pack ? card({ session, pack }) : '';
        })
        .join('\n');
    const s = study.summary || {};
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Opening Multi-Event Review</title>
  <style>
    body{margin:0;background:#0b0f14;color:#d8e2ef;font-family:Inter,Arial,sans-serif}
    main{max-width:1220px;margin:0 auto;padding:24px}
    h1{font-size:24px;margin:0 0 6px}
    h2{font-size:16px;margin:0 0 4px}
    h3{font-size:14px;margin:14px 0 8px;color:#d8e2ef}
    .sub,p{color:#91a1b5;margin:0 0 18px}
    .summary{display:grid;grid-template-columns:repeat(7,1fr);gap:10px;margin-bottom:18px}
    .metric{background:#121821;border:1px solid #223044;border-radius:8px;padding:12px}
    .metric b{display:block;font-size:18px;color:#fff}
    .metric span{font-size:12px;color:#91a1b5}
    .card{background:#121821;border:1px solid #263244;border-radius:8px;margin:14px 0;padding:14px}
    header{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:10px}
    .badge{font-size:11px;background:#1b2533;border:1px solid #344357;border-radius:999px;padding:6px 10px;color:#d8e2ef;max-width:48%;line-height:1.35}
    .chart{width:100%;height:auto;display:block}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th,td{border-bottom:1px solid #253246;padding:6px 7px;text-align:left;vertical-align:top}
    th{color:#91a1b5;font-weight:600}
    @media(max-width:860px){main{padding:12px}.summary{grid-template-columns:repeat(2,1fr)}.badge{max-width:none}}
  </style>
</head>
<body>
<main>
  <h1>Opening Multi-Event Review</h1>
  <p class="sub">${esc(study.input)} · generated ${esc(study.generated_at)}</p>
  <section class="summary">
    ${metric('sessions', s.sessions ?? '-')}
    ${metric('candidates', s.candidates ?? '-')}
    ${metric('confirmed', s.confirmed ?? '-')}
    ${metric('filled', s.filled ?? '-')}
    ${metric('rejected', s.rejected ?? '-')}
    ${metric('expired', s.expired ?? '-')}
    ${metric('win rate', pct(s.winRate))}
    ${metric('total', pct(s.totalPnlPct))}
    ${metric('runners', s.runners ?? '-')}
  </section>
  ${cards}
</main>
</body>
</html>`;
}

function metric(label, value) {
    return `<div class="metric"><b>${esc(value)}</b><span>${esc(label)}</span></div>`;
}

function findBarIndex(bars, time) {
    return Math.max(0, bars.findIndex(bar => bar.time >= time));
}

function shortExit(reason = '') {
    return String(reason).replaceAll('_', ' ').replace('SCALP TARGET', 'TARGET').replace('RUNNER TRAIL', 'TRAIL').replace('HARD STOP', 'STOP');
}

function pct(value) {
    return Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(2)}%` : '-';
}

function num(value, digits = 2) {
    return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '-';
}

function esc(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

async function main() {
    const opts = parseArgs();
    const pressure = JSON.parse(await fs.readFile(opts.pressure, 'utf8'));
    const study = JSON.parse(await fs.readFile(opts.study, 'utf8'));
    const output = html({ study, packMap: buildPackMap(pressure) });
    await fs.mkdir(path.dirname(opts.out), { recursive: true });
    await fs.writeFile(opts.out, output);
    console.log(`Wrote ${opts.out}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
