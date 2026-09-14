import { BaseStrategy } from './BaseStrategy.js';
import { MarkerService } from '../market/MarkerService.js';

/**
 * Breakout Strategy
 *
 * Trades range breakouts with volume confirmation.
 * Price breaks above a resistance level (or below support) with expanding range = breakout.
 *
 * Rules:
 * - Pre-market range: high/low of first 15 minutes
 * - BUY breakout: price closes above pre-market high with expanding range
 * - SELL breakdown: price closes below pre-market low with expanding range
 * - Stop loss: other side of the pre-market range
 * - Target: 1.5x range size (risk:reward ~ 1:1.5)
 * - Trailing stop: after reaching 1R profit
 */
export class BreakoutStrategy extends BaseStrategy {
    constructor(config = {}) {
        super(config);
        this.rangeStart = config.rangeStart || '09:30:00';
        this.rangeEnd = config.rangeEnd || '09:45:00';
        this.entryWindowEnd = config.entryWindowEnd || '11:00:00';
        this.minRangePct = config.minRangePct || 0.008; // min 0.8% range
        this.riskReward = config.riskReward || 1.5; // target = range * 1.5
        this.expansionFactor = config.expansionFactor || 1.2; // candle must be 1.2x avg
        this.trailingStop = config.trailingStop !== false;
        this.trailingStepPct = config.trailingStepPct || 0.004;
        this._bars = [];
        this._prevBar = null;
        this._barIndex = 0;
        this._rangeHigh = null;
        this._rangeLow = null;
        this._rangeComplete = false;
    }

    reset(markerList, context = {}) {
        super.reset(markerList, context);
        this.markerList = markerList;
        this.entryPrice = null;
        this.entryDir = null;
        this.entryBarIdx = -1;
        this.stopLoss = null;
        this.takeProfit = null;
        this.trailingActive = false;
        this.trailingLevel = null;
        this._bars = [];
        this._prevBar = null;
        this._barIndex = 0;
        this._rangeHigh = null;
        this._rangeLow = null;
        this._rangeComplete = false;
    }

    _inRangePeriod(bar) {
        const t = bar.time.slice(0, 8);
        return t >= this.rangeStart.slice(0, 8) && t < this.rangeEnd.slice(0, 8);
    }

    _inEntryWindow(bar) {
        const t = bar.time.slice(0, 8);
        return t >= this.rangeEnd.slice(0, 8) && t < this.entryWindowEnd.slice(0, 8);
    }

    evaluate(bar) {
        const idx = this._barIndex++;
        this._bars.push(bar);

        // Build the opening range
        if (this._inRangePeriod(bar)) {
            this._rangeHigh = this._rangeHigh === null ? bar.high : Math.max(this._rangeHigh, bar.high);
            this._rangeLow = this._rangeLow === null ? bar.low : Math.min(this._rangeLow, bar.low);
            this.phase = 'BUILDING_RANGE';
        } else if (!this._rangeComplete && this._rangeHigh !== null) {
            this._rangeComplete = true;
            this.phase = 'WAITING_BREAKOUT';
        }

        // Look for breakout
        if (this.phase === 'WAITING_BREAKOUT' && this._inEntryWindow(bar) && this._prevBar) {
            this._checkBreakout(bar, idx);
        } else if (this.phase === 'IN_TRADE' && this._prevBar && idx !== this.entryBarIdx) {
            this._manageTrade(bar, idx);
        }

        this._prevBar = bar;
        return this.getState();
    }

    _checkBreakout(bar, idx) {
        const rangeSize = this._rangeHigh - this._rangeLow;
        const rangePct = rangeSize / this._rangeLow;
        if (rangePct < this.minRangePct) return; // range too narrow

        const avgRange = this._avgBarRange(10);
        const candleRange = bar.high - bar.low;
        const expanding = avgRange > 0 && candleRange > avgRange * this.expansionFactor;

        // Bullish breakout
        if (bar.close > this._rangeHigh && expanding && bar.close > bar.open) {
            this._openTrade('BUY', bar.close, bar.time, idx);
            return;
        }
        // Bearish breakdown
        if (bar.close < this._rangeLow && expanding && bar.close < bar.open) {
            this._openTrade('SELL', bar.close, bar.time, idx);
        }
    }

    _openTrade(direction, price, time, idx) {
        this.entryDir = direction;
        this.entryPrice = price;
        this.entryBarIdx = idx;
        const rangeSize = this._rangeHigh - this._rangeLow;
        const dirSign = direction === 'BUY' ? 1 : -1;
        this.stopLoss = direction === 'BUY' ? this._rangeLow : this._rangeHigh;
        this.takeProfit = price + rangeSize * this.riskReward * dirSign;
        this.activeTrade = {
            direction, entryPrice: price, entryTime: time,
            exitPrice: null, exitReason: null, exitTime: null,
            pnl: null, outcome: null,
            rangeSize, rangePct: rangeSize / this._rangeLow,
        };
        this.phase = 'IN_TRADE';
    }

    _manageTrade(bar, idx) {
        const dirSign = this.entryDir === 'BUY' ? 1 : -1;
        const profit = (bar.close - this.entryPrice) * dirSign;
        const risk = Math.abs(this.entryPrice - this.stopLoss);

        // Take profit
        if ((this.entryDir === 'BUY' && bar.high >= this.takeProfit) ||
            (this.entryDir === 'SELL' && bar.low <= this.takeProfit)) {
            this._closeTrade(this.takeProfit, 'TAKE_PROFIT', bar.time);
            return;
        }

        // Stop loss
        if ((this.entryDir === 'BUY' && bar.low <= this.stopLoss) ||
            (this.entryDir === 'SELL' && bar.high >= this.stopLoss)) {
            this._closeTrade(this.stopLoss, 'STOP_LOSS', bar.time);
            return;
        }

        // Trailing stop after 1R profit
        if (this.trailingStop && !this.trailingActive && profit > risk) {
            this.trailingActive = true;
            this.trailingLevel = this.entryPrice + risk * dirSign * 0.5;
        }
        if (this.trailingActive) {
            const step = this.entryPrice * this.trailingStepPct;
            const newTrail = this.entryDir === 'BUY'
                ? this.trailingLevel + step
                : this.trailingLevel - step;
            // Only move trail in profit direction
            if (this.entryDir === 'BUY' ? bar.close > newTrail : bar.close < newTrail) {
                this.trailingLevel = bar.close - step * dirSign;
            }
            if ((this.entryDir === 'BUY' && bar.low <= this.trailingLevel) ||
                (this.entryDir === 'SELL' && bar.high >= this.trailingLevel)) {
                this._closeTrade(this.trailingLevel, 'TRAILING_STOP', bar.time);
                return;
            }
        }
    }

    _closeTrade(price, reason, time) {
        this.activeTrade.exitPrice = price;
        this.activeTrade.exitReason = reason;
        this.activeTrade.exitTime = time;
        const dir = this.entryDir === 'BUY' ? 1 : -1;
        this.activeTrade.pnl = (price - this.entryPrice) * dir;
        this.activeTrade.outcome = this.activeTrade.pnl >= 0 ? 'WON' : 'LOST';
        this.trades.push({ ...this.activeTrade });
        this.activeTrade = null;
        this.trailingActive = false;
        this.phase = 'CLOSED';
    }

    _avgBarRange(period) {
        const slice = this._bars.slice(-period);
        if (!slice.length) return 0;
        return slice.reduce((s, b) => s + (b.high - b.low), 0) / slice.length;
    }

    finalize(lastBar) {
        if (this.phase === 'IN_TRADE' && this.activeTrade) {
            const favorable = (lastBar.close - this.entryPrice) *
                (this.entryDir === 'BUY' ? 1 : -1);
            this._closeTrade(lastBar.close, favorable > 0 ? 'RUNNER' : 'EOD_UNFAVORABLE', lastBar.time);
        } else if (this.phase === 'BUILDING_RANGE') {
            this.phase = 'RANGE_BUILT';
        } else if (this.phase === 'WAITING_BREAKOUT') {
            this.phase = 'NO_BREAKOUT';
        } else if (this.phase === 'IDLE') {
            this.phase = 'NO_SETUP';
        }
        return this.getState();
    }

    getState() {
        return {
            phase: this.phase,
            trades: [...this.trades],
            entryDir: this.entryDir,
            entryPrice: this.entryPrice,
            stopLoss: this.stopLoss,
            takeProfit: this.takeProfit,
            trailingActive: this.trailingActive,
            trailingLevel: this.trailingLevel,
            rangeHigh: this._rangeHigh,
            rangeLow: this._rangeLow,
            rangeComplete: this._rangeComplete,
        };
    }

    static getConfig() {
        return {
            name: 'Breakout',
            description: 'Opening range breakout with volume confirmation. Trades the first 15min range expansion.',
            params: [
                { key: 'rangeStart', label: 'Range Start Time', type: 'time', default: '09:30:00' },
                { key: 'rangeEnd', label: 'Range End Time', type: 'time', default: '09:45:00' },
                { key: 'entryWindowEnd', label: 'Entry Window End', type: 'time', default: '11:00:00' },
                { key: 'minRangePct', label: 'Min Range %', type: 'number', min: 0.002, max: 0.05, step: 0.001, default: 0.008 },
                { key: 'riskReward', label: 'Risk:Reward Ratio', type: 'number', min: 0.5, max: 5, step: 0.1, default: 1.5 },
                { key: 'expansionFactor', label: 'Candle Expansion Factor', type: 'number', min: 1, max: 3, step: 0.1, default: 1.2 },
                { key: 'trailingStop', label: 'Enable Trailing Stop', type: 'checkbox', default: true },
                { key: 'trailingStepPct', label: 'Trailing Step %', type: 'number', min: 0.001, max: 0.02, step: 0.001, default: 0.004 },
            ],
        };
    }
}
