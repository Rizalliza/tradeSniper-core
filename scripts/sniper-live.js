#!/usr/bin/env node
/**
 * Sniper Live Mode — real-time signal detection for US market open.
 *
 * Combines:
 *   - Live second-bar data from Massive.com
 *   - News sentiment (also from Massive)
 *   - Sniper strategy (marker-retest entry detection)
 *   - Decision context (news adjusts confidence ±30%)
 *
 * PRICE ACTION FIRST:
 *   The strategy generates signals from price action only.
 *   News sentiment adjusts position sizing confidence — never generates signals.
 *
 * Usage:
 *   node scripts/sniper-live.js --symbols AAPL,TSLA,NVDA
 *   node scripts/sniper-live.js --symbol NVDA --risk mid
 *   node scripts/sniper-live.js --symbols AAPL --window 15 --buffer 0.002
 *
 * Environment:
 *   MASSIVE_API_KEY — required for live data
 */

import { SniperStrategy } from '../src/strategies/SniperStrategy.js';
import { MarkerService } from '../src/market/MarkerService.js';
import { MassiveData } from '../src/data/MassiveData.js';
import { NewsDigest } from '../src/news/NewsDigest.js';

// Parse args
function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {
        symbols: ['AAPL', 'TSLA', 'NVDA'],
        risk: 'low',
        buffer: 0.0015,
        window: 15, // minutes of entry window
        shares: 100,
        trailing: true,
        trailingStep: 0.005,
        lookbackDays: 30, // days of daily data for markers
        pollInterval: 1000, // ms between second-bar polls
    };
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--symbols': opts.symbols = args[++i].split(','); break;
            case '--symbol': opts.symbols = [args[++i]]; break;
            case '--risk': opts.risk = args[++i]; break;
            case '--buffer': opts.buffer = parseFloat(args[++i]); break;
            case '--window': opts.window = parseInt(args[++i], 10); break;
            case '--shares': opts.shares = parseInt(args[++i], 10); break;
            case '--no-trailing': opts.trailing = false; break;
            case '--trailing-step': opts.trailingStep = parseFloat(args[++i]); break;
            case '--lookback': opts.lookbackDays = parseInt(args[++i], 10); break;
            case '--poll': opts.pollInterval = parseInt(args[++i], 10); break;
        }
    }
    return opts;
}

const reverseStopMap = { high: 1, mid: 2, low: 3 };

function addMinutes(time, minutes) {
    const [hour, minute, second = '00'] = time.split(':').map(Number);
    const date = new Date(Date.UTC(2000, 0, 1, hour, minute + minutes, second));
    return date.toISOString().slice(11, 19);
}

function formatMarketDateTime(date) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).formatToParts(date);
    const get = (type) => parts.find((part) => part.type === type)?.value;

    return {
        date: `${get('year')}-${get('month')}-${get('day')}`,
        time: `${get('hour')}:${get('minute')}:${get('second')}`,
        hour: Number(get('hour')),
        minute: Number(get('minute')),
        second: Number(get('second')),
    };
}

async function main() {
    const opts = parseArgs();
    const apiKey = process.env.MASSIVE_API_KEY;

    if (!apiKey) {
        console.error('❌ MASSIVE_API_KEY not set');
        console.error('   export MASSIVE_API_KEY=your_key');
        process.exit(1);
    }

    const massive = new MassiveData({ apiKey });
    const reverseStopCount = reverseStopMap[opts.risk] ?? 3;

    console.log(`
╔══════════════════════════════════════════════════╗
║  SNIPER LIVE MODE                                 ║
╠══════════════════════════════════════════════════╣
║  Symbols:    ${opts.symbols.join(', ').padEnd(33)}║
║  Risk:       ${opts.risk.padEnd(33)}║
║  Buffer:     ${(opts.buffer * 100).toFixed(2)}%${' '.repeat(28)}║
║  Window:     first ${opts.window} min${' '.repeat(24)}║
║  Trailing:   ${opts.trailing ? 'ON' : 'OFF'}${' '.repeat(30)}║
║  Shares:     ${String(opts.shares).padEnd(33)}║
╚══════════════════════════════════════════════════╝
`);

    // Calculate date range
    const today = new Date();
    const todayStr = formatMarketDateTime(today).date;
    const fromDate = new Date(today);
    fromDate.setDate(fromDate.getDate() - opts.lookbackDays);
    const fromStr = formatMarketDateTime(fromDate).date;

    console.log(`📅 Date: ${todayStr}`);
    console.log(`🔍 Loading ${opts.lookbackDays} days of daily data for markers...\n`);

    const symbolData = {};

    // Load daily data + compute markers
    for (const symbol of opts.symbols) {
        try {
            const dailyBars = await massive.fetchDailyForMarkers(symbol, fromStr, todayStr);
            if (dailyBars.length < 2) {
                console.log(`  ⚠ ${symbol}: not enough daily data`);
                continue;
            }

            const markerBars = dailyBars[dailyBars.length - 1]?.date === todayStr
                ? dailyBars
                : [...dailyBars, { ...dailyBars[dailyBars.length - 1], date: todayStr }];
            const lastIdx = markerBars.length - 1;
            const markers = MarkerService.compute(markerBars, lastIdx);
            const markerList = MarkerService.buildList(markers);

            symbolData[symbol] = {
                daily: dailyBars,
                markers,
                markerList,
                strategy: null,
                latestBars: [],
                state: 'WAITING_MARKET_OPEN',
            };

            console.log(`  ✅ ${symbol}: ${dailyBars.length} days, ${markerList.length} markers`);
            console.log(`     D-H: $${markers.daily_high.toFixed(2)}  D-L: $${markers.daily_low.toFixed(2)}`);
        } catch (e) {
            console.log(`  ❌ ${symbol}: ${e.message}`);
        }
    }

    console.log(`\n⏳ Waiting for market open (09:30 ET)...`);
    console.log(`   Press Ctrl+C to stop\n`);

    // Initialize strategies
    for (const [sym, data] of Object.entries(symbolData)) {
        data.strategy = new SniperStrategy({
            bufferPct: opts.buffer,
            windowStart: '09:30:00',
            windowEnd: addMinutes('09:30:00', opts.window),
            reverseStopCount,
            trailingStop: opts.trailing,
            trailingStepPct: opts.trailingStep,
        });
        data.strategy.reset(data.markerList, { symbol: sym, date: todayStr });
    }

    // Fetch news sentiment for decision context
    console.log(`📰 Fetching news sentiment...`);
    const newsDigest = new NewsDigest();
    // In production, fetch real news from Massive API
    // For now: placeholder with sample data if available
    try {
        const { SAMPLE_NEWS } = await import('../src/data/sampleNews.js');
        newsDigest.addArticles(SAMPLE_NEWS.filter(a => opts.symbols.includes(a.symbol)));
        const latestDate = [...new Set(SAMPLE_NEWS.map(a => a.publishedAt.slice(0, 10)))].sort().pop();
        const digest = newsDigest.generateDailyDigest(latestDate);
        console.log(`   Sentiment: ${digest.overall_sentiment.label} (${digest.overall_sentiment.score.toFixed(3)})`);
        console.log(`   Confidence multiplier: ${digest.decision_context.confidenceMult.toFixed(2)}x`);
        console.log(`   News weight: ${(digest.decision_context.weight * 100).toFixed(0)}% (max)\n`);
    } catch (e) {
        console.log(`   (sample data unavailable — using neutral baseline)\n`);
    }

    // Polling loop
    let lastBarTime = {};
    let entryFired = {};

    async function poll() {
        const now = new Date();
        const nowET = formatMarketDateTime(now);
        const timeStr = nowET.time;

        // Check if we're in the window
        const h = nowET.hour;
        const m = nowET.minute;
        const s = nowET.second;
        const isInWindow = h === 9 && m >= 30 && m < 30 + opts.window;
        const isMarketOpen = (h === 9 && m >= 30) || (h > 9 && h < 16) || (h === 16 && m === 0);

        if (!isMarketOpen && h >= 16) {
            console.log(`\n🌙 Market closed for the day.`);
            process.exit(0);
        }

        for (const [sym, data] of Object.entries(symbolData)) {
            if (entryFired[sym]) continue;

            try {
                // Fetch second bars for today
                const bars = await massive.fetchSecondBars(sym, todayStr, todayStr);

                // Only process new bars
                const newBars = lastBarTime[sym]
                    ? bars.filter(b => b.time > lastBarTime[sym])
                    : bars;

                if (!newBars.length) continue;
                lastBarTime[sym] = bars[bars.length - 1]?.time;

                // Feed through strategy
                for (const bar of newBars) {
                    data.strategy.evaluate(bar);
                }

                const state = data.strategy.getState();

                // Check for entry
                if (state.phase === 'IN_TRADE' && !entryFired[sym]) {
                    entryFired[sym] = true;
                    const trade = state.trades[state.trades.length - 1] || state;
                    const direction = trade.direction || state.entryDir;
                    const entryPrice = trade.entryPrice ?? state.entryPrice;
                    const isBuy = direction === 'BUY';
                    const color = isBuy ? '\x1b[32m' : '\x1b[31m';
                    const arrow = isBuy ? '▲' : '▼';
                    const marker = trade.entryMarker || state.entryMarker;

                    console.log(`\n${color}══════════ SIGNAL ══════════\x1b[0m`);
                    console.log(`${color}  ${sym} ${arrow} ${direction} @ $${entryPrice.toFixed(2)}\x1b[0m`);
                    console.log(`  Marker: ${marker}`);
                    console.log(`  Time:   ${trade.entryTime || bar.time}`);
                    console.log(`  Buffer: ${(opts.buffer * 100).toFixed(2)}%`);
                    console.log(`  Risk:   ${opts.risk} (reverse stop: ${reverseStopCount})`);

                    // News context
                    try {
                        const { SAMPLE_NEWS } = await import('../src/data/sampleNews.js');
                        const symDigest = new NewsDigest();
                        symDigest.addArticles(SAMPLE_NEWS.filter(a => a.symbol === sym));
                        const dates = [...new Set(SAMPLE_NEWS.map(a => a.publishedAt.slice(0, 10)))].sort();
                        if (dates.length) {
                            const d = symDigest.generateDailyDigest(dates[dates.length - 1]);
                            console.log(`\n  📰 News Context:`);
                            console.log(`     Sentiment: ${d.overall_sentiment.label} (${d.overall_sentiment.score.toFixed(3)})`);
                            console.log(`     Confidence: ${d.decision_context.confidenceMult.toFixed(2)}x`);
                            console.log(`     Position adjustment: ${d.decision_context.confidenceMult >= 1 ? '+' : ''}${Math.round((d.decision_context.confidenceMult - 1) * 100)}%`);
                        }
                    } catch (e) {}

                    console.log(`${color}════════════════════════════\x1b[0m\n`);
                }

                // Check for exit / finalize if window closed
                if (isInWindow && state.phase === 'IN_TRADE') {
                    const trade = state.trades[state.trades.length - 1];
                    if (trade?.exitPrice) {
                        const isWin = trade.outcome === 'WON';
                        console.log(`\n  📊 ${sym} ${isWin ? '✓ WIN' : '✗ LOSS'}: ${trade.exitReason}`);
                        console.log(`     Exit @ $${trade.exitPrice.toFixed(2)}, P&L: $${(trade.pnl * opts.shares).toFixed(2)}`);
                    }
                }

            } catch (e) {
                // Silent retry on poll errors
            }
        }

        setTimeout(poll, opts.pollInterval);
    }

    poll();
}

main().catch(err => {
    console.error('Fatal error:', err.message);
    process.exit(1);
});
