import { BaseStrategy } from './BaseStrategy.js';
import { MarkerService } from '../market/MarkerService.js';

/**
 * Mean Reversion Strategy
 *
 * Bets that extreme moves away from a mean level will revert back.
 * Uses Bollinger Band-style logic with markers as support/resistance anchors.
 *
 * Rules:
 * - BUY when price drops to a support marker AND is oversold (2+ std devs below mean)
 * - SELL when price rallies to a resistance marker AND is overbought
 * - Stop loss: opposite side of the band
 * - Profit target: reversion to the mean (prior day close)
 * - Trailing stop: after reaching 50% of target, lock in profits
 */
export class MeanReversionStrategy extends BaseStrategy {
    constructor(config = {}) {
        super(config);
        this.windowStart = config.windowStart || '09:30:00';
        this.windowEnd = config.windowEnd || '10:30:00';
        this.lookbackPeriod = config.lookbackPeriod || 20; // bars for mean calculation
        this.stdDevMultiplier = config.stdDevMultiplier || 2.0; // oversold threshold
        this.reversalThreshold = config.reversalThreshold || 0.003; // confirmation candle
        this.stopLossPct = config.stopLossPct || 0.015; // 1.5% stop
        this.takeProfitPct = config.takeProfitPct || 0.01; // 1% target
        this.trailingStop = config.trailingStop !== false;
        this.trailingStepPct = config.trailingStepPct || 0.005;
        this._bars = [];
        this._prevBar = null;
        this._barIndex = 0;
        this._reversalBar = null;
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
        this._reversalBar = null;
        this.crossDir = null;
        this.crossMarker = null;
        this.entryMarker = null;
        this.profitMarker = null;
    }

    _inWindow(bar) {
        const t = bar.time.slice(0, this.windowEnd.length);
        return t >= this.windowStart.slice(0, this.windowEnd.length) &&
               t < this.windowEnd.slice(0, this.windowEnd.length);
    }

    evaluate(bar) {
        const idx = this._barIndex++;
        this._bars.push(bar);

        if (this.phase === 'IDLE' && this._inWindow(bar) && this._prevBar) {
            this._lookForSetup(bar, idx);
        } else if (this.phase === 'WAITING_REVERSAL' && this._prevBar) {
            this._checkReversal(bar, idx);
        } else if (this.phase === 'IN_TRADE' && this._prevBar && idx !== this.entryBarIdx) {
            this._manageTrade(bar, idx);
        }

        this._prevBar = bar;
        return this.getState();
    }

    _lookForSetup(bar, idx) {
        if (this._bars.length < this.lookbackPeriod) return;

        const { mean, stdDev } = this._calcStats(this.lookbackPeriod);
        const lowerBand = mean - stdDev * this.stdDevMultiplier;
        const upperBand = mean + stdDev * this.stdDevMultiplier;

        // Look for oversold (long setup) at support
        const nearest = MarkerService.classify(this.markerList, bar.close);
        const nearSupport = nearest.nearestSupport &&
            Math.abs(bar.close - nearest.nearestSupport.value) / nearest.nearestSupport.value < 0.005;
        const nearResistance = nearest.nearestResistance &&
            Math.abs(bar.close - nearest.nearestResistance.value) / nearest.nearestResistance.value < 0.005;

        if (bar.close <= lowerBand && nearSupport && bar.low < this._prevBar.low) {
            this.phase = 'WAITING_REVERSAL';
            this.setupDirection = 'BUY';
            this.setupLevel = bar.low;
            this.crossDir = 'DOWN';
            this.crossMarker = nearest.nearestSupport;
            return;
        }
        if (bar.close >= upperBand && nearResistance && bar.high > this._prevBar.high) {
            this.phase = 'WAITING_REVERSAL';
            this.setupDirection = 'SELL';
            this.setupLevel = bar.high;
            this.crossDir = 'UP';
            this.crossMarker = nearest.nearestResistance;
            return;
        }
    }

    _checkReversal(bar, idx) {
        const reversalConfirmed = this.setupDirection === 'BUY'
            ? bar.close > this._prevBar.close && bar.low > this.setupLevel * (1 + this.reversalThreshold)
            : bar.close < this._prevBar.close && bar.high < this.setupLevel * (1 - this.reversalThreshold);

        if (reversalConfirmed) {
            this._openTrade(this.setupDirection, bar.close, bar.time, idx);
        }
    }

    _openTrade(direction, price, time, idx) {
        this.entryDir = direction;
        this.entryPrice = price;
        this.entryBarIdx = idx;
        const dirSign = direction === 'BUY' ? 1 : -1;
        this.stopLoss = price * (1 - this.stopLossPct * dirSign);
        this.takeProfit = price * (1 + this.takeProfitPct * dirSign);
        
        // For runner compatibility: use nearest marker as entry marker
        const nearest = MarkerService.classify(this.markerList, price);
        this.entryMarker = direction === 'BUY' ? nearest.nearestSupport : nearest.nearestResistance;
        this.profitMarker = { value: this.takeProfit, name: 'mean_target' };
        this.activeTrade = {
            direction, entryPrice: price, entryTime: time,
            exitPrice: null, exitReason: null, exitTime: null,
            pnl: null, outcome: null,
        };
        this.phase = 'IN_TRADE';
    }

    _manageTrade(bar, idx) {
        const dirSign = this.entryDir === 'BUY' ? 1 : -1;
        const inProfit = (bar.close - this.entryPrice) * dirSign > 0;

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

        // Trailing stop activation at 50% of target
        if (this.trailingStop && !this.trailingActive && inProfit) {
            const progress = Math.abs((bar.close - this.entryPrice) / (this.takeProfit - this.entryPrice));
            if (progress >= 0.5) {
                this.trailingActive = true;
                this.trailingLevel = this.entryPrice;
            }
        }
        if (this.trailingActive) {
            const newTrail = this.entryDir === 'BUY'
                ? this.trailingLevel + (bar.close - this.entryPrice) * 0.5
                : this.trailingLevel - (this.entryPrice - bar.close) * 0.5;
            if (this.entryDir === 'BUY' ? newTrail > this.trailingLevel : newTrail < this.trailingLevel) {
                this.trailingLevel = newTrail;
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

    _calcStats(period) {
        const slice = this._bars.slice(-period);
        const closes = slice.map(b => b.close);
        const mean = closes.reduce((s, c) => s + c, 0) / closes.length;
        const variance = closes.reduce((s, c) => s + (c - mean) ** 2, 0) / closes.length;
        return { mean, stdDev: Math.sqrt(variance) };
    }

    finalize(lastBar) {
        if (this.phase === 'IN_TRADE' && this.activeTrade) {
            const favorable = (lastBar.close - this.entryPrice) *
                (this.entryDir === 'BUY' ? 1 : -1);
            this._closeTrade(lastBar.close, favorable > 0 ? 'RUNNER' : 'EOD_UNFAVORABLE', lastBar.time);
        } else if (this.phase === 'WAITING_REVERSAL') {
            this.phase = 'NO_RETEST';
        } else if (this.phase === 'IDLE') {
            this.phase = 'NO_CROSS';
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
            setupDirection: this.setupDirection || null,
            setupLevel: this.setupLevel || null,
            crossDir: this.crossDir || null,
            crossMarker: this.crossMarker || null,
            entryMarker: this.entryMarker || null,
            profitMarker: this.profitMarker || null,
        };
    }

    static getConfig() {
        return {
            name: 'Mean Reversion',
            description: 'Bets on extreme moves reverting to the mean. Uses Bollinger-style bands with marker confluence.',
            params: [
                { key: 'windowStart', label: 'Entry Window Start', type: 'time', default: '09:30:00' },
                { key: 'windowEnd', label: 'Entry Window End', type: 'time', default: '10:30:00' },
                { key: 'lookbackPeriod', label: 'Lookback Period (bars)', type: 'number', min: 5, max: 100, default: 20 },
                { key: 'stdDevMultiplier', label: 'Std Dev Multiplier', type: 'number', min: 0.5, max: 4, step: 0.1, default: 2.0 },
                { key: 'reversalThreshold', label: 'Reversal Confirmation %', type: 'number', min: 0.001, max: 0.02, step: 0.001, default: 0.003 },
                { key: 'stopLossPct', label: 'Stop Loss %', type: 'number', min: 0.005, max: 0.05, step: 0.001, default: 0.015 },
                { key: 'takeProfitPct', label: 'Take Profit %', type: 'number', min: 0.003, max: 0.05, step: 0.001, default: 0.01 },
                { key: 'trailingStop', label: 'Enable Trailing Stop', type: 'checkbox', default: true },
                { key: 'trailingStepPct', label: 'Trailing Step %', type: 'number', min: 0.001, max: 0.02, step: 0.001, default: 0.005 },
            ],
        };
    }
}
