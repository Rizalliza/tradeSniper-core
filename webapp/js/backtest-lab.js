/**
 * Backtest Lab — Strategy-agnostic backtesting platform
 *
 * Supports:
 * - Multiple strategies (Sniper, Mean Reversion, Breakout, extensible)
 * - Configurable parameters per strategy
 * - Multi-symbol backtesting
 * - Date range control (monthly presets + custom)
 * - Results: stats, trades table, monthly breakdown
 * - Data sources: generated sample or Massive API
 */

import { SniperStrategy } from '/src/strategies/SniperStrategy.js';
import { MeanReversionStrategy } from '/src/strategies/MeanReversionStrategy.js';
import { BreakoutStrategy } from '/src/strategies/BreakoutStrategy.js';
import { BacktestRunner } from '/src/backtest/BacktestRunner.js';
import { MarkerService } from '/src/market/MarkerService.js';
import { DAILY_BARS } from '/src/data/historicalData.js';

// Strategy registry — add new strategies here
const STRATEGIES = {
    sniper: {
        name: 'Sniper (Marker Retest)',
        class: SniperStrategy,
        params: [
            { key: 'bufferPct', label: 'Retest Buffer %', type: 'number', min: 0.0005, max: 0.02, step: 0.0005, default: 0.0015 },
            { key: 'windowStart', label: 'Entry Window Start', type: 'time', default: '09:30:00' },
            { key: 'windowEnd', label: 'Entry Window End', type: 'time', default: '09:45:00' },
            { key: 'reverseStopCount', label: 'Reverse Stop Count', type: 'number', min: 1, max: 10, step: 1, default: 3 },
            { key: 'trailingStop', label: 'Enable Trailing Stop', type: 'checkbox', default: true },
            { key: 'trailingStepPct', label: 'Trailing Step %', type: 'number', min: 0.001, max: 0.02, step: 0.001, default: 0.005 },
        ],
    },
    meanreversion: {
        name: 'Mean Reversion (Bollinger)',
        class: MeanReversionStrategy,
        params: MeanReversionStrategy.getConfig().params,
    },
    breakout: {
        name: 'Breakout (Opening Range)',
        class: BreakoutStrategy,
        params: BreakoutStrategy.getConfig().params,
    },
};

// Default symbols
const DEFAULT_SYMBOLS = ['AAPL', 'TSLA', 'NVDA'];

// Month presets (YYYY-MM)
const MONTH_PRESETS = [
    { key: '2026-02', label: 'FEB', days: ['2026-02-02', '2026-02-13'] },
    { key: '2026-03', label: 'MAR', days: ['2026-03-02', '2026-03-31'] },
    { key: '2026-04', label: 'APR', days: ['2026-04-01', '2026-04-30'] },
    { key: '2026-05', label: 'MAY', days: ['2026-05-01', '2026-05-29'] },
    { key: '2026-06', label: 'JUN', days: ['2026-06-01', '2026-06-30'] },
    { key: '2026-07', label: 'JUL', days: ['2026-07-01', '2026-07-31'] },
    { key: '2026-08', label: 'AUG', days: ['2026-08-01', '2026-08-29'] },
];

export class BacktestLab {
    constructor() {
        this.symbols = [...DEFAULT_SYMBOLS];
        this.currentStrategy = 'sniper';
        this.strategyParams = {};
        this.shares = 100;
        this.dateFrom = '2026-02-02';
        this.dateTo = '2026-02-13';
        this.dataSource = 'generated';
        this.timeframe = '1min';
        this.lastResult = null;
        this.barsCache = {}; // symbol → { date → bars }

        this._initDefaultParams();
    }

    _initDefaultParams() {
        for (const [key, strat] of Object.entries(STRATEGIES)) {
            this.strategyParams[key] = {};
            for (const p of strat.params) {
                this.strategyParams[key][p.key] = p.default;
            }
        }
    }

    getParams(strategyKey) {
        return this.strategyParams[strategyKey] || {};
    }

    setParam(strategyKey, key, value) {
        if (this.strategyParams[strategyKey]) {
            this.strategyParams[strategyKey][key] = value;
        }
    }

    addSymbol(symbol) {
        symbol = symbol.toUpperCase().trim();
        if (symbol && !this.symbols.includes(symbol)) {
            this.symbols.push(symbol);
            return true;
        }
        return false;
    }

    removeSymbol(symbol) {
        const idx = this.symbols.indexOf(symbol);
        if (idx >= 0) {
            this.symbols.splice(idx, 1);
            return true;
        }
        return false;
    }

    clearSymbols() {
        this.symbols = [];
    }

    setDateRange(from, to) {
        this.dateFrom = from;
        this.dateTo = to;
    }

    setMonth(monthKey) {
        const preset = MONTH_PRESETS.find(m => m.key === monthKey);
        if (preset) {
            this.dateFrom = preset.days[0];
            this.dateTo = preset.days[1];
        }
    }

    async run(onProgress) {
        const strategyKey = this.currentStrategy;
        const strategyClass = STRATEGIES[strategyKey].class;
        const params = this.strategyParams[strategyKey];
        const symbols = this.symbols;

        if (!symbols.length) {
            throw new Error('No symbols selected');
        }

        // Build daily bars map (use sample data or fetch from Massive)
        let dailyBars = {};
        let barsMap = {};

        if (this.dataSource === 'generated' || this.dataSource === 'sample') {
            // Use historical daily data + generate intraday bars
            for (const sym of symbols) {
                dailyBars[sym] = DAILY_BARS[sym] || this._generateDailyBars(sym, 60);
                barsMap = { ...barsMap, ...this._generateIntradayBars(sym, dailyBars[sym]) };
            }
        }

        // Filter to date range
        const filteredDaily = {};
        for (const sym of symbols) {
            const bars = (dailyBars[sym] || []).filter(d =>
                d.date >= this.dateFrom && d.date <= this.dateTo
            );
            filteredDaily[sym] = bars;
        }

        const runner = new BacktestRunner({
            symbols,
            shares: this.shares,
            dailyBars: filteredDaily,
            barsMap,
            monthFilter: null,
            strategyFactory: () => new strategyClass({ ...params }),
        });

        const result = runner.run();
        this.lastResult = result;
        return result;
    }

    _generateDailyBars(symbol, count) {
        // Generate synthetic daily bars for symbols without sample data
        const basePrices = { AAPL: 180, TSLA: 250, NVDA: 120, MSFT: 420, GOOGL: 170, AMZN: 180, META: 500 };
        const base = basePrices[symbol] || 100;
        const bars = [];
        let price = base;
        const startDate = new Date('2026-02-02');
        for (let i = 0; i < count; i++) {
            const d = new Date(startDate);
            d.setDate(d.getDate() + i + Math.floor(i / 5) * 2); // skip weekends
            if (d.getDay() === 0 || d.getDay() === 6) continue;
            const change = (Math.random() - 0.48) * base * 0.03;
            const open = price;
            const close = price + change;
            const high = Math.max(open, close) + Math.random() * base * 0.01;
            const low = Math.min(open, close) - Math.random() * base * 0.01;
            bars.push({
                date: d.toISOString().slice(0, 10),
                o: +open.toFixed(2),
                h: +high.toFixed(2),
                l: +low.toFixed(2),
                c: +close.toFixed(2),
            });
            price = close;
        }
        return bars;
    }

    _generateIntradayBars(symbol, dailyBars) {
        const barsMap = {};
        for (let i = 1; i < dailyBars.length; i++) {
            const day = dailyBars[i];
            const prior = dailyBars[i - 1];
            const markers = MarkerService.compute(dailyBars, i);
            const markerList = MarkerService.buildList(markers);

            const bars = [];
            let price = prior.c;

            for (let m = 0; m < 390; m++) {
                const h = 9 + Math.floor((30 + m) / 60);
                const min = (30 + m) % 60;
                const time = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`;

                const spread = Math.abs(price) * 0.0015;
                let delta = 0;

                if (m < 30) {
                    // Opening volatility - drift toward day open
                    delta = (day.o - price) * 0.15;
                } else if (m < 60) {
                    // Morning trend
                    const dailyDir = day.c > day.o ? 1 : -1;
                    delta = dailyDir * Math.abs(price) * 0.002;
                    delta += (Math.random() - 0.5) * Math.abs(price) * 0.003;
                } else if (m < 300) {
                    // Midday noise
                    delta = (Math.random() - 0.5) * Math.abs(price) * 0.002;
                } else {
                    // Close drift
                    delta = (day.c - price) * 0.1;
                }

                price += delta;
                const open = price - delta;
                bars.push({
                    symbol,
                    date: day.date,
                    time,
                    open: +open.toFixed(2),
                    high: +(Math.max(open, price) + spread).toFixed(2),
                    low: +(Math.min(open, price) - spread).toFixed(2),
                    close: +price.toFixed(2),
                    volume: Math.floor(Math.random() * 1000000 + 500000),
                });
            }
            barsMap[`${symbol}|${day.date}`] = bars;
        }
        return barsMap;
    }

    getMonthlyBreakdown(result) {
        const months = {};
        for (const setup of result.setups) {
            const month = setup.date.slice(0, 7);
            if (!months[month]) months[month] = { pnl: 0, trades: 0, wins: 0, taken: 0 };
            months[month].trades++;
            if (['WON', 'LOST'].includes(setup.status)) {
                months[month].taken++;
                months[month].pnl += setup.pnl || 0;
                if (setup.status === 'WON') months[month].wins++;
            }
        }
        return months;
    }

    static getStrategies() {
        return STRATEGIES;
    }

    static getMonthPresets() {
        return MONTH_PRESETS;
    }
}
