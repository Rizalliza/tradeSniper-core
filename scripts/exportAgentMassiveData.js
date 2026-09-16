#!/usr/bin/env node
/**
 * Export Massive data handoff packs for the agent team.
 *
 * Outputs repo-owned artifacts under:
 *   agent/strategy-analyst/massive/<date>/
 *   agent/data-news-analyst/massive/<date>/
 *   agent/code-builder/massive/<date>/
 *
 * Usage:
 *   node -r dotenv/config scripts/exportAgentMassiveData.js --date 2026-09-15 --symbols AAPL,TSLA,NVDA
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { MassiveData } from '../src/data/MassiveData.js';
import { MarkerService } from '../src/market/MarkerService.js';
import { BarLoader } from '../src/market/BarLoader.js';
import { SniperStrategy } from '../src/strategies/SniperStrategy.js';
import { NewsDigest } from '../src/news/NewsDigest.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    date: null,
    symbols: ['AAPL', 'TSLA', 'NVDA'],
    lookbackDays: 45,
    windowMinutes: 15,
    rawWindowMinutes: 30,
    aggregateSeconds: 15,
    buffer: 0.0015,
    risk: 'low',
    shares: 100,
    newsLookbackDays: 3,
    newsLimit: 25,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--date': opts.date = args[++i]; break;
      case '--symbols': opts.symbols = args[++i].split(',').map(s => s.trim().toUpperCase()).filter(Boolean); break;
      case '--lookback-days': opts.lookbackDays = parseInt(args[++i], 10); break;
      case '--window': opts.windowMinutes = parseInt(args[++i], 10); break;
      case '--raw-window': opts.rawWindowMinutes = parseInt(args[++i], 10); break;
      case '--aggregate-seconds': opts.aggregateSeconds = parseInt(args[++i], 10); break;
      case '--buffer': opts.buffer = parseFloat(args[++i]); break;
      case '--risk': opts.risk = args[++i]; break;
      case '--shares': opts.shares = parseInt(args[++i], 10); break;
      case '--news-lookback-days': opts.newsLookbackDays = parseInt(args[++i], 10); break;
      case '--news-limit': opts.newsLimit = parseInt(args[++i], 10); break;
    }
  }

  if (!opts.date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const get = (type) => parts.find(part => part.type === type)?.value;
    opts.date = `${get('year')}-${get('month')}-${get('day')}`;
  }

  return opts;
}

const reverseStopMap = { high: 1, mid: 2, low: 3 };

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function addMinutes(time, minutes) {
  const [hour, minute, second = '00'] = time.split(':').map(Number);
  const date = new Date(Date.UTC(2000, 0, 1, hour, minute + minutes, second));
  return date.toISOString().slice(11, 19);
}

function inWindow(bar, minutes) {
  return bar.time >= '09:30:00' && bar.time < addMinutes('09:30:00', minutes);
}

function summarizeBars(bars) {
  if (!bars.length) return null;
  return {
    count: bars.length,
    first_time: bars[0].time,
    last_time: bars[bars.length - 1].time,
    open: bars[0].open,
    close: bars[bars.length - 1].close,
    high: Math.max(...bars.map(b => b.high)),
    low: Math.min(...bars.map(b => b.low)),
    volume: bars.reduce((sum, b) => sum + (b.volume || 0), 0),
  };
}

function runStrategy({ symbol, date, bars, markerList, opts, label }) {
  const reverseStopCount = reverseStopMap[opts.risk] ?? 3;
  const strategy = new SniperStrategy({
    bufferPct: opts.buffer,
    windowStart: '09:30:00',
    windowEnd: addMinutes('09:30:00', opts.windowMinutes),
    reverseStopCount,
    trailingStop: true,
    trailingStepPct: 0.005,
    hardStopPct: 0.008,
  });

  strategy.reset(markerList, { symbol, date, label });
  for (const bar of bars) {
    strategy.evaluate(bar);
    if (strategy.getState().phase === 'CLOSED') break;
  }
  strategy.finalize(bars[bars.length - 1]);

  const state = strategy.getState();
  const trade = state.trades[0] || null;
  const pnl = trade
    ? (trade.exitPrice - trade.entryPrice) * opts.shares * (trade.direction === 'BUY' ? 1 : -1)
    : 0;

  return {
    label,
    phase: state.phase,
    cross_marker: state.crossMarker,
    cross_direction: state.crossDir,
    entry_marker: state.entryMarker,
    entry_direction: state.entryDir,
    trade: trade ? {
      direction: trade.direction,
      entry_marker: trade.entryMarker,
      entry_time: trade.entryTime,
      entry_price: trade.entryPrice,
      exit_time: trade.exitTime,
      exit_price: trade.exitPrice,
      exit_reason: trade.exitReason,
      outcome: trade.outcome,
      pnl,
      pnl_per_share: trade.pnl,
      best_price: trade.bestPrice,
      reverse_crossings: trade.reverseCrossings,
      forward_crossings: trade.forwardCrossings,
    } : null,
  };
}

function normalizeNewsArticle(article, symbol) {
  return {
    symbol,
    title: article.title || '',
    summary: article.description || '',
    source: article.publisher?.name || 'Unknown',
    url: article.article_url || '',
    publishedAt: article.published_utc,
    tickers: article.tickers || [],
    keywords: article.keywords || [],
  };
}

async function fetchNews(symbol, fromDate, limit, apiKey) {
  const url = new URL('https://api.massive.com/v2/reference/news');
  url.searchParams.set('ticker', symbol);
  url.searchParams.set('published_utc.gte', `${fromDate}T00:00:00Z`);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('order', 'desc');
  url.searchParams.set('sort', 'published_utc');
  url.searchParams.set('apiKey', apiKey);

  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === 'ERROR') {
    throw new Error(data.message || data.error || `${res.status} ${res.statusText}`);
  }
  return (data.results || []).map(article => normalizeNewsArticle(article, symbol));
}

function stripLargeBars(symbolPack) {
  const opening = symbolPack.opening ? {
    raw_seconds_summary: symbolPack.opening.raw_seconds_summary,
    minute_summary: symbolPack.opening.minute_summary,
    aggregated_summary: symbolPack.opening.aggregated_summary,
  } : null;

  return {
    symbol: symbolPack.symbol,
    date: symbolPack.date,
    daily: symbolPack.daily,
    markers: symbolPack.markers,
    marker_list: symbolPack.marker_list,
    opening,
    strategy: symbolPack.strategy,
  };
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\n');
}

async function writeText(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text);
}

function strategyMarkdown(opts, packs) {
  const rows = packs.map(p => {
    const r = p.strategy.aggregated;
    const t = r.trade;
    return `| ${p.symbol} | ${t?.direction || '-'} | ${t?.entry_marker || r.cross_marker || '-'} | ${t?.outcome || r.phase} | ${t ? `$${t.pnl.toFixed(2)}` : '$0.00'} | ${t?.exit_reason || '-'} |`;
  }).join('\n');

  return `# Strategy Analyst Massive Handoff

Date: ${opts.date}
Symbols: ${opts.symbols.join(', ')}
Data source: REAL_MASSIVE_REST
Signal bars: ${opts.aggregateSeconds}s aggregated from Massive second bars
Execution status: dry-run/backtest only
Evaluation scope: opening-period handoff, first ${opts.rawWindowMinutes} minutes of bars

| Symbol | Direction | Marker | Outcome | P&L | Exit |
|---|---|---|---|---:|---|
${rows}

Notes:
- News is context only. Price action remains primary.
- Raw 1s and ${opts.aggregateSeconds}s results are both in strategy-market.json.
- Opening bars are limited to the first ${opts.rawWindowMinutes} minutes for handoff size.
- If an exit reason says EOD_UNFAVORABLE/RUNNER here, read it as end-of-export-window, not full market close.
`;
}

function newsMarkdown(opts, digest, symbolDigests) {
  const symbolRows = Object.entries(symbolDigests).map(([sym, d]) =>
    `| ${sym} | ${d.article_count} | ${d.overall_sentiment.label} | ${d.overall_sentiment.score.toFixed(3)} | ${d.decision_context.confidenceMult.toFixed(2)}x |`
  ).join('\n');

  return `# Data & News Analyst Massive Handoff

Date: ${opts.date}
Symbols: ${opts.symbols.join(', ')}
Data source: REAL_MASSIVE_REST_NEWS
News lookback: ${opts.newsLookbackDays} day(s)
Rule: sentiment adjusts risk only, never creates signals.

Overall sentiment: ${digest.overall_sentiment.label} (${digest.overall_sentiment.score.toFixed(3)})
Article count: ${digest.article_count}
Confidence multiplier: ${digest.decision_context.confidenceMult.toFixed(2)}x

| Symbol | Articles | Label | Score | Confidence |
|---|---:|---|---:|---:|
${symbolRows}
`;
}

function coderMarkdown(opts, validation) {
  return `# Code Builder Massive Handoff

Date: ${opts.date}
Symbols: ${opts.symbols.join(', ')}
Data source: REAL_MASSIVE_REST

Purpose:
- Use these files as stable fixtures for wiring the webapp and agent handoffs.
- Do not use synthetic candles for user-visible validation.
- Do not commit API keys or OAuth material.

Validated endpoints:
${validation.endpoints.map(e => `- ${e.name}: ${e.status}`).join('\n')}

Known caveats:
- Codex MCP is configured in ~/.codex/config.toml, but CLI listing reports auth as Unsupported here.
- REST via repo .env was used for this export.
- Sep 16, 2026 U.S. regular session had not opened at export time; latest completed session is ${opts.date}.
- Strategy handoff is opening-period scoped. Full-day backtests should use scripts/massiveBacktest.js.
`;
}

async function main() {
  const opts = parseArgs();
  const apiKey = process.env.MASSIVE_API_KEY;
  if (!apiKey) throw new Error('MASSIVE_API_KEY missing. Run with node -r dotenv/config ...');

  const massive = new MassiveData({ apiKey });
  const fromMarkers = addDays(opts.date, -opts.lookbackDays);
  const newsFrom = addDays(opts.date, -opts.newsLookbackDays);
  const generatedAt = new Date().toISOString();

  const symbolPacks = [];
  const validation = {
    generated_at: generatedAt,
    target_date: opts.date,
    source: 'REAL_MASSIVE_REST',
    endpoints: [],
    response_shapes: {},
  };

  for (const symbol of opts.symbols) {
    console.log(`Fetching ${symbol} market data...`);
    const dailyBars = await massive.fetchDailyForMarkers(symbol, fromMarkers, opts.date);
    const dayIndex = dailyBars.findIndex(b => b.date === opts.date);
    if (dayIndex < 1) {
      symbolPacks.push({ symbol, date: opts.date, error: 'No marker-capable daily data for date' });
      continue;
    }

    const markers = MarkerService.compute(dailyBars, dayIndex);
    const markerList = MarkerService.buildList(markers);
    const secondBars = (await massive.fetchSecondBars(symbol, opts.date, opts.date))
      .filter(b => inWindow(b, opts.rawWindowMinutes));
    const minuteBars = (await massive.fetchMinuteBars(symbol, opts.date, opts.date))
      .filter(b => inWindow(b, opts.rawWindowMinutes));
    const aggregatedBars = BarLoader.aggregate(secondBars, opts.aggregateSeconds, 'second');

    const rawStrategy = runStrategy({ symbol, date: opts.date, bars: secondBars, markerList, opts, label: 'raw_1s' });
    const aggregatedStrategy = runStrategy({ symbol, date: opts.date, bars: aggregatedBars, markerList, opts, label: `${opts.aggregateSeconds}s_signal` });

    symbolPacks.push({
      symbol,
      date: opts.date,
      daily: {
        lookback_from: fromMarkers,
        count: dailyBars.length,
        target_day: dailyBars[dayIndex],
        prior_day: dailyBars[dayIndex - 1],
      },
      markers,
      marker_list: markerList,
      opening: {
        raw_seconds_summary: summarizeBars(secondBars),
        minute_summary: summarizeBars(minuteBars),
        aggregated_summary: summarizeBars(aggregatedBars),
        second_bars: secondBars,
        minute_bars: minuteBars,
        aggregated_bars: aggregatedBars,
      },
      strategy: {
        raw_1s: rawStrategy,
        aggregated: aggregatedStrategy,
      },
    });

    validation.endpoints.push({ name: `daily aggregates ${symbol}`, status: 'OK', count: dailyBars.length });
    validation.endpoints.push({ name: `second aggregates ${symbol}`, status: 'OK', count: secondBars.length });
    validation.endpoints.push({ name: `minute aggregates ${symbol}`, status: 'OK', count: minuteBars.length });
    validation.response_shapes[`${symbol}_second_bar`] = secondBars[0] ? Object.keys(secondBars[0]) : [];
    validation.response_shapes[`${symbol}_news_article`] = [];
  }

  console.log('Fetching news...');
  const allNews = [];
  const newsBySymbol = {};
  for (const symbol of opts.symbols) {
    try {
      const articles = await fetchNews(symbol, newsFrom, opts.newsLimit, apiKey);
      newsBySymbol[symbol] = articles;
      allNews.push(...articles);
      validation.endpoints.push({ name: `news ${symbol}`, status: 'OK', count: articles.length });
      validation.response_shapes[`${symbol}_news_article`] = articles[0] ? Object.keys(articles[0]) : [];
    } catch (err) {
      newsBySymbol[symbol] = [];
      validation.endpoints.push({ name: `news ${symbol}`, status: `ERROR: ${err.message}`, count: 0 });
    }
  }

  const digest = new NewsDigest();
  digest.addArticles(allNews);
  const overallDigest = digest.generateDailyDigest(opts.date);
  const symbolDigests = {};
  for (const symbol of opts.symbols) {
    symbolDigests[symbol] = digest.generateDailyDigest(opts.date, { symbol });
  }

  const base = path.join('agent');
  const strategyDir = path.join(base, 'strategy-analyst', 'massive', opts.date);
  const newsDir = path.join(base, 'data-news-analyst', 'massive', opts.date);
  const coderDir = path.join(base, 'code-builder', 'massive', opts.date);

  const manifest = {
    generated_at: generatedAt,
    target_date: opts.date,
    latest_completed_session: opts.date,
    symbols: opts.symbols,
    source: 'REAL_MASSIVE_REST',
    mcp_note: 'Codex Massive MCP is configured, but REST dotenv export was used to avoid agent credential drift.',
    config: opts,
    files: {
      strategy: [
        'strategy-market.json',
        'strategy-market-compact.json',
        'REPORT.md',
      ],
      news: [
        'news.json',
        'news-digest.json',
        'REPORT.md',
      ],
      code_builder: [
        'massive-api-validation.json',
        'REPORT.md',
      ],
    },
  };

  await writeJson(path.join(strategyDir, 'manifest.json'), manifest);
  await writeJson(path.join(strategyDir, 'strategy-market.json'), { manifest, symbols: symbolPacks });
  await writeJson(path.join(strategyDir, 'strategy-market-compact.json'), { manifest, symbols: symbolPacks.map(stripLargeBars) });
  await writeText(path.join(strategyDir, 'REPORT.md'), strategyMarkdown(opts, symbolPacks));

  await writeJson(path.join(newsDir, 'manifest.json'), manifest);
  await writeJson(path.join(newsDir, 'news.json'), { manifest, news_by_symbol: newsBySymbol, all_news_count: allNews.length });
  await writeJson(path.join(newsDir, 'news-digest.json'), { manifest, overall: overallDigest, by_symbol: symbolDigests });
  await writeText(path.join(newsDir, 'REPORT.md'), newsMarkdown(opts, overallDigest, symbolDigests));

  await writeJson(path.join(coderDir, 'manifest.json'), manifest);
  await writeJson(path.join(coderDir, 'massive-api-validation.json'), validation);
  await writeText(path.join(coderDir, 'REPORT.md'), coderMarkdown(opts, validation));

  console.log(`\nExport complete for ${opts.date}`);
  console.log(`  ${strategyDir}`);
  console.log(`  ${newsDir}`);
  console.log(`  ${coderDir}`);
}

main().catch(err => {
  console.error('Export failed:', err.message);
  process.exit(1);
});
