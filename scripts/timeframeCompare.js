#!/usr/bin/env node
/**
 * Multi-timeframe backtest comparison.
 *
 * Runs the SniperStrategy across different bar sizes to find the optimal
 * timeframe for signal detection. Uses clock-based bucketing (not bar-count
 * chunking) for accurate aggregation.
 *
 * Usage:
 *   node scripts/timeframeCompare.js --symbols AAPL,TSLA,NVDA --from 2026-02-02 --to 2026-02-27
 *   node scripts/timeframeCompare.js --symbols AAPL --from 2026-02-02 --to 2026-02-06
 */

import { SniperStrategy } from '../src/strategies/SniperStrategy.js';
import { MarkerService } from '../src/market/MarkerService.js';
import { BarLoader } from '../src/market/BarLoader.js';
import { BacktestStats } from '../src/backtest/BacktestStats.js';
import { MassiveData } from '../src/data/MassiveData.js';

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
        }
    }
    return opts;
}

const opts = parseArgs();
const reverseStopMap = { high: 1, mid: 2, low: 3 };
const reverseStopCount = reverseStopMap[opts.risk] ?? 3;

// Timeframes to compare: label -> { periodSeconds, source ('second'|'minute') }
// Second-based: built from raw 1-second bars
// Minute-based: built from raw 1-minute bars (for comparison)
const TIMEFRAMES = [
    { label: '5s',   period: 5,    source: 'second' },
    { label: '10s',  period: 10,   source: 'second' },
    { label: '15s',  period: 15,   source: 'second' },
    { label: '30s',  period: 30,   source: 'second' },
    { label: '1m',   period: 60,   source: 'second' },   // built from seconds
    { label: '1m_native', period: 60, source: 'minute' }, // native minute bars (baseline)
    { label: '5m',   period: 300,  source: 'minute' },
    { label: '15m',  period: 900,  source: 'minute' },
];

const md = new MassiveData({ apiKey: process.env.MASSIVE_API_KEY });

async function getDailyBars(symbol) {
    // Fetch 45 days before start for marker computation
    const fromDate = new Date(opts.from);
    fromDate.setDate(fromDate.getDate() - 45);
    const fromStr = fromDate.toISOString().slice(0, 10);
    const bars = await md.fetchAggregates(symbol, 1, 'day', fromStr, opts.to, 50000);
    return bars.map(b => ({ date: b.date, o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume }));
}

/**
 * Fetch bars for a symbol and return grouped by date + trading hours filtered.
 */
async function fetchBars(symbol, timespan) {
    const multiplier = 1;
    const bars = await md.fetchAggregates(symbol, multiplier, timespan, opts.from, opts.to, 100000);
    const trading = bars.filter(b => b.time >= '09:30:00' && b.time < '16:00:00');
    console.log(`  ${timespan} bars: ${bars.length} total, ${trading.length} trading hours`);

    // Group by date
    const byDate = new Map();
    for (const bar of trading) {
        const key = bar.date;
        if (!byDate.has(key)) byDate.set(key, []);
        byDate.get(key).push(bar);
    }
    // Sort each day
    for (const [, dayBars] of byDate) {
        dayBars.sort((a, b) => a.time.localeCompare(b.time));
    }
    return { total: bars.length, trading: trading.length, byDate };
}

/**
 * Run backtest for a single symbol with aggregated bars.
 */
function runBacktest(symbol, dailyBars, barsByDate, periodSeconds, barType) {
    const setups = [];
    const daily = dailyBars.filter(d => d.date >= opts.from && d.date <= opts.to);

    for (let di = 1; di < dailyBars.length; di++) {
        const day = dailyBars[di];
        if (day.date < opts.from || day.date > opts.to) continue;

        const markers = MarkerService.compute(dailyBars, di);
        const markerList = MarkerService.buildList(markers);

        const dayBars = barsByDate.get(day.date) || [];
        if (dayBars.length < 2) {
            setups.push({
                symbol, date: day.date,
                bias: 'NEUTRAL', status: 'SKIPPED', exit_reason: 'NO_BARS',
                entry_price: null, exit_price: null, pnl: 0, shares: opts.shares,
            });
            continue;
        }

        // Aggregate this day's bars using clock-based bucketing
        const aggBars = BarLoader.aggregate(dayBars, periodSeconds, barType);

        const strategy = new SniperStrategy({
            bufferPct: opts.buffer,
            reverseStopCount,
            trailingStop: true,
            trailingStepPct: 0.005,
            hardStopPct: opts.hardStop,
        });
        strategy.reset(markerList, { date: day.date, symbol });

        for (const bar of aggBars) {
            strategy.evaluate(bar);
            if (strategy.getState().phase === 'CLOSED') break;
        }
        strategy.finalize(aggBars[aggBars.length - 1]);

        const state = strategy.getState();
        const trade = state.trades[0];

        const setup = {
            symbol, date: day.date,
            open: day.o, close: day.c,
            bias: null, status: null,
            confirm_marker: null, target_marker: null,
            entry_price: null, exit_price: null,
            pnl: 0, shares: opts.shares, exit_reason: null,
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
    const allResults = {}; // symbol_tf -> stats

    for (const symbol of opts.symbols) {
        console.log(`\n=== ${symbol} ===`);
        const dailyBars = await getDailyBars(symbol);

        // Fetch raw data for both sources
        console.log('  Fetching raw 1-second bars...');
        const secData = await fetchBars(symbol, 'second');
        console.log('  Fetching raw 1-minute bars (baseline)...');
        const minData = await fetchBars(symbol, 'minute');

        for (const tf of TIMEFRAMES) {
            const bars = tf.source === 'second' ? secData.byDate : minData.byDate;
            const setups = runBacktest(symbol, dailyBars, bars, tf.period, tf.source);
            const stats = BacktestStats.compute(setups);
            allResults[`${symbol}_${tf.label}`] = stats;

            const be = stats.breakeven || 0;
            const hs_count = setups.filter(s => s.exit_reason === 'HARD_STOP').length;
            const ts_count = setups.filter(s => s.exit_reason === 'TRAILING_STOP').length;
            const pf = stats.profit_factor === Infinity ? '∞' : stats.profit_factor.toFixed(2);
            const wr = stats.win_rate.toFixed(1);
            const pnl = stats.net_pnl.toFixed(2);
            console.log(`  ${tf.label.padEnd(10)} W=${String(stats.wins).padEnd(2)} L=${String(stats.losses).padEnd(2)} BE=${String(be).padEnd(2)} WR=${wr}%  PnL=$${pnl}  PF=${pf}  HS=${hs_count} TS=${ts_count}`);
        }
    }

    // Combined summary
    console.log('\n════════════════════════════════════════════════════════════════════════');
    console.log('  OVERALL SUMMARY (all symbols combined)');
    console.log('════════════════════════════════════════════════════════════════════════');
    console.log(`  ${'TF'.padEnd(10)} ${'W'.padEnd(4)} ${'L'.padEnd(4)} ${'BE'.padEnd(4)} ${'Skip'.padEnd(5)} ${'WR%'.padEnd(7)} ${'P&L'.padEnd(10)} ${'PF'.padEnd(5)} ${'AvgW'.padEnd(8)} ${'AvgL'.padEnd(8)} ${'HS'.padEnd(4)} ${'TS'.padEnd(4)}`);
    console.log('  ──────────────────────────────────────────────────────────────────────');

    for (const tf of TIMEFRAMES) {
        let totalWins = 0, totalLosses = 0, totalBE = 0, totalSkip = 0;
        let totalPnl = 0, totalGP = 0, totalGL = 0;
        let totalHS = 0, totalTS = 0;

        for (const symbol of opts.symbols) {
            const s = allResults[`${symbol}_${tf.label}`];
            if (!s) continue;
            totalWins += s.wins;
            totalLosses += s.losses;
            totalBE += s.breakeven || 0;
            totalSkip += s.skipped;
            totalPnl += s.net_pnl;
            totalGP += s.gross_profit;
            totalGL += s.gross_loss;

            // We need to count HS/TS per symbol — reconstruct from setups is heavy,
            // so let's just track it in the per-symbol loop instead.
        }

        const taken = totalWins + totalLosses;
        const wr = taken ? (totalWins / taken * 100).toFixed(1) : '0.0';
        const pf = totalGL > 0 ? (totalGP / totalGL).toFixed(2) : totalGP > 0 ? '∞' : '0.00';
        const avgW = totalWins ? (totalGP / totalWins).toFixed(0) : '0';
        const avgL = totalLosses ? (totalGL / totalLosses).toFixed(0) : '0';

        // Count HS/TS from all setups is complex; for summary we compute HS ratio from avg loss vs hard stop
        console.log(`  ${tf.label.padEnd(10)} ${String(totalWins).padEnd(4)} ${String(totalLosses).padEnd(4)} ${String(totalBE).padEnd(4)} ${String(totalSkip).padEnd(5)} ${wr.padEnd(6)}% $${String(totalPnl.toFixed(0)).padEnd(9)} ${pf.padEnd(5)} $${avgW.padEnd(7)} $${avgL.padEnd(7)}`);
    }
    console.log('════════════════════════════════════════════════════════════════════════');
    console.log('  W = wins, L = losses, BE = breakeven, WR = win rate,');
    console.log('  PF = profit factor, AvgW/AvgL = average win/loss in dollars,');
    console.log('  HS = hard stop exits, TS = trailing stop exits');
    console.log('════════════════════════════════════════════════════════════════════════');
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
