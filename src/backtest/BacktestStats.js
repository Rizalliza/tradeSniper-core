export class BacktestStats {
    static compute(setups) {
        const taken = setups.filter(s => ['WON', 'LOST'].includes(s.status));
        const wins = setups.filter(s => s.status === 'WON');
        const losses = setups.filter(s => s.status === 'LOST');
        const skipped = setups.filter(s => s.status === 'SKIPPED');

        let cum = 0;
        const equity = taken.slice().sort((a, b) => a.date.localeCompare(b.date))
            .map(t => { cum += t.pnl; return { date: t.date, symbol: t.symbol, pnl: t.pnl, cum }; });

        const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
        const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
        const netPnl = taken.reduce((s, t) => s + t.pnl, 0);
        const winRate = taken.length ? (wins.length / taken.length) * 100 : 0;
        const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

        let peak = 0, maxDD = 0;
        equity.forEach(e => { peak = Math.max(peak, e.cum); maxDD = Math.max(maxDD, peak - e.cum); });

        const avgWin = wins.length ? grossProfit / wins.length : 0;
        const avgLoss = losses.length ? grossLoss / losses.length : 0;
        const avgRr = avgLoss > 0.01 ? avgWin / avgLoss : avgWin > 0 ? 999 : 0;

        const symbols = [...new Set(setups.map(s => s.symbol))];
        const perSymbol = symbols.map(sym => {
            const st = setups.filter(s => s.symbol === sym);
            const tk = st.filter(s => ['WON', 'LOST'].includes(s.status));
            const w = st.filter(s => s.status === 'WON').length;
            return {
                symbol: sym, setups: st.length, taken: tk.length, wins: w,
                win_rate: tk.length ? (w / tk.length) * 100 : 0,
                pnl: tk.reduce((s, t) => s + t.pnl, 0),
            };
        });

        return {
            total_setups: setups.length, taken: taken.length,
            wins: wins.length, losses: losses.length, skipped: skipped.length,
            win_rate: winRate, profit_factor: profitFactor,
            max_drawdown: maxDD, net_pnl: netPnl,
            gross_profit: grossProfit, gross_loss: grossLoss, avg_rr: avgRr,
            avg_win: avgWin, avg_loss: avgLoss,
            expectancy: taken.length ? netPnl / taken.length : 0,
            equity, perSymbol,
        };
    }
}