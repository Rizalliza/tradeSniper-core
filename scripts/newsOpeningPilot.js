#!/usr/bin/env node
/**
 * Research-only pilot for first-Friday/news-style openings.
 *
 * Hypothesis:
 *   A news release can spike one way first, then reverse hard into the true
 *   opening direction. This script marks that sequence on a close-up second
 *   chart without changing production Sniper logic.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { MassiveData } from '../src/data/MassiveData.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    symbol: 'MSFT',
    date: '2026-01-02',
    minutes: 5,
    impulseSeconds: 20,
    leapPct: 0.003,
    retestBufferPct: 0.0008,
    outDir: 'newsOpening',
  };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--symbol': opts.symbol = args[++i].toUpperCase(); break;
      case '--date': opts.date = args[++i]; break;
      case '--minutes': opts.minutes = Number(args[++i]); break;
      case '--impulse-seconds': opts.impulseSeconds = Number(args[++i]); break;
      case '--leap-pct': opts.leapPct = Number(args[++i]); break;
      case '--retest-buffer-pct': opts.retestBufferPct = Number(args[++i]); break;
      case '--out-dir': opts.outDir = args[++i]; break;
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

function pct(value, digits = 2) {
  return Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(digits)}%` : '-';
}

function num(value, digits = 2) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '-';
}

function addSeconds(time, seconds) {
  const [hour, minute, second = '00'] = time.split(':').map(Number);
  const date = new Date(Date.UTC(2000, 0, 1, hour, minute, second + seconds));
  return date.toISOString().slice(11, 19);
}

function inWindow(bars, start, seconds) {
  const end = addSeconds(start, seconds);
  return bars.filter(bar => bar.time >= start && bar.time < end);
}

function barMid(bar) {
  return (Number(bar.high) + Number(bar.low)) / 2;
}

function normalizeBars(bars) {
  return bars
    .filter(bar => bar.time >= '09:30:00' && bar.time < '16:00:00')
    .map(bar => ({
      ...bar,
      open: Number(bar.open),
      high: Number(bar.high),
      low: Number(bar.low),
      close: Number(bar.close),
      volume: Number(bar.volume) || 0,
    }))
    .sort((a, b) => a.time.localeCompare(b.time));
}

function classifyNewsOpening(bars, opts) {
  const open = bars[0]?.open;
  if (!Number.isFinite(open)) throw new Error('No opening price available');

  const chartEnd = addSeconds('09:30:00', opts.minutes * 60);
  const chartBars = bars.filter(bar => bar.time >= '09:30:00' && bar.time < chartEnd);
  const impulseBars = inWindow(chartBars, '09:30:00', opts.impulseSeconds);
  if (chartBars.length < 2 || impulseBars.length < 2) throw new Error('Not enough bars for pilot');

  let highBar = impulseBars[0];
  let lowBar = impulseBars[0];
  for (const bar of impulseBars) {
    if (bar.high > highBar.high) highBar = bar;
    if (bar.low < lowBar.low) lowBar = bar;
  }

  const upExcursionPct = (highBar.high - open) / open;
  const downExcursionPct = (open - lowBar.low) / open;
  const initialDirection = upExcursionPct >= downExcursionPct ? 'BUY' : 'SELL';
  const initialExtreme = initialDirection === 'BUY'
    ? { time: highBar.time, price: highBar.high, pct: upExcursionPct }
    : { time: lowBar.time, price: lowBar.low, pct: downExcursionPct };

  const last = chartBars[chartBars.length - 1];
  const netPct = (last.close - open) / open;
  const releaseDirection = netPct >= 0 ? 'BUY' : 'SELL';
  const hasWideLeap = initialExtreme.pct >= opts.leapPct;

  const reversalLevel = open;
  const reversalIndex = chartBars.findIndex((bar) => {
    if (bar.time <= initialExtreme.time) return false;
    return releaseDirection === 'BUY'
      ? bar.close >= reversalLevel
      : bar.close <= reversalLevel;
  });
  const reversalBar = reversalIndex >= 0 ? chartBars[reversalIndex] : null;

  let retestBar = null;
  if (reversalBar) {
    const minDistance = Math.max(open * opts.retestBufferPct, 0.01);
    for (let i = reversalIndex + 1; i < chartBars.length; i++) {
      const bar = chartBars[i];
      const touched = releaseDirection === 'BUY'
        ? bar.low <= reversalLevel + minDistance && bar.close >= reversalLevel
        : bar.high >= reversalLevel - minDistance && bar.close <= reversalLevel;
      if (touched) {
        retestBar = bar;
        break;
      }
    }
  }

  let favorableExtreme = reversalBar || chartBars[0];
  if (reversalBar) {
    for (let i = reversalIndex; i < chartBars.length; i++) {
      const bar = chartBars[i];
      if (releaseDirection === 'BUY' && bar.high > favorableExtreme.high) favorableExtreme = bar;
      if (releaseDirection === 'SELL' && bar.low < favorableExtreme.low) favorableExtreme = bar;
    }
  }

  const entryPrice = reversalBar?.close ?? null;
  const exitPrice = releaseDirection === 'BUY' ? favorableExtreme.high : favorableExtreme.low;
  const researchPnlPct = entryPrice
    ? (releaseDirection === 'BUY' ? (exitPrice - entryPrice) / entryPrice : (entryPrice - exitPrice) / entryPrice)
    : null;

  const events = [
    {
      type: 'OPEN',
      time: chartBars[0].time,
      price: open,
      label: `OPEN ${num(open)}`,
    },
    {
      type: 'INITIAL_LEAP',
      direction: initialDirection,
      time: initialExtreme.time,
      price: initialExtreme.price,
      pct: initialExtreme.pct,
      label: `LEAP ${initialDirection} ${pct(initialExtreme.pct)}`,
    },
  ];

  if (reversalBar) {
    events.push({
      type: 'REVERSAL_ENTRY_CANDIDATE',
      direction: releaseDirection,
      time: reversalBar.time,
      price: reversalBar.close,
      label: `REV ${releaseDirection}`,
    });
  }
  if (retestBar) {
    events.push({
      type: 'QUICK_RETEST',
      direction: releaseDirection,
      time: retestBar.time,
      price: releaseDirection === 'BUY' ? retestBar.low : retestBar.high,
      label: 'QUICK RETEST',
    });
  }
  if (reversalBar) {
    events.push({
      type: 'FAVORABLE_LEAP_EXIT_STUDY',
      direction: releaseDirection,
      time: favorableExtreme.time,
      price: exitPrice,
      pnlPct: researchPnlPct,
      label: `EXIT STUDY ${pct(researchPnlPct)}`,
    });
  }

  return {
    symbol: opts.symbol,
    date: opts.date,
    config: {
      minutes: opts.minutes,
      impulseSeconds: opts.impulseSeconds,
      leapPct: opts.leapPct,
      retestBufferPct: opts.retestBufferPct,
    },
    openingPrice: open,
    hasWideLeap,
    initialDirection,
    releaseDirection,
    initialExtreme,
    netMovePct: netPct,
    reversalCandidate: reversalBar ? {
      time: reversalBar.time,
      price: reversalBar.close,
      direction: releaseDirection,
      secondsFromOpen: timeToSecond(reversalBar.time) - timeToSecond('09:30:00'),
    } : null,
    quickRetest: retestBar ? {
      time: retestBar.time,
      price: releaseDirection === 'BUY' ? retestBar.low : retestBar.high,
      direction: releaseDirection,
      secondsFromOpen: timeToSecond(retestBar.time) - timeToSecond('09:30:00'),
    } : null,
    researchExit: reversalBar ? {
      time: favorableExtreme.time,
      price: exitPrice,
      pnlPct: researchPnlPct,
      reason: 'FAVORABLE_LEAP_EXTREME_WITH_LOOKAHEAD_FOR_REVIEW',
    } : null,
    events,
    bars: chartBars,
  };
}

function timeToSecond(time) {
  const [h, m, s = '0'] = time.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

function renderChart(study) {
  const bars = study.bars;
  const width = 1180;
  const height = 520;
  const pad = { left: 62, right: 28, top: 32, bottom: 46 };
  const prices = bars.flatMap(bar => [bar.high, bar.low, bar.open, bar.close]);
  for (const event of study.events) prices.push(event.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = Math.max(max - min, 0.01);
  const y = price => pad.top + ((max - price) / span) * (height - pad.top - pad.bottom);
  const x = index => pad.left + index * ((width - pad.left - pad.right) / Math.max(bars.length - 1, 1));
  const indexForTime = time => Math.max(0, bars.findIndex(bar => bar.time >= time));
  const candleW = Math.max(1.4, Math.min(5.5, (width - pad.left - pad.right) / bars.length * 0.56));
  const parts = [];

  parts.push(`<rect x="0" y="0" width="${width}" height="${height}" rx="8" fill="#101419"/>`);
  parts.push(`<line x1="${pad.left}" x2="${width - pad.right}" y1="${y(study.openingPrice)}" y2="${y(study.openingPrice)}" stroke="#e8edf5" stroke-width="1" stroke-dasharray="5 5" opacity="0.75"/>`);
  parts.push(`<text x="${width - pad.right - 90}" y="${y(study.openingPrice) - 6}" fill="#e8edf5" font-size="11">OPEN ${num(study.openingPrice)}</text>`);

  for (const label of ['09:30:00', '09:31:00', '09:32:00', '09:33:00', '09:34:00', '09:35:00']) {
    const idx = bars.findIndex(bar => bar.time >= label);
    if (idx >= 0) {
      const xx = x(idx);
      parts.push(`<line x1="${xx}" x2="${xx}" y1="${pad.top}" y2="${height - pad.bottom}" stroke="#253246" stroke-width="1" opacity="0.7"/>`);
      parts.push(`<text x="${xx - 17}" y="${height - 16}" fill="#91a1b5" font-size="10">${label.slice(0, 5)}</text>`);
    }
  }

  const impulseEnd = addSeconds('09:30:00', study.config.impulseSeconds);
  const impulseIdx = indexForTime(impulseEnd);
  parts.push(`<rect x="${pad.left}" y="${pad.top}" width="${x(impulseIdx) - pad.left}" height="${height - pad.top - pad.bottom}" fill="#ffcc66" opacity="0.055"/>`);
  parts.push(`<text x="${pad.left + 8}" y="${pad.top + 16}" fill="#ffcc66" font-size="11">initial impulse</text>`);

  bars.forEach((bar, index) => {
    const xx = x(index);
    const up = bar.close >= bar.open;
    const color = up ? '#36c486' : '#f26464';
    parts.push(`<line x1="${xx}" x2="${xx}" y1="${y(bar.high)}" y2="${y(bar.low)}" stroke="${color}" stroke-width="1" opacity="0.88"/>`);
    const bodyY = Math.min(y(bar.open), y(bar.close));
    const bodyH = Math.max(Math.abs(y(bar.open) - y(bar.close)), 1);
    parts.push(`<rect x="${xx - candleW / 2}" y="${bodyY}" width="${candleW}" height="${bodyH}" fill="${color}" opacity="0.9"/>`);
  });

  for (const event of study.events) {
    const idx = indexForTime(event.time);
    const color = colorForEvent(event);
    parts.push(marker(x(idx), y(event.price), color, event.label, event.type === 'INITIAL_LEAP' ? 'diamond' : 'circle'));
  }

  parts.push(`<text x="${pad.left}" y="${height - 16}" fill="#b8c6d8" font-size="11">${num(min)} - ${num(max)}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" class="chart" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">${parts.join('')}</svg>`;
}

function colorForEvent(event) {
  if (event.type === 'INITIAL_LEAP') return event.direction === 'BUY' ? '#00ff88' : '#ff3355';
  if (event.type === 'REVERSAL_ENTRY_CANDIDATE') return event.direction === 'BUY' ? '#54d990' : '#ff6b6b';
  if (event.type === 'QUICK_RETEST') return '#ffcc66';
  if (event.type === 'FAVORABLE_LEAP_EXIT_STUDY') return '#67b7ff';
  return '#e8edf5';
}

function marker(x, y, color, label, shape) {
  const safe = esc(label);
  const labelLeft = x > 1000;
  const textX = labelLeft ? x - 10 : x + 10;
  const anchor = labelLeft ? 'end' : 'start';
  if (shape === 'diamond') {
    return `<g><rect x="${x - 6}" y="${y - 6}" width="12" height="12" transform="rotate(45 ${x} ${y})" fill="${color}" stroke="#111827" stroke-width="1.5"/><text x="${textX}" y="${y - 8}" text-anchor="${anchor}" fill="${color}" font-size="11" font-weight="700">${safe}</text></g>`;
  }
  return `<g><circle cx="${x}" cy="${y}" r="5" fill="${color}" stroke="#111827" stroke-width="1.5"/><text x="${textX}" y="${y - 7}" text-anchor="${anchor}" fill="${color}" font-size="11" font-weight="700">${safe}</text></g>`;
}

function renderHtml(study) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>News Opening Pilot - ${esc(study.symbol)} ${esc(study.date)}</title>
  <style>
    body{margin:0;background:#0b0f14;color:#d8e2ef;font-family:Inter,Arial,sans-serif}
    main{max-width:1240px;margin:0 auto;padding:24px}
    h1{font-size:24px;margin:0 0 6px}
    p{margin:0;color:#91a1b5}
    .summary{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin:18px 0}
    .metric{background:#121821;border:1px solid #223044;border-radius:8px;padding:12px}
    .metric b{display:block;font-size:17px;color:#fff}
    .metric span{font-size:12px;color:#91a1b5}
    .panel{background:#121821;border:1px solid #263244;border-radius:8px;padding:14px}
    .chart{width:100%;height:auto;display:block}
    table{width:100%;border-collapse:collapse;font-size:12px;margin-top:14px}
    th,td{border-bottom:1px solid #253246;padding:7px;text-align:left}
    th{color:#91a1b5}
    @media(max-width:860px){main{padding:12px}.summary{grid-template-columns:repeat(2,1fr)}}
  </style>
</head>
<body>
<main>
  <h1>News Opening Pilot: ${esc(study.symbol)} ${esc(study.date)}</h1>
  <p>Research-only wide-leap/reversal chart. Exit marker uses lookahead for visual review, not live execution.</p>
  <section class="summary">
    ${metric('initial leap', `${study.initialDirection} ${pct(study.initialExtreme.pct)}`)}
    ${metric('release direction', `${study.releaseDirection} ${pct(study.netMovePct)}`)}
    ${metric('wide leap?', study.hasWideLeap ? 'YES' : 'NO')}
    ${metric('reversal', study.reversalCandidate ? `${study.reversalCandidate.time} ${num(study.reversalCandidate.price)}` : 'NONE')}
    ${metric('quick retest', study.quickRetest ? `${study.quickRetest.time} ${num(study.quickRetest.price)}` : 'NONE')}
    ${metric('study exit', study.researchExit ? `${study.researchExit.time} ${pct(study.researchExit.pnlPct)}` : 'NONE')}
  </section>
  <section class="panel">
    ${renderChart(study)}
    <table>
      <thead><tr><th>Time</th><th>Event</th><th>Side</th><th>Price</th><th>Notes</th></tr></thead>
      <tbody>
        ${study.events.map(event => `<tr><td>${esc(event.time)}</td><td>${esc(event.type)}</td><td>${esc(event.direction || '')}</td><td>${num(event.price, 4)}</td><td>${esc(event.label)}</td></tr>`).join('')}
      </tbody>
    </table>
  </section>
</main>
</body>
</html>`;
}

function metric(label, value) {
  return `<div class="metric"><b>${esc(value)}</b><span>${esc(label)}</span></div>`;
}

async function main() {
  const opts = parseArgs();
  const apiKey = process.env.MASSIVE_API_KEY;
  if (!apiKey) throw new Error('MASSIVE_API_KEY environment variable not set');

  const massive = new MassiveData({ apiKey });
  const bars = normalizeBars(await massive.fetchSecondBars(opts.symbol, opts.date, opts.date));
  const study = classifyNewsOpening(bars, opts);
  const stem = `${opts.symbol}-${opts.date}`;
  const dataDir = path.join(opts.outDir, 'data');
  const chartDir = path.join(opts.outDir, 'charts');
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(chartDir, { recursive: true });

  const jsonPath = path.join(dataDir, `${stem}.json`);
  const htmlPath = path.join(chartDir, `${stem}.html`);
  const svgPath = path.join(chartDir, `${stem}.svg`);
  await fs.writeFile(jsonPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    source: 'Massive second aggregates',
    ...study,
  }, null, 2) + '\n');
  await fs.writeFile(svgPath, renderChart(study));
  await fs.writeFile(htmlPath, renderHtml(study));

  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${svgPath}`);
  console.log(`Wrote ${htmlPath}`);
  console.log(`${opts.symbol} ${opts.date}: initial=${study.initialDirection} ${pct(study.initialExtreme.pct)}, release=${study.releaseDirection} ${pct(study.netMovePct)}, reversal=${study.reversalCandidate?.time || 'NONE'}, retest=${study.quickRetest?.time || 'NONE'}, studyExit=${study.researchExit ? `${study.researchExit.time} ${pct(study.researchExit.pnlPct)}` : 'NONE'}`);
}

main().catch(err => {
  console.error(`newsOpeningPilot failed: ${err.message}`);
  process.exit(1);
});
