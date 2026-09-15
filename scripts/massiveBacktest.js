#!/usr/bin/env node
/**
 * Backtest runner using Massive.com market data.
 *
 * Fetches daily bars (for markers) and intraday bars (for strategy) from Massive API,
 * then runs the SniperStrategy on the data.
 *
 * Usage:
 *   node scripts/massiveBacktest.js --symbols AAPL,TSLA,NVDA --from 2026-02-02 --to 2026-02-27
 *   node scripts/massiveBacktest.js --symbols AAPL --from 2026-02-02 --to 2026-02-02 --timespan minute
 *   node scripts/massiveBacktest.js --symbols NVDA --from 2026-02-02 --to 2026-02-27 --risk mid --buffer 0.002
 *
 * Environment variables:
 *   MASSIVE_API_KEY - your Massive API key
 */

import { SniperStrategy } from '../src/strategies/SniperStrategy.js';
import { MarkerService } from '../src/market/MarkerService.js';
import { BacktestStats } from '../src/backtest/BacktestStats.js';
import { MassiveData } from '../src/data/MassiveData.js';
import fs from 'node:fs/promises';
import path from 'node:path';

// Parse CLI args
function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {
        symbols: ['AAPL', 'TSLA', 'NVDA'],
        from: '2026-02-02',
        to: '2026-02-27',
        timespan: 'minute', // 'second' or 'minute'
        windowMinutes: 30,   // how many minutes of opening data to use
        risk: 'low',         // high=1, mid=2, low=3
        buffer: 0.0015,      // 0.15%
        shares: 100,
        trailingStop: true,
        trailingStep: 0.005,
        hardStop: 0.008,       // 0.8% default hard stop
        jsonOut: null,
    };
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--symbols': opts.symbols = args[++i].split(','); break;
            case '--from': opts.from = args[++i]; break;
            case '--to': opts.to = args[++i]; break;
            case '--timespan': opts.timespan = args[++i]; break;
            case '--window': opts.windowMinutes = parseInt(args[++i], 10); break;
            case '--risk': opts.risk = args[++i]; break;
            case '--buffer': opts.buffer = parseFloat(args[++i]); break;
            case '--shares': opts.shares = parseInt(args[++i], 10); break;
            case '--no-trailing': opts.trailingStop = false; break;
            case '--trailing-step': opts.trailingStep = parseFloat(args[++i]); break;
            case '--hard-stop': opts.hardStop = parseFloat(args[++i]); break;
            case '--no-hard-stop': opts.hardStop = 0; break;
            case '--json-out': opts.jsonOut = args[++i]; break;
        }
    }
    return opts;
}

const reverseStopMap = { high: 1, mid: 2, low: 3 };

function formatProfitFactor(value) {
    return value === Infinity ? '∞' : value.toFixed(2);
}

function addMinutes(time, minutes) {
    const [hour, minute, second = '00'] = time.split(':').map(Number);
    const date = new Date(Date.UTC(2000, 0, 1, hour, minute + minutes, second));
    return date.toISOString().slice(11, 19);
}

function isTimeInRange(time, start, end) {
    return time >= start && time < end;
}

function groupBarsByDate(bars) {
    const byDate = new Map();
    for (const bar of bars) {
        if (!byDate.has(bar.date)) byDate.set(bar.date, []);
        byDate.get(bar.date).push(bar);
    }
    return byDate;
}

async function writeJsonSnapshot(outputPath, opts, stats, setups) {
    const payload = {
        source: 'Massive',
        generated_at: new Date().toISOString(),
        period: { from: opts.from, to: opts.to },
        symbols: opts.symbols,
        config: {
            timespan: opts.timespan,
            windowMinutes: opts.windowMinutes,
            risk: opts.risk,
            buffer: opts.buffer,
            shares: opts.shares,
            trailingStop: opts.trailingStop,
            trailingStep: opts.trailingStep,
        },
        stats: {
            ...stats,
            profit_factor: stats.profit_factor === Infinity ? null : stats.profit_factor,
            profit_factor_display: formatProfitFactor(stats.profit_factor),
        },
        setups,
    };

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(payload, null, 2) + '\n');
    console.log(`\n Wrote JSON snapshot: ${outputPath}`);
}

async function runBacktest(opts) {
    const apiKey = process.env.MASSIVE_API_KEY;
    if (!apiKey) {
        console.error('ERROR: MASSIVE_API_KEY environment variable not set');
        process.exit(1);
    }

    const massive = new MassiveData({ apiKey });
    const reverseStopCount = reverseStopMap[opts.risk] ?? 3;

    console.log(`\n=== Massive Data Backtest ===`);
    console.log(`Symbols: ${opts.symbols.join(', ')}`);
    console.log(`Period: ${opts.from} → ${opts.to}`);
    console.log(`Timespan: ${opts.timespan} bars, window: first ${opts.windowMinutes} min`);
    console.log(`Config: risk=${opts.risk} (reverseStop=${reverseStopCount}), buffer=${(opts.buffer * 100).toFixed(2)}%`);
    console.log(`Trailing stop: ${opts.trailingStop ? 'ON' : 'OFF'} (step=${(opts.trailingStep * 100).toFixed(2)}%)`);
    console.log(`Hard stop: ${opts.hardStop > 0 ? (opts.hardStop * 100).toFixed(1) + '%' : 'OFF'}`);
    console.log(`Shares: ${opts.shares}`);
    console.log('');

    const allSetups = [];
    const dailyCache = {};

    for (const symbol of opts.symbols) {
        console.log(`Fetching ${symbol}...`);

        // Fetch daily bars for marker computation
        const daily = await massive.fetchDailyForMarkers(symbol, opts.from, opts.to);
        if (daily.length < 2) {
            console.log(`  ⚠ Not enough daily data for ${symbol} (${daily.length} days)`);
            continue;
        }
        dailyCache[symbol] = daily;

        // Fetch intraday bars once per symbol to avoid per-day API request bursts.
        let intradayByDate;
        try {
            const intradayBars = opts.timespan === 'second'
                ? await massive.fetchSecondBars(symbol, opts.from, opts.to)
                : await massive.fetchMinuteBars(symbol, opts.from, opts.to);
            intradayByDate = groupBarsByDate(intradayBars);
        } catch (e) {
            console.log(`  ⚠ Error fetching intraday bars for ${symbol}: ${e.message}`);
            continue;
        }

        const symbolSetups = [];
        for (let di = 1; di < daily.length; di++) {
            const day = daily[di];
            const dateStr = day.date;
            const intraday = intradayByDate.get(dateStr) || [];

            if (!intraday || intraday.length < 2) continue;

            // Filter to market hours (9:30 AM - 4:00 PM ET is standard)
            // Use opening window for entry (first N minutes)
            const windowStart = '09:30:00';
            const windowEnd = addMinutes(windowStart, opts.windowMinutes);
            const openingBars = intraday.filter(b => isTimeInRange(b.time, windowStart, windowEnd));
            const allDayBars = intraday.filter(b => isTimeInRange(b.time, windowStart, '16:00:00'));

            if (openingBars.length < 2) continue;

            // Compute markers from daily data
            const markers = MarkerService.compute(daily, di);
            const markerList = MarkerService.buildList(markers);

            // Run strategy
            const strategy = new SniperStrategy({
                bufferPct: opts.buffer,
                windowStart,
                windowEnd,
                reverseStopCount,
                trailingStop: opts.trailingStop,
                trailingStepPct: opts.trailingStep,
                hardStopPct: opts.hardStop,
            });
            strategy.reset(markerList, { date: dateStr, symbol });

            // Feed bars through strategy (opening window + rest of day)
            for (const bar of allDayBars) {
                strategy.evaluate(bar);
                if (strategy.getState().phase === 'CLOSED') break;
            }
            strategy.finalize(allDayBars[allDayBars.length - 1]);

            const state = strategy.getState();
            const trade = state.trades[0];

            const setup = {
                symbol, date: dateStr,
                bias: null, status: 'SKIPPED',
                confirm_marker: null, target_marker: null,
                entry_price: null, exit_price: null, pnl: 0,
                shares: opts.shares, exit_reason: null,
            };

            if (state.phase === 'NO_CROSS') {
                setup.bias = 'NEUTRAL'; setup.exit_reason = 'NO_MARKER_CROSS';
            } else if (state.phase === 'NO_RETEST') {
                setup.bias = state.crossDir === 'DOWN' ? 'SELL' : 'BUY';
                setup.confirm_marker = state.crossMarker;
                setup.exit_reason = 'NO_RETEST';
            } else if (trade) {
                setup.bias = trade.direction;
                setup.confirm_marker = trade.entryMarker;
                setup.target_marker = trade.profitMarker;
                setup.entry_price = trade.entryPrice;
                setup.exit_price = trade.exitPrice;
                setup.status = trade.outcome;
                setup.exit_reason = trade.exitReason;
                const dir = trade.direction === 'BUY' ? 1 : -1;
                setup.pnl = (trade.exitPrice - trade.entryPrice) * opts.shares * dir;
            }

            symbolSetups.push(setup);
        }

        allSetups.push(...symbolSetups);
        const symStats = BacktestStats.compute(symbolSetups);
        console.log(`  ${symbol}: ${symbolSetups.length} setups, ${symStats.taken} trades, ${symStats.win_rate.toFixed(1)}% win, PnL $${symStats.net_pnl.toFixed(2)}`);
    }

    // Overall stats
    const stats = BacktestStats.compute(allSetups);
    console.log(`\n═══════════════════════════════════════════`);
    console.log(` OVERALL RESULTS`);
    console.log(`═══════════════════════════════════════════`);
    console.log(` Total setups:    ${stats.total_setups}`);
    console.log(` Trades taken:    ${stats.taken}`);
    console.log(` Wins:            ${stats.wins}`);
    console.log(` Losses:          ${stats.losses}`);
    console.log(` Skipped:         ${stats.skipped}`);
    console.log(` Win rate:        ${stats.win_rate.toFixed(1)}%`);
    console.log(` Net PnL:         $${stats.net_pnl.toFixed(2)}`);
    console.log(` Profit factor:   ${formatProfitFactor(stats.profit_factor)}`);
    console.log(` Avg win:         $${stats.avg_win.toFixed(2)}`);
    console.log(` Avg loss:        $${Math.abs(stats.avg_loss).toFixed(2)}`);
    console.log(` Max drawdown:    $${Math.abs(stats.max_drawdown).toFixed(2)}`);
    console.log(` Expectancy:      $${stats.expectancy.toFixed(2)}/trade`);

    // Per-symbol breakdown
    console.log(`\n Per-symbol:`);
    const perSym = {};
    for (const s of allSetups) {
        if (!perSym[s.symbol]) perSym[s.symbol] = { setups: 0, taken: 0, wins: 0, pnl: 0 };
        perSym[s.symbol].setups++;
        if (s.status !== 'SKIPPED') perSym[s.symbol].taken++;
        if (s.status === 'WON') perSym[s.symbol].wins++;
        perSym[s.symbol].pnl += s.pnl;
    }
    for (const [sym, s] of Object.entries(perSym).sort()) {
        const wr = s.taken > 0 ? ((s.wins / s.taken) * 100).toFixed(1) : '0.0';
        console.log(`   ${sym.padEnd(6)} setups=${String(s.setups).padStart(3)}  taken=${String(s.taken).padStart(3)}  win=${wr.padStart(5)}%  PnL=$${s.pnl.toFixed(2)}`);
    }

    // Recent trades
    const recentTrades = allSetups
        .filter(s => s.status !== 'SKIPPED')
        .slice(-10);
    if (recentTrades.length) {
        console.log(`\n Recent trades:`);
        for (const t of recentTrades) {
            const pnl = t.pnl >= 0 ? `+$${t.pnl.toFixed(2)}` : `-$${Math.abs(t.pnl).toFixed(2)}`;
            const marker = t.confirm_marker || '-';
            console.log(`   ${t.date} ${t.symbol.padEnd(5)} ${t.bias.padEnd(4)} ${marker.padEnd(18)} ${t.exit_reason?.padEnd(20) || ''} ${pnl}`);
        }
    }

    if (opts.jsonOut) {
        await writeJsonSnapshot(opts.jsonOut, opts, stats, allSetups);
    }
    console.log('');
}

const opts = parseArgs();
runBacktest(opts).catch(err => {
    console.error('Backtest failed:', err.message);
    process.exit(1);
});
