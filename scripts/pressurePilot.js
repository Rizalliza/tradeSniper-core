#!/usr/bin/env node
/**
 * One-week pressure pilot collector.
 *
 * Collects a compact pre-open pressure pack for a short symbol basket:
 * - prior session late regular close and after-hours
 * - current premarket
 * - first 2 opening minutes
 * - 09:32-10:00 opening validation window
 * - daily/weekly/monthly marker context
 *
 * Usage:
 *   node -r dotenv/config scripts/pressurePilot.js --from 2026-09-09 --to 2026-09-15 --symbols AAPL,MSFT,NVDA,TSLA
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { MassiveData } from '../src/data/MassiveData.js';
import { MarkerService } from '../src/market/MarkerService.js';
import { BarLoader } from '../src/market/BarLoader.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    from: '2026-09-09',
    to: '2026-09-15',
    symbols: ['AAPL', 'MSFT', 'NVDA', 'TSLA'],
    lookbackDays: 60,
    aggregateSeconds: 10,
    first2AggregateSeconds: null,
    validationAggregateSeconds: null,
    cacheDir: 'data/massive_cache/rest',
    out: null,
    noCache: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--from': opts.from = args[++i]; break;
      case '--to': opts.to = args[++i]; break;
      case '--symbols':
        opts.symbols = args[++i].split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
        break;
      case '--lookback-days': opts.lookbackDays = parseInt(args[++i], 10); break;
      case '--aggregate-seconds': opts.aggregateSeconds = parseInt(args[++i], 10); break;
      case '--first2-aggregate-seconds': opts.first2AggregateSeconds = parseInt(args[++i], 10); break;
      case '--validation-aggregate-seconds': opts.validationAggregateSeconds = parseInt(args[++i], 10); break;
      case '--cache-dir': opts.cacheDir = args[++i]; break;
      case '--out': opts.out = args[++i]; break;
      case '--no-cache': opts.noCache = true; break;
    }
  }

  opts.out ||= `data/pressure-pilot-${opts.from}_${opts.to}.json`;
  opts.first2AggregateSeconds ||= opts.aggregateSeconds;
  opts.validationAggregateSeconds ||= opts.aggregateSeconds;
  return opts;
}

const opts = parseArgs();
const massive = new MassiveData({ apiKey: process.env.MASSIVE_API_KEY });

function parseDateUTC(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(dateStr, days) {
  const d = parseDateUTC(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function cachePath(symbol, multiplier, timespan, from, to) {
  return path.join(opts.cacheDir, symbol, timespan, `${multiplier}_${from}_${to}.json`);
}

async function fetchCachedAggregates(symbol, multiplier, timespan, from, to, limit = 50000) {
  const filePath = cachePath(symbol, multiplier, timespan, from, to);
  if (!opts.noCache) {
    try {
      const cached = JSON.parse(await fs.readFile(filePath, 'utf8'));
      return { bars: cached.bars || [], source: 'cache' };
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  const bars = await massive.fetchAggregates(symbol, multiplier, timespan, from, to, limit);
  if (!opts.noCache) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({
      source: 'Massive REST',
      endpoint: `/v2/aggs/ticker/${symbol}/range/${multiplier}/${timespan}/${from}/${to}`,
      generated_at: new Date().toISOString(),
      symbol,
      multiplier,
      timespan,
      from,
      to,
      count: bars.length,
      bars,
    }, null, 2) + '\n');
  }
  return { bars, source: 'network' };
}

function byDate(bars) {
  const map = new Map();
  for (const bar of bars) {
    if (!map.has(bar.date)) map.set(bar.date, []);
    map.get(bar.date).push(bar);
  }
  for (const dayBars of map.values()) dayBars.sort((a, b) => a.time.localeCompare(b.time));
  return map;
}

function between(bars, start, end) {
  return bars.filter(b => b.time >= start && b.time < end);
}

function summarizeBars(bars) {
  if (!bars.length) {
    return {
      count: 0,
      first_time: null,
      last_time: null,
      open: null,
      close: null,
      high: null,
      low: null,
      volume: 0,
      change_pct: null,
      range_pct: null,
      close_position: null,
    };
  }

  const open = bars[0].open;
  const close = bars[bars.length - 1].close;
  const high = Math.max(...bars.map(b => b.high));
  const low = Math.min(...bars.map(b => b.low));
  const range = high - low;

  return {
    count: bars.length,
    first_time: bars[0].time,
    last_time: bars[bars.length - 1].time,
    open,
    close,
    high,
    low,
    volume: bars.reduce((sum, b) => sum + (b.volume || 0), 0),
    change_pct: open ? (close - open) / open : null,
    range_pct: open ? range / open : null,
    close_position: range ? (close - low) / range : 0.5,
  };
}

function pctFrom(price, reference) {
  if (!price || !reference) return null;
  return (price - reference) / reference;
}

function bps(value) {
  return value == null ? 0 : value * 10000;
}

function pressureScore({ priorClose, afterHours, premarket, openFirst2 }) {
  const afterHoursBps = bps(pctFrom(afterHours.close, priorClose));
  const premarketBps = bps(pctFrom(premarket.close, priorClose));
  const gapBps = bps(pctFrom(openFirst2.open, priorClose));
  const first2Bps = bps(openFirst2.change_pct);
  const positionBps = ((premarket.close_position ?? 0.5) - 0.5) * 100;

  const score =
    gapBps * 0.30 +
    premarketBps * 0.30 +
    afterHoursBps * 0.15 +
    positionBps * 0.15 +
    first2Bps * 0.10;

  const volatile = Math.abs(gapBps) >= 250 || bps(premarket.range_pct) >= 250;
  let label = 'NEUTRAL';
  if (score >= 25) label = 'BULLISH';
  if (score <= -25) label = 'BEARISH';
  if (volatile && Math.abs(score) < 50) label = 'UNSTABLE';

  return {
    label,
    score,
    components_bps: {
      gap: gapBps,
      premarket: premarketBps,
      after_hours: afterHoursBps,
      premarket_close_position: positionBps,
      first_2_min: first2Bps,
    },
    flags: {
      volatile_gap: Math.abs(gapBps) >= 250,
      wide_premarket_range: bps(premarket.range_pct) >= 250,
      no_after_hours: afterHours.count === 0,
      no_premarket: premarket.count === 0,
    },
  };
}

function dailyToMarkerBars(bars) {
  return bars.map(b => ({ date: b.date, o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume }));
}

async function collectSymbol(symbol) {
  const markerFrom = addDays(opts.from, -opts.lookbackDays);
  const prevFetchFrom = addDays(opts.from, -5);
  const dailyFetch = await fetchCachedAggregates(symbol, 1, 'day', markerFrom, opts.to, 500);
  const minuteFetch = await fetchCachedAggregates(symbol, 1, 'minute', prevFetchFrom, opts.to, 50000);
  const secondFetch = await fetchCachedAggregates(symbol, 1, 'second', opts.from, opts.to, 100000);

  const dailyBars = dailyToMarkerBars(dailyFetch.bars);
  const minuteByDate = byDate(minuteFetch.bars);
  const secondByDate = byDate(secondFetch.bars);
  const tradingDays = dailyBars.filter(b => b.date >= opts.from && b.date <= opts.to);
  const packs = [];

  for (const day of tradingDays) {
    const di = dailyBars.findIndex(b => b.date === day.date);
    if (di < 1) continue;

    const prevDay = dailyBars[di - 1];
    const prevMinuteBars = minuteByDate.get(prevDay.date) || [];
    const currMinuteBars = minuteByDate.get(day.date) || [];
    const currSecondBars = secondByDate.get(day.date) || [];

    const priorClose = prevDay.c;
    const lateRegular = summarizeBars(between(prevMinuteBars, '15:30:00', '16:00:00'));
    const afterHours = summarizeBars(between(prevMinuteBars, '16:00:00', '20:00:00'));
    const premarket = summarizeBars(between(currMinuteBars, '04:00:00', '09:30:00'));
    const openFirst2 = summarizeBars(between(currSecondBars, '09:30:00', '09:32:00'));
    const openFirst2Raw = between(currSecondBars, '09:30:00', '09:32:00');
    const openFirst2Aggregated = BarLoader.aggregate(openFirst2Raw, opts.first2AggregateSeconds, 'second');
    const openValidationRaw = between(currSecondBars, '09:32:00', '10:00:00');
    const openValidation = summarizeBars(openValidationRaw);
    const openValidationAggregated = BarLoader.aggregate(openValidationRaw, opts.validationAggregateSeconds, 'second');
    const markers = MarkerService.compute(dailyBars, di);

    packs.push({
      symbol,
      date: day.date,
      prior_session_date: prevDay.date,
      prior_close: priorClose,
      markers,
      marker_list: MarkerService.buildList(markers),
      windows: {
        prior_late_regular: lateRegular,
        prior_after_hours: afterHours,
        premarket,
        open_first_2_min: openFirst2,
        open_09_32_to_10_00: openValidation,
      },
      pressure: pressureScore({ priorClose, afterHours, premarket, openFirst2 }),
      bars: {
        open_first_2_min_aggregated_seconds: openFirst2Aggregated,
        open_aggregated_seconds: openValidationAggregated,
      },
    });
  }

  return {
    symbol,
    sources: {
      daily: dailyFetch.source,
      minute: minuteFetch.source,
      second: secondFetch.source,
    },
    packs,
  };
}

function compactPack(pack) {
  const { bars, ...rest } = pack;
  return {
    ...rest,
    bars: {
      open_first_2_min_aggregated_seconds_count: bars.open_first_2_min_aggregated_seconds?.length || 0,
      open_aggregated_seconds_count: bars.open_aggregated_seconds.length,
    },
  };
}

async function main() {
  if (!process.env.MASSIVE_API_KEY) throw new Error('MASSIVE_API_KEY missing. Run with node -r dotenv/config ...');

  console.log(`Pressure pilot ${opts.from} -> ${opts.to}`);
  console.log(`Symbols: ${opts.symbols.join(', ')}`);
  console.log(`Cache: ${opts.noCache ? 'OFF' : opts.cacheDir}`);

  const results = [];
  for (const symbol of opts.symbols) {
    process.stdout.write(`Fetching ${symbol}...`);
    const result = await collectSymbol(symbol);
    results.push(result);
    const labels = result.packs.map(p => p.pressure.label).join(',');
    console.log(` ${result.packs.length} day(s), sources=${JSON.stringify(result.sources)}, labels=${labels}`);
  }

  const payload = {
    generated_at: new Date().toISOString(),
    source: 'Massive REST',
    endpoint_family: '/v2/aggs/ticker/{symbol}/range/{multiplier}/{timespan}/{from}/{to}',
    period: { from: opts.from, to: opts.to },
    symbols: opts.symbols,
    config: {
      lookbackDays: opts.lookbackDays,
      aggregateSeconds: opts.aggregateSeconds,
      first2AggregateSeconds: opts.first2AggregateSeconds,
      validationAggregateSeconds: opts.validationAggregateSeconds,
      windows: {
        prior_late_regular: '15:30:00-16:00:00',
        prior_after_hours: '16:00:00-20:00:00',
        premarket: '04:00:00-09:30:00',
        open_first_2_min: '09:30:00-09:32:00',
        open_validation: '09:32:00-10:00:00',
      },
    },
    results,
    compact_results: results.map(r => ({
      symbol: r.symbol,
      sources: r.sources,
      packs: r.packs.map(compactPack),
    })),
  };

  await fs.mkdir(path.dirname(opts.out), { recursive: true });
  await fs.writeFile(opts.out, JSON.stringify(payload, null, 2) + '\n');
  console.log(`Wrote ${opts.out}`);
}

main().catch(err => {
  console.error(`ERROR: ${err.message}`);
  console.error(err.stack?.slice(0, 800));
  process.exit(1);
});
