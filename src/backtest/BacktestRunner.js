import { MarkerService } from '../market/MarkerService.js';
import { BacktestStats } from './BacktestStats.js';
import { MarketContext } from '../context/MarketContext.js';
import { RiskManager } from '../risk/RiskManager.js';

/**
 * Backtest Runner — multi-symbol, multi-day backtest with context-aware parameters.
 */
export class BacktestRunner {
    constructor(config) {
        this.symbols = config.symbols;
        this.shares = config.shares ?? 100;
        this.dailyBars = config.dailyBars;
        this.barsMap = config.barsMap || {};
        this.strategyFactory = config.strategyFactory;
        this.monthFilter = config.monthFilter || null;
        this.sentiment = config.sentiment || {};
        this.marketContext = config.marketContext || null;
        this.riskManager = config.riskManager || null;
    }

    run() {
        const setups = [];
        for (const symbol of this.symbols) {
            const daily = this.dailyBars[symbol] || [];
            if (this.riskManager) this.riskManager.resetDaily();
            for (let i = 1; i < daily.length; i++) {
                if (this.monthFilter && !daily[i].date.startsWith(this.monthFilter)) continue;
                setups.push(this._runDay(symbol, daily, i));
            }
        }
        const stats = BacktestStats.compute(setups);
        return {
            stats, setups,
            symbols: this.symbols, shares: this.shares,
            equity: stats.equity, perSymbol: stats.perSymbol,
        };
    }

    _runDay(symbol, daily, i) {
        const day = daily[i];
        const markers = MarkerService.compute(daily, i);
        const markerList = MarkerService.buildList(markers);
        const sent = this.sentiment[symbol] || { score: 0, summary: '' };

        const setup = {
            symbol, date: day.date, open: day.o, close: day.c,
            sentiment_score: sent.score, sentiment_summary: sent.summary,
            bias: null, status: 'SKIPPED',
            confirm_marker: null, target_marker: null, loss_marker: null,
            entry_price: null, exit_price: null, pnl: 0,
            shares: this.shares, exit_reason: null,
            context_regime: null, context_vix: null,
        };

        // Check market context skip rules
        if (this.marketContext) {
            const skipCheck = this.marketContext.shouldSkip(symbol, day.date);
            const ctxSummary = this.marketContext.summary();
            setup.context_regime = ctxSummary.regime;
            setup.context_vix = ctxSummary.vix;
            if (skipCheck.skip) {
                setup.exit_reason = `CTX_SKIP_${skipCheck.reason}`;
                setup.bias = 'NEUTRAL';
                return setup;
            }
        }

        const bars = this.barsMap[`${symbol}|${day.date}`];
        if (!bars || !bars.length) {
            setup.bias = 'NEUTRAL';
            setup.exit_reason = 'NO_REAL_BARS';
            return setup;
        }

        // Build strategy with context-adjusted params
        const baseConfig = {};
        if (this.marketContext) {
            const adjusted = this.marketContext.adjustParams({
                bufferPct: 0.0015,
                reverseStopCount: 3,
                trailingStepPct: 0.005,
            });
            Object.assign(baseConfig, adjusted.adjusted);
            setup.context_regime = adjusted.regime;
        }

        const strategy = this.strategyFactory(baseConfig);
        strategy.reset(markerList, { sentiment: sent });
        for (const bar of bars) strategy.evaluate(bar);
        strategy.finalize(bars[bars.length - 1]);
        const state = strategy.getState();

        if (state.phase === 'NO_CROSS') {
            setup.bias = 'NEUTRAL'; setup.exit_reason = 'NO_MARKER_CROSS'; return setup;
        }
        if (state.phase === 'NO_RETEST') {
            setup.bias = state.crossDir === 'DOWN' ? 'SELL' : 'BUY';
            setup.confirm_marker = state.crossMarker;
            setup.exit_reason = 'NO_RETEST';
            return setup;
        }

        const trade = state.trades[0];
        if (trade) {
            setup.bias = trade.direction;
            setup.confirm_marker = trade.entryMarker;
            setup.target_marker = trade.profitMarker;
            setup.entry_price = trade.entryPrice;
            setup.exit_price = trade.exitPrice;
            setup.status = trade.outcome;
            setup.exit_reason = trade.exitReason;
            const dir = trade.direction === 'BUY' ? 1 : -1;
            setup.pnl = (trade.exitPrice - trade.entryPrice) * this.shares * dir;
        }
        return setup;
    }
}
