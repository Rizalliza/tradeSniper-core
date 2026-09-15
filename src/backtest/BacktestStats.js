export class BacktestStats {
    static compute(setups) {
        const wins = setups.filter(s => s.status === 'WON');
        const losses = setups.filter(s => s.status === 'LOST');
        const breakeven = setups.filter(s => s.status === 'BREAKEVEN');
        const skipped = setups.filter(s => s.status === 'SKIPPED');
        // "Taken" = closed trades with a real outcome (win or loss), not breakeven
        const taken = [...wins, ...losses];
        // "Closed" = all non-skipped (win + loss + breakeven)
        const closed = [...taken, ...breakeven];

        let cum = 0;
        const equity = closed.slice().sort((a, b) => a.date.localeCompare(b.date))
            .map(t => { cum += t.pnl; return { date: t.date, symbol: t.symbol, pnl: t.pnl, cum }; });

        const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
        const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
        const netPnl = closed.reduce((s, t) => s + t.pnl, 0);
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
            const w = st.filter(s => s.status === 'WON');
            const l = st.filter(s => s.status === 'LOST');
            const be = st.filter(s => s.status === 'BREAKEVEN');
            const tk = [...w, ...l];
            const cl = [...tk, ...be];
            const symGrossProfit = w.reduce((s, t) => s + t.pnl, 0);
            const symGrossLoss = Math.abs(l.reduce((s, t) => s + t.pnl, 0));
            return {
                symbol: sym,
                setups: st.length,
                taken: tk.length,
                wins: w.length,
                losses: l.length,
                breakeven: be.length,
                closed: cl.length,
                win_rate: tk.length ? (w.length / tk.length) * 100 : 0,
                pnl: cl.reduce((s, t) => s + t.pnl, 0),
                avg_win: w.length ? symGrossProfit / w.length : 0,
                avg_loss: l.length ? symGrossLoss / l.length : 0,
            };
        });

        return {
            total_setups: setups.length,
            taken: taken.length,
            wins: wins.length,
            losses: losses.length,
            breakeven: breakeven.length,
            skipped: skipped.length,
            closed: closed.length,
            win_rate: winRate,
            profit_factor: profitFactor,
            max_drawdown: maxDD,
            net_pnl: netPnl,
            gross_profit: grossProfit,
            gross_loss: grossLoss,
            avg_rr: avgRr,
            avg_win: avgWin,
            avg_loss: avgLoss,
            expectancy: closed.length ? netPnl / closed.length : 0,
            equity,
            perSymbol,
        };
    }
}
