#!/usr/bin/env node
/**
 * Multi-timeframe backtest comparison — memory-efficient version.
 *
 * Processes one month at a time per symbol: fetches that month's bars,
 * runs all timeframes, accumulates stats, then discards the bars.
 * Memory usage stays ~500MB per month regardless of total date range.
 *
 * Usage:
 *   node scripts/timeframeCompare.js --symbols AAPL,TSLA,NVDA --from 2026-02-02 --to 2026-08-31
 */

import { SniperStrategy } from '../src/strategies/SniperStrategy.js';
import { MarkerService } from '../src/market/MarkerService.js';
import { BarLoader } from '../src/market/BarLoader.js';
import { BacktestStats } from '../src/backtest/BacktestStats.js';
import { MassiveData } from '../src/data/MassiveData.js';
import fs from 'node:fs/promises';
import path from 'node:path';

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {
        symbols: ['AAPL'],
        from: '2026-02-02',
        to: '2026-02-27',
        risk: 'low',
        buffer: 0.0015,
        shares: 100,
        hardStop: 0.008,
        windowMinutes: 15,
        skipOpenMinutes: 0,
        timeframes: null,
        jsonOut: null,
        cacheDir: 'data/massive_cache/rest',
        noCache: false,
    };
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--symbols': opts.symbols = args[++i].split(','); break;
            case '--from': opts.from = args[++i]; break;
            case '--to': opts.to = args[++i]; break;
            case '--risk': opts.risk = args[++i]; break;
            case '--buffer': opts.buffer = parseFloat(args[++i]); break;
            case '--shares': opts.shares = parseInt(args[++i], 10); break;
            case '--hard-stop': opts.hardStop = parseFloat(args[++i]); break;
            case '--window': opts.windowMinutes = parseInt(args[++i], 10); break;
            case '--skip-open-minutes': opts.skipOpenMinutes = parseInt(args[++i], 10); break;
            case '--timeframes': opts.timeframes = args[++i].split(',').map(s => s.trim()).filter(Boolean); break;
            case '--json-out': opts.jsonOut = args[++i]; break;
            case '--cache-dir': opts.cacheDir = args[++i]; break;
            case '--no-cache': opts.noCache = true; break;
        }
    }
    return opts;
}

const opts = parseArgs();
const reverseStopMap = { high: 1, mid: 2, low: 3 };
const reverseStopCount = reverseStopMap[opts.risk] ?? 3;

const TIMEFRAMES = [
    { label: '5s',         period: 5,    source: 'second' },
    { label: '10s',        period: 10,   source: 'second' },
    { label: '15s',        period: 15,   source: 'second' },
    { label: '30s',        period: 30,   source: 'second' },
    { label: '1m',         period: 60,   source: 'second' },
    { label: '1m_native',  period: 60,   source: 'minute' },
    { label: '5m',         period: 300,  source: 'minute' },
    { label: '15m',        period: 900,  source: 'minute' },
];
const selectedTimeframes = opts.timeframes
    ? TIMEFRAMES.filter(tf => opts.timeframes.includes(tf.label))
    : TIMEFRAMES;

if (opts.timeframes && selectedTimeframes.length !== opts.timeframes.length) {
    const known = new Set(TIMEFRAMES.map(tf => tf.label));
    const unknown = opts.timeframes.filter(label => !known.has(label));
    throw new Error(`Unknown timeframe(s): ${unknown.join(', ')}. Known: ${TIMEFRAMES.map(tf => tf.label).join(', ')}`);
}

const md = new MassiveData({ apiKey: process.env.MASSIVE_API_KEY });

function addMinutes(time, minutes) {
    const [hour, minute, second = '00'] = time.split(':').map(Number);
    const date = new Date(Date.UTC(2000, 0, 1, hour, minute + minutes, second));
    return date.toISOString().slice(11, 19);
}

function parseDateUTC(dateStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
}

function cachePath(symbol, multiplier, timespan, from, to) {
    const fileName = `${multiplier}_${from}_${to}.json`;
    return path.join(opts.cacheDir, symbol.toUpperCase(), timespan, fileName);
}

async function fetchCachedAggregates(symbol, multiplier, timespan, from, to, limit = 50000) {
    const filePath = cachePath(symbol, multiplier, timespan, from, to);
    if (!opts.noCache) {
        try {
            const cached = JSON.parse(await fs.readFile(filePath, 'utf8'));
            return { bars: cached.bars || [], source: 'cache', filePath };
        } catch (err) {
            if (err.code !== 'ENOENT') throw err;
        }
    }

    const bars = await md.fetchAggregates(symbol, multiplier, timespan, from, to, limit);
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

    return { bars, source: 'network', filePath };
}

/**
 * Split a date range into monthly chunks.
 */
function getMonthChunks(fromStr, toStr) {
    const chunks = [];
    const start = parseDateUTC(fromStr);
    const end = parseDateUTC(toStr);

    let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    while (cursor <= end) {
        const monthStart = cursor < start ? start : new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1));
        const nextMonth = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
        const monthEnd = nextMonth > end ? end : new Date(nextMonth.getTime() - 86400000);

        chunks.push({
            from: monthStart.toISOString().slice(0, 10),
            to: monthEnd.toISOString().slice(0, 10),
            label: cursor.toISOString().slice(0, 7),
        });
        cursor = nextMonth;
    }
    return chunks;
}

async function getDailyBars(symbol) {
    const fromDate = parseDateUTC(opts.from);
    fromDate.setUTCDate(fromDate.getUTCDate() - 45);
    const fromStr = fromDate.toISOString().slice(0, 10);
    const { bars } = await fetchCachedAggregates(symbol, 1, 'day', fromStr, opts.to, 50000);
    return bars.map(b => ({ date: b.date, o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume }));
}

/**
 * Fetch bars for a month, filter to trading hours, group by date.
 */
async function fetchMonthBars(symbol, from, to, timespan) {
    const { bars, source } = await fetchCachedAggregates(symbol, 1, timespan, from, to, 100000);
    const trading = bars.filter(b => b.time >= '09:30:00' && b.time < '16:00:00');

    const byDate = new Map();
    for (const bar of trading) {
        const key = bar.date;
        if (!byDate.has(key)) byDate.set(key, []);
        byDate.get(key).push(bar);
    }
    for (const [, dayBars] of byDate) {
        dayBars.sort((a, b) => a.time.localeCompare(b.time));
    }
    return { total: bars.length, trading: trading.length, byDate, source };
}

/**
 * Run backtest for one day, return setup.
 */
function backtestDay(symbol, date, dayBars, markerList, periodSeconds, barType) {
    if (dayBars.length < 2) {
        return {
            symbol, date, status: 'SKIPPED', exit_reason: 'NO_BARS',
            entry_price: null, exit_price: null, pnl: 0, shares: opts.shares,
        };
    }

    const aggBars = BarLoader.aggregate(dayBars, periodSeconds, barType);
    const windowStart = addMinutes('09:30:00', opts.skipOpenMinutes);
    const windowEnd = addMinutes('09:30:00', opts.windowMinutes);

    const strategy = new SniperStrategy({
        bufferPct: opts.buffer,
        windowStart,
        windowEnd,
        reverseStopCount,
        trailingStop: true,
        trailingStepPct: 0.005,
        hardStopPct: opts.hardStop,
    });
    strategy.reset(markerList, { symbol });

    for (const bar of aggBars) {
        strategy.evaluate(bar);
        if (strategy.getState().phase === 'CLOSED') break;
    }
    strategy.finalize(aggBars[aggBars.length - 1]);

    const state = strategy.getState();
    const trade = state.trades[0];

    const setup = {
        symbol, date,
        bias: null, status: null,
        entry_price: null, exit_price: null,
        pnl: 0, shares: opts.shares, exit_reason: null,
        entry_time: null, exit_time: null,
        entry_marker: null, profit_marker: null,
    };

    if (state.phase === 'NO_CROSS') {
        setup.status = 'SKIPPED';
        setup.bias = 'NEUTRAL';
        setup.exit_reason = 'NO_MARKER_CROSS';
    } else if (state.phase === 'NO_RETEST') {
        setup.status = 'SKIPPED';
        setup.bias = state.crossDir === 'DOWN' ? 'SELL' : 'BUY';
        setup.exit_reason = 'NO_RETEST';
    } else if (trade) {
        setup.bias = trade.direction;
        setup.entry_price = trade.entryPrice;
        setup.exit_price = trade.exitPrice;
        setup.entry_time = trade.entryTime;
        setup.exit_time = trade.exitTime;
        setup.entry_marker = trade.entryMarker;
        setup.profit_marker = trade.profitMarker;
        setup.status = trade.outcome;
        setup.exit_reason = trade.exitReason;
        const dir = trade.direction === 'BUY' ? 1 : -1;
        setup.pnl = (trade.exitPrice - trade.entryPrice) * opts.shares * dir;
    }
    return setup;
}

function createAccumulator() {
    return {
        wins: 0, losses: 0, breakeven: 0, skipped: 0,
        gross_profit: 0, gross_loss: 0, net_pnl: 0,
        hard_stops: 0, trailing_stops: 0,
    };
}

function createDetailsBucket() {
    return { setups: [] };
}

function accumulate(acc, setup) {
    if (setup.status === 'SKIPPED') {
        acc.skipped++;
    } else if (setup.status === 'BREAKEVEN') {
        acc.breakeven++;
    } else if (setup.status === 'WON') {
        acc.wins++;
        acc.gross_profit += setup.pnl;
        acc.net_pnl += setup.pnl;
        if (setup.exit_reason === 'TRAILING_STOP') acc.trailing_stops++;
        if (setup.exit_reason === 'HARD_STOP') acc.hard_stops++;
    } else if (setup.status === 'LOST') {
        acc.losses++;
        acc.gross_loss += Math.abs(setup.pnl);
        acc.net_pnl += setup.pnl;
        if (setup.exit_reason === 'HARD_STOP') acc.hard_stops++;
        if (setup.exit_reason === 'TRAILING_STOP') acc.trailing_stops++;
    }
    return acc;
}

function recordDetail(bucket, setup) {
    bucket.setups.push(setup);
}

function formatAccumulator(acc) {
    const taken = acc.wins + acc.losses;
    const wr = taken ? (acc.wins / taken * 100).toFixed(1) : '0.0';
    const pf = acc.gross_loss > 0 ? (acc.gross_profit / acc.gross_loss).toFixed(2) : acc.gross_profit > 0 ? '∞' : '0.00';
    return {
        wins: acc.wins, losses: acc.losses, breakeven: acc.breakeven, skipped: acc.skipped,
        win_rate: parseFloat(wr), profit_factor: parseFloat(pf === '∞' ? '9999' : pf),
        net_pnl: acc.net_pnl, gross_profit: acc.gross_profit, gross_loss: acc.gross_loss,
        hard_stops: acc.hard_stops, trailing_stops: acc.trailing_stops,
    };
}

async function main() {
    const allAcc = {};
    const allDetails = {};
    const chunks = getMonthChunks(opts.from, opts.to);
    const windowStart = addMinutes('09:30:00', opts.skipOpenMinutes);
    const windowEnd = addMinutes('09:30:00', opts.windowMinutes);
    console.log(`Processing ${chunks.length} monthly chunks across ${opts.symbols.length} symbols`);
    console.log(`Signal window: ${windowStart}-${windowEnd} ET (${opts.windowMinutes} min open window, skip first ${opts.skipOpenMinutes} min)`);
    console.log(`Timeframes: ${selectedTimeframes.map(tf => tf.label).join(', ')}`);
    console.log(`Cache: ${opts.noCache ? 'OFF' : opts.cacheDir}`);

    for (const symbol of opts.symbols) {
        console.log(`\n=== ${symbol} ===`);

        for (const tf of selectedTimeframes) {
            allAcc[`${symbol}_${tf.label}`] = createAccumulator();
            allDetails[`${symbol}_${tf.label}`] = createDetailsBucket();
        }

        const dailyBars = await getDailyBars(symbol);
        const tradingDays = dailyBars.filter(d => d.date >= opts.from && d.date <= opts.to);
        console.log(`  ${tradingDays.length} trading days, ${chunks.length} months`);

        const symStartTime = Date.now();

        for (const chunk of chunks) {
            const chunkStart = Date.now();
            process.stdout.write(`  [${chunk.label}] Fetching...`);

            const secData = await fetchMonthBars(symbol, chunk.from, chunk.to, 'second');
            const minData = await fetchMonthBars(symbol, chunk.from, chunk.to, 'minute');

            process.stdout.write(` sec=${secData.trading}(${secData.source}) min=${minData.trading}(${minData.source}) Running...`);

            // Get chunk's trading days from daily bars
            const chunkDays = dailyBars.filter(d => d.date >= chunk.from && d.date <= chunk.to);
            let processed = 0;

            for (let di = 0; di < dailyBars.length; di++) {
                const day = dailyBars[di];
                if (day.date < chunk.from || day.date > chunk.to) continue;

                const markers = MarkerService.compute(dailyBars, di);
                const markerList = MarkerService.buildList(markers);

                const daySecBars = secData.byDate.get(day.date) || [];
                const dayMinBars = minData.byDate.get(day.date) || [];

                for (const tf of selectedTimeframes) {
                    const bars = tf.source === 'second' ? daySecBars : dayMinBars;
                    const setup = backtestDay(symbol, day.date, bars, markerList, tf.period, tf.source);
                    const key = `${symbol}_${tf.label}`;
                    accumulate(allAcc[key], setup);
                    recordDetail(allDetails[key], setup);
                }
                processed++;
            }

            // Free memory
            secData.byDate.clear();
            minData.byDate.clear();

            const chunkElapsed = ((Date.now() - chunkStart) / 1000).toFixed(1);
            console.log(` done (${processed} days, ${chunkElapsed}s)`);
        }

        const symElapsed = ((Date.now() - symStartTime) / 60000).toFixed(1);
        console.log(`\n  ${symbol} complete (${symElapsed} min)`);
        for (const tf of selectedTimeframes) {
            const acc = allAcc[`${symbol}_${tf.label}`];
            const stats = formatAccumulator(acc);
            const pfStr = acc.gross_loss > 0 ? stats.profit_factor.toFixed(2) : acc.gross_profit > 0 ? '∞' : '0.00';
            console.log(`  ${tf.label.padEnd(10)} W=${String(acc.wins).padEnd(3)} L=${String(acc.losses).padEnd(3)} BE=${String(acc.breakeven).padEnd(3)} WR=${stats.win_rate.toFixed(1)}%  PnL=$${acc.net_pnl.toFixed(2)}  PF=${pfStr}  HS=${acc.hard_stops} TS=${acc.trailing_stops}`);
        }
    }

    // Combined summary
    console.log('\n═══════════════════════════════════════════════════════════════════════════════');
    console.log('  OVERALL SUMMARY (all symbols combined)');
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log(`  ${'TF'.padEnd(10)} ${'W'.padEnd(4)} ${'L'.padEnd(4)} ${'BE'.padEnd(4)} ${'Skip'.padEnd(5)} ${'WR%'.padEnd(7)} ${'P&L'.padEnd(10)} ${'PF'.padEnd(5)} ${'AvgW'.padEnd(8)} ${'AvgL'.padEnd(8)} ${'HS'.padEnd(4)} ${'TS'.padEnd(4)}`);
    console.log('  ────────────────────────────────────────────────────────────────────────────');

    const summary = [];
    for (const tf of selectedTimeframes) {
        const t = createAccumulator();
        for (const symbol of opts.symbols) {
            const a = allAcc[`${symbol}_${tf.label}`];
            t.wins += a.wins; t.losses += a.losses; t.breakeven += a.breakeven;
            t.skipped += a.skipped; t.gross_profit += a.gross_profit;
            t.gross_loss += a.gross_loss; t.net_pnl += a.net_pnl;
            t.hard_stops += a.hard_stops; t.trailing_stops += a.trailing_stops;
        }
        const taken = t.wins + t.losses;
        const wr = taken ? (t.wins / taken * 100).toFixed(1) : '0.0';
        const pf = t.gross_loss > 0 ? (t.gross_profit / t.gross_loss).toFixed(2) : t.gross_profit > 0 ? '∞' : '0.00';
        const avgW = t.wins ? (t.gross_profit / t.wins).toFixed(0) : '0';
        const avgL = t.losses ? (t.gross_loss / t.losses).toFixed(0) : '0';
        summary.push({
            timeframe: tf.label,
            wins: t.wins,
            losses: t.losses,
            breakeven: t.breakeven,
            skipped: t.skipped,
            win_rate: Number(wr),
            net_pnl: t.net_pnl,
            profit_factor: pf === '∞' ? null : Number(pf),
            profit_factor_display: pf,
            avg_win: Number(avgW),
            avg_loss: Number(avgL),
            hard_stops: t.hard_stops,
            trailing_stops: t.trailing_stops,
        });
        console.log(`  ${tf.label.padEnd(10)} ${String(t.wins).padEnd(4)} ${String(t.losses).padEnd(4)} ${String(t.breakeven).padEnd(4)} ${String(t.skipped).padEnd(5)} ${wr.padEnd(6)}% $${String(t.net_pnl.toFixed(0)).padEnd(9)} ${pf.padEnd(5)} $${avgW.padEnd(7)} $${avgL.padEnd(7)} ${String(t.hard_stops).padEnd(4)} ${String(t.trailing_stops).padEnd(4)}`);
    }
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('  W = wins, L = losses, BE = breakeven, WR = win rate, PF = profit factor');
    console.log('  AvgW/AvgL = average win/loss in dollars, HS = hard stop, TS = trailing stop');
    console.log('═══════════════════════════════════════════════════════════════════════════════');

    if (opts.jsonOut) {
        const details = {};
        for (const symbol of opts.symbols) {
            details[symbol] = {};
            for (const tf of selectedTimeframes) {
                const key = `${symbol}_${tf.label}`;
                details[symbol][tf.label] = {
                    stats: formatAccumulator(allAcc[key]),
                    setups: allDetails[key].setups,
                };
            }
        }
        const payload = {
            source: 'Massive',
            generated_at: new Date().toISOString(),
            period: { from: opts.from, to: opts.to },
            symbols: opts.symbols,
            config: {
                risk: opts.risk,
                buffer: opts.buffer,
                shares: opts.shares,
                hardStop: opts.hardStop,
                windowMinutes: opts.windowMinutes,
                skipOpenMinutes: opts.skipOpenMinutes,
                windowStart,
                windowEnd,
                timeframes: selectedTimeframes.map(tf => tf.label),
            },
            summary,
            details,
        };
        await fs.mkdir(path.dirname(opts.jsonOut), { recursive: true });
        await fs.writeFile(opts.jsonOut, JSON.stringify(payload, null, 2) + '\n');
        console.log(`\nWrote JSON snapshot: ${opts.jsonOut}`);
    }
}

main().catch(err => {
    console.error('\nError:', err.message);
    console.error(err.stack?.slice(0, 500));
    process.exit(1);
});
