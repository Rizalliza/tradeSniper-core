#!/usr/bin/env node
/**
 * Cache only the needed market-data bars from an agent Massive handoff.
 *
 * Usage:
 *   node scripts/cacheAgentHistoricalData.js --date 2026-09-15 --symbols AAPL,NVDA
 */

import fs from 'node:fs/promises';
import path from 'node:path';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    date: null,
    symbols: [],
    source: null,
    outDir: 'data/massive_cache/agent',
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--date': opts.date = args[++i]; break;
      case '--symbols':
        opts.symbols = args[++i].split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
        break;
      case '--source': opts.source = args[++i]; break;
      case '--out-dir': opts.outDir = args[++i]; break;
    }
  }

  if (!opts.date && !opts.source) {
    throw new Error('Pass --date YYYY-MM-DD or --source path/to/strategy-market.json');
  }
  if (!opts.symbols.length) {
    throw new Error('Pass --symbols, for example --symbols AAPL,NVDA');
  }

  opts.source ||= path.join('agent', 'strategy-analyst', 'massive', opts.date, 'strategy-market.json');
  return opts;
}

function pickDailyContext(pack) {
  return {
    symbol: pack.symbol,
    date: pack.date,
    daily: pack.daily,
    markers: pack.markers,
    marker_list: pack.marker_list,
    strategy: pack.strategy,
  };
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2) + '\n');
}

async function main() {
  const opts = parseArgs();
  const payload = JSON.parse(await fs.readFile(opts.source, 'utf8'));
  const available = new Map((payload.symbols || []).map(pack => [pack.symbol, pack]));
  const cached = [];
  const missing = [];

  for (const symbol of opts.symbols) {
    const pack = available.get(symbol);
    if (!pack) {
      missing.push(symbol);
      continue;
    }

    const baseDir = path.join(opts.outDir, pack.date, symbol);
    const opening = pack.opening || {};
    const files = {
      context: path.join(baseDir, 'context.json'),
      secondBars: path.join(baseDir, 'second_bars.json'),
      minuteBars: path.join(baseDir, 'minute_bars.json'),
      aggregatedBars: path.join(baseDir, 'aggregated_bars.json'),
      manifest: path.join(baseDir, 'manifest.json'),
    };

    await writeJson(files.context, pickDailyContext(pack));
    await writeJson(files.secondBars, opening.second_bars || []);
    await writeJson(files.minuteBars, opening.minute_bars || []);
    await writeJson(files.aggregatedBars, opening.aggregated_bars || []);
    await writeJson(files.manifest, {
      source: opts.source,
      generated_at: new Date().toISOString(),
      symbol: pack.symbol,
      date: pack.date,
      files: Object.fromEntries(Object.entries(files).map(([key, file]) => [key, path.relative(baseDir, file)])),
      counts: {
        second_bars: opening.second_bars?.length || 0,
        minute_bars: opening.minute_bars?.length || 0,
        aggregated_bars: opening.aggregated_bars?.length || 0,
      },
    });

    cached.push({
      symbol: pack.symbol,
      date: pack.date,
      second_bars: opening.second_bars?.length || 0,
      minute_bars: opening.minute_bars?.length || 0,
      aggregated_bars: opening.aggregated_bars?.length || 0,
      dir: baseDir,
    });
  }

  await writeJson(path.join(opts.outDir, opts.date || payload.manifest?.target_date || 'unknown', 'manifest.json'), {
    source: opts.source,
    generated_at: new Date().toISOString(),
    requested_symbols: opts.symbols,
    cached,
    missing,
  });

  console.log(`Cached ${cached.length} symbol(s) from ${opts.source}`);
  for (const item of cached) {
    console.log(`  ${item.symbol} ${item.date}: 1s=${item.second_bars}, 1m=${item.minute_bars}, agg=${item.aggregated_bars} -> ${item.dir}`);
  }
  if (missing.length) {
    console.log(`Missing from handoff: ${missing.join(', ')}`);
  }
}

main().catch(err => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
