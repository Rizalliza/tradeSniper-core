#!/usr/bin/env node
/**
 * Multi-timeframe backtest comparison.
 *
 * Runs the SniperStrategy across different bar sizes to find the optimal
 * timeframe for signal detection.
 *
 * Usage:
 *   node scripts/timeframeCompare.js --symbols AAPL,TSLA,NVDA --from 2026-02-02 --to 2026-02-27
 *
 * Compares: 5s, 10s, 15s, 30s, 1min, 5min
 */

import { SniperStrategy } from '../src/strategies/SniperStrategy.js';
import { MarkerService } from '../src/market/MarkerService.js';
import { BarLoader } from '../src/market/BarLoader.js';
import { BacktestStats } from '../src/backtest/BacktestStats.js';
import { MassiveData } from '../src/data/MassiveData.js';
import { MarketContext } from '../src/context/MarketContext.js';

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {
        symbols: ['AAPL'],
        from: '2026-02-02',
        to: '2026-02-27',
        risk: 'low',
        buffer: 0.0015,
        shares: 100,
    };
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--symbols': opts.symbols = args[++i].split(','); break;
            case '--from': opts.from = args[++i]; break;
            case '--to': opts.to = args[++i]; break;
            case '--risk': opts.risk = args[++i]; break;
            case '--buffer': opts.buffer = parseFloat(args[++i]); break;
            case '--shares': opts.shares = parseInt(args[++i], 10); break;
        }
    }
    return opts;
}

const opts = parseArgs();
const reverseStopMap = { high: 1, mid: 2, low: 3 };
const reverseStopCount = reverseStopMap[opts.risk] ?? 3;

// Timeframes to compare: { label, barMultiplier (relative to raw seconds bars
const TIMEFRAMES = [
    { label: '5s',   agg: 5,   timespan: 'second' },
    { label: '10s',  agg: 10,  timespan: 'second' },
    { label: '15s',  agg: 15,  timespan: 'second' },
    { label: '30s',  agg: 30,  timespan: 'second' },
    { label: '1min', agg: 60,  timespan: 'second' },
    { label: '5min', agg: 5,   timespan: 'minute' },
    { label: '15min',agg: 15,  timespan: 'minute' },
];

const md = new MassiveData({ apiKey: process.env.MASSIVE_API_KEY });

async function getDailyBars(symbol) {
    // Fetch 30 days before the start date for marker computation
    const fromDate = new Date(opts.from);
    fromDate.setDate(fromDate.getDate() - 45);
    const fromStr = fromDate.toISOString().slice(0, 10);
    const bars = await md.fetchAggregates(symbol, 1, 'day', fromStr, opts.to, 50000);
    return bars.map(b => ({ date: b.date, o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume }));
}

async function runBacktest(symbol, dailyBars, secBars, aggSize, isSeconds) {
    const setups = [];
    const daily = dailyBars.filter(d => d.date >= opts.from && d.date <= opts.to);

    // Aggregate bars
    const aggBars = isSeconds
        ? BarLoader.aggregate(secBars, aggSize)
        : secBars; // for minute data, we aggregate differently
    const barsByDate = BarLoader.toBarsMap(aggBars);

    for (let di = 1; di < dailyBars.length; di++) {
        const day = dailyBars[di];
        if (day.date < opts.from || day.date > opts.to) continue;

        const markers = MarkerService.compute(dailyBars, di);
        const markerList = MarkerService.buildList(markers);

        const dayBars = barsByDate[`${symbol}|${day.date}`] || [];
        // Filter trading window
        if (dayBars.length < 2) continue;

        const strategy = new SniperStrategy({
            bufferPct: opts.buffer,
            reverseStopCount,
            trailingStop: true,
            trailingStepPct: 0.005,
            hardStopPct: 0.008,
        });
        strategy.reset(markerList, { date: day.date, symbol });

        for (const bar of dayBars) {
            strategy.evaluate(bar);
            if (strategy.getState().phase === 'CLOSED') break;
        }
        strategy.finalize(dayBars[dayBars.length - 1]);

        const state = strategy.getState();
        const trade = state.trades[0];

        const setup = {
            symbol, date: day.date,
            open: day.o, close: day.c,
            bias: null, status: state.phase === 'NO_CROSS' ? 'NEUTRAL' : null,
            confirm_marker: null, target_marker: null, loss_marker: null,
            entry_price: null, exit_price: null,
            pnl: 0,
            shares: opts.shares,
            exit_reason: null,
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
            setup.confirm_marker = trade.entryMarker;
            setup.target_marker = trade.profitMarker;
            setup.entry_price = trade.entryPrice;
            setup.exit_price = trade.exitPrice;
            setup.status = trade.outcome;
            setup.exit_reason = trade.exitReason;
            const dir = trade.direction === 'BUY' ? 1 : -1;
            setup.pnl = (trade.exitPrice - trade.entryPrice) * opts.shares * dir;
        }
        setups.push(setup);
    }
    return setups;
}

async function main() {
    const results = {};

    for (const symbol of opts.symbols) {
        console.log(`\n=== ${symbol} ===`);
        const dailyBars = await getDailyBars(symbol);

        // Fetch raw second bars for all second-based timeframes
        console.log(`  Fetching second bars...`);
        const secBars = await md.fetchAggregates(symbol, 1, 'second', opts.from, opts.to, 100000);
        const tradingSecBars = secBars.filter(b => b.time >= '09:30:00' && b.time < '16:00:00');
        console.log(`  Got ${secBars.length} total second bars (${tradingSecBars.length} trading hours)`);

        // Fetch minute bars for minute-based timeframes
        console.log(`  Fetching minute bars...`);
        const minBars = await md.fetchAggregates(symbol, 1, 'minute', opts.from, opts.to, 50000);
        const tradingMinBars = minBars.filter(b => b.time >= '09:30:00' && b.time < '16:00:00');
        console.log(`  Got ${minBars.length} total minute bars (${tradingMinBars.length} trading hours)`);

        for (const tf of TIMEFRAMES) {
            const isSec = tf.timespan === 'second';
            const rawBars = isSec ? tradingSecBars : tradingMinBars;
            const aggSize = isSec ? tf.agg : tf.agg;
            const setups = await runBacktest(symbol, dailyBars, rawBars, aggSize, isSec);
            const stats = BacktestStats.compute(setups);
            results[`${symbol}_${tf.label}`] = stats;
            const pnl = stats.net_pnl.toFixed(2);
            const wr = stats.win_rate.toFixed(1);
            const pf = stats.profit_factor === Infinity ? '∞' : stats.profit_factor.toFixed(2);
            const be = stats.breakeven || 0;
            console.log(`  ${tf.label.padEnd(6)} W=${String(stats.wins).padEnd(2)} L=${String(stats.losses).padEnd(2)} BE=${String(be).padEnd(2)} WR=${wr}%  PnL=$${pnl}  PF=${pf}`);
        }
    }

    // Summary
    console.log('\n══════════════════════════════════════════════════════════');
    console.log('  OVERALL SUMMARY (all symbols)');
    console.log('══════════════════════════════════════════════════════════');
    console.log(`  ${'TF'.padEnd(6)} ${'Wins'.padEnd(5)} ${'Loss'.padEnd(5)} ${'BE'.padEnd(4)} ${'Skip'.padEnd(5)} ${'WR%'.padEnd(7)} ${'P&L'.padEnd(10)} ${'PF'.padEnd(5)} ${'AvgW'.padEnd(8)} ${'AvgL'.padEnd(8)}`);
    console.log('  ─────────────────────────────────────────────────────────');

    for (const tf of TIMEFRAMES) {
        let totalWins = 0, totalLosses = 0, totalBE = 0, totalSkip = 0, totalPnl = 0;
        let totalGP = 0, totalGL = 0;
        for (const symbol of opts.symbols) {
            const s = results[`${symbol}_${tf.label}`];
            if (!s) continue;
            totalWins += s.wins;
            totalLosses += s.losses;
            totalBE += s.breakeven || 0;
            totalSkip += s.skipped;
            totalPnl += s.net_pnl;
            totalGP += s.gross_profit;
            totalGL += s.gross_loss;
        }
        const taken = totalWins + totalLosses;
        const wr = taken ? (totalWins / taken * 100).toFixed(1) : '0.0';
        const pf = totalGL > 0 ? (totalGP / totalGL).toFixed(2) : totalGP > 0 ? '∞' : '0.00';
        const avgW = totalWins ? (totalGP / totalWins).toFixed(0) : '0';
        const avgL = totalLosses ? (totalGL / totalLosses).toFixed(0) : '0';
        console.log(`  ${tf.label.padEnd(6)} ${String(totalWins).padEnd(5)} ${String(totalLosses).padEnd(5)} ${String(totalBE).padEnd(4)} ${String(totalSkip).padEnd(5)} ${wr.padEnd(6)}% $${String(totalPnl.toFixed(0)).padEnd(9)} ${pf.padEnd(5)} $${avgW.padEnd(7)} $${avgL.padEnd(7)}`);
    }
    console.log('══════════════════════════════════════════════════════════');
}

main().catch(console.error);
