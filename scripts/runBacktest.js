#!/usr/bin/env node
import { BacktestRunner } from '../src/backtest/BacktestRunner.js';
import { SniperStrategy } from '../src/strategies/SniperStrategy.js';
import { BarLoader } from '../src/market/BarLoader.js';
import { DAILY_BARS, FEB_SENTIMENT } from '../src/data/historicalData.js';

const args = process.argv.slice(2);
const getArg = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };

const barsPath = getArg('--bars');
const monthFilter = getArg('--month') || '2026-02';
const riskMode = getArg('--risk') || 'low';
const customStop = getArg('--reverse-stop') ? parseInt(getArg('--reverse-stop'), 10) : null;
const windowEnd = getArg('--window-end') || '09:45:00';
const bufferPct = getArg('--buffer') ? parseFloat(getArg('--buffer')) : 0.0015;
const RISK_MAP = { high: 1, mid: 2, low: 3 };
const reverseStopCount = customStop ?? RISK_MAP[riskMode] ?? 3;

const symbols = Object.keys(DAILY_BARS);
let barsMap = {};
if (barsPath) {
    const bars = BarLoader.fromCSV(barsPath);
    barsMap = BarLoader.toBarsMap(bars);
    console.log(`Loaded ${bars.length} bars from ${barsPath}`);
    console.log(`Days with data: ${Object.keys(barsMap).length}`);
} else {
    console.log('No --bars provided — running with no intraday data (all skipped)');
}

console.log(`\nStrategy config: risk=${riskMode} (reverseStop=${reverseStopCount}), buffer=${(bufferPct * 100).toFixed(2)}%, window=09:30-${windowEnd}`);
console.log(`Symbols: ${symbols.join(', ')}, shares=100, month=${monthFilter}`);

const runner = new BacktestRunner({
    symbols, shares: 100, dailyBars: DAILY_BARS, barsMap, monthFilter,
    sentiment: FEB_SENTIMENT,
    strategyFactory: () => new SniperStrategy({ windowEnd, bufferPct, reverseStopCount }),
});
const result = runner.run();
const s = result.stats;

console.log('\n╔══════════════════════════════════════╗');
console.log('║       BACKTEST RESULTS               ║');
console.log('╠══════════════════════════════════════╣');
console.log(`║ Total setups:  ${String(s.total_setups).padEnd(18)} ║`);
console.log(`║ Taken:         ${String(s.taken).padEnd(18)} ║`);
console.log(`║ Wins:          ${String(s.wins).padEnd(18)} ║`);
console.log(`║ Losses:        ${String(s.losses).padEnd(18)} ║`);
console.log(`║ Breakeven:     ${String(s.breakeven).padEnd(18)} ║`);
console.log(`║ Skipped:       ${String(s.skipped).padEnd(18)} ║`);
console.log(`║ Win rate:      ${s.win_rate.toFixed(1).padEnd(17)}% ║`);
console.log(`║ Net P&L:       $${s.net_pnl.toFixed(2).padEnd(16)} ║`);
console.log(`║ Profit factor: ${(s.profit_factor === Infinity ? '∞' : s.profit_factor.toFixed(2)).padEnd(18)} ║`);
console.log(`║ Max drawdown:  $${s.max_drawdown.toFixed(2).padEnd(16)} ║`);
console.log(`║ Avg Win/Loss:  ${(s.avg_win/s.avg_loss > 99 ? '∞' : (s.avg_win/s.avg_loss).toFixed(2)).padEnd(18)} ║`);
console.log('╚══════════════════════════════════════╝');

if (s.perSymbol.length) {
    console.log('\nPer-symbol:');
    for (const ps of s.perSymbol) {
        console.log(`  ${ps.symbol.padEnd(6)} setups=${String(ps.setups).padEnd(3)} taken=${String(ps.taken).padEnd(3)} BE=${String(ps.breakeven).padEnd(2)} win=${ps.win_rate.toFixed(1).padStart(5)}%  PnL=$${ps.pnl.toFixed(2).padStart(8)}  avgW=$${ps.avg_win.toFixed(2).padStart(6)} avgL=$${ps.avg_loss.toFixed(2).padStart(6)}`);
    }
}
const trades = result.setups.filter(s => ['WON', 'LOST', 'BREAKEVEN'].includes(s.status));
if (trades.length) {
    console.log('\nRecent trades:');
    for (const t of trades.slice(-10)) {
        const emoji = t.status === 'WON' ? '✅' : t.status === 'LOST' ? '❌' : '➖';
        const sign = t.pnl >= 0 ? '+' : '';
        console.log(`  ${emoji} ${t.date} ${t.symbol.padEnd(4)} ${t.bias.padEnd(4)} ${t.entry_price.toFixed(2)} → ${t.exit_price.toFixed(2)} (${t.exit_reason}) ${sign}$${t.pnl.toFixed(2)}`);
    }
}