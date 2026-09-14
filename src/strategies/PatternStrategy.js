import { BaseStrategy } from './BaseStrategy.js';
import { MarkerService } from '../market/MarkerService.js';
import { PatternDetector } from '../analysis/PatternDetector.js';
import { OrderFlow } from '../analysis/OrderFlow.js';

/**
 * Pattern Recognition Strategy
 *
 * Trades classic chart patterns with order flow confluence.
 *
 * Entry conditions (configurable):
 * - Pattern detection (double top/bottom, H&S, cup & handle, trendline break, candle patterns)
 * - Order flow confirmation (volume, absorption, false breakout filter)
 * - Marker confluence (pattern aligns with key level)
 *
 * Exit conditions:
 * - Pattern target (measured move)
 * - Stop loss (opposite side of pattern)
 * - Trailing stop option
 */
export class PatternStrategy extends BaseStrategy {
    constructor(config = {}) {
        super(config);
        this.windowStart = config.windowStart || '09:30:00';
        this.windowEnd = config.windowEnd || '16:00:00';
        this.lookbackPeriod = config.lookbackPeriod || 50; // bars to scan for patterns
        this.minConfidence = config.minConfidence || 0.5;
        this.patternTypes = config.patternTypes || [
            'double_top', 'double_bottom',
            'head_and_shoulders', 'inverse_head_and_shoulders',
            'cup_and_handle', 'trendline_breakout', 'trendline_breakdown',
            'bullish_engulfing', 'bearish_engulfing',
        ];
        this.stopLossPct = config.stopLossPct || 0.02;
        this.riskReward = config.riskReward || 2.0;
        this.trailingStop = config.trailingStop !== false;
        this.trailingStepPct = config.trailingStepPct || 0.005;
        this.useOrderFlowFilter = config.useOrderFlowFilter !== false;
        this.requireMarkerConfluence = config.requireMarkerConfluence !== false;

        this._bars = [];
        this._prevBar = null;
        this._barIndex = 0;
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
        this.activePattern = null;
        this._bars = [];
        this._prevBar = null;
        this._barIndex = 0;
    }

    _inWindow(bar) {
        const t = bar.time.slice(0, this.windowEnd.length);
        return t >= this.windowStart.slice(0, this.windowEnd.length) &&
               t < this.windowEnd.slice(0, this.windowEnd.length);
    }

    evaluate(bar) {
        const idx = this._barIndex++;
        this._bars.push(bar);

        if (this.phase === 'IDLE' && this._inWindow(bar) && this._bars.length >= this.lookbackPeriod) {
            this._lookForPattern(bar, idx);
        } else if (this.phase === 'IN_TRADE' && this._prevBar && idx !== this.entryBarIdx) {
            this._manageTrade(bar, idx);
        }

        this._prevBar = bar;
        return this.getState();
    }

    _lookForPattern(bar, idx) {
        const recentBars = this._bars.slice(-this.lookbackPeriod);
        const patterns = PatternDetector.scan(recentBars, {
            leftBars: 3,
            rightBars: 2,
            trendlineLookback: 30,
        });

        for (const pattern of patterns) {
            if (!this.patternTypes.includes(pattern.pattern)) continue;
            if ((pattern.confidence || 0) < this.minConfidence) continue;

            const direction = this._patternDirection(pattern);
            if (!direction) continue;

            const level = this._patternLevel(pattern);
            if (this.requireMarkerConfluence && level) {
                // Check if pattern level aligns with a marker
                const nearMarker = this.markerList.some(m =>
                    Math.abs(m.value - level) / level < 0.01
                );
                if (!nearMarker) continue;
            }

            // Order flow filter
            if (this.useOrderFlowFilter) {
                const of = OrderFlow.detectFalseBreakout(recentBars, level,
                    direction === 'bearish' ? 'down' : 'up');
                if (of.isFalseBreakout && of.confidence > 0.5) continue;

                const absorption = OrderFlow.detectAbsorption(recentBars);
                if (absorption.isAbsorption && absorption.direction === direction) continue;
            }

            // Determine entry
            const entryPrice = bar.close;
            const dirSign = direction === 'bullish' ? 1 : -1;
            const stopDist = entryPrice * this.stopLossPct;
            const stopLoss = entryPrice - stopDist * dirSign;
            const takeProfit = entryPrice + stopDist * this.riskReward * dirSign;

            this._openTrade(direction === 'bullish' ? 'BUY' : 'SELL',
                entryPrice, bar.time, idx, pattern, stopLoss, takeProfit);
            return;
        }
    }

    _patternDirection(pattern) {
        if (pattern.direction === 'bullish' || pattern.direction === 'bearish') {
            return pattern.direction;
        }
        const bullishPatterns = [
            'double_bottom', 'inverse_head_and_shoulders', 'cup_and_handle',
            'trendline_breakout', 'bullish_engulfing', 'hammer', 'inverted_hammer',
        ];
        const bearishPatterns = [
            'double_top', 'head_and_shoulders', 'trendline_breakdown',
            'bearish_engulfing', 'shooting_star', 'hanging_man',
        ];
        if (bullishPatterns.includes(pattern.pattern)) return 'bullish';
        if (bearishPatterns.includes(pattern.pattern)) return 'bearish';
        return null;
    }

    _patternLevel(pattern) {
        if (pattern.neckline) return pattern.neckline;
        if (pattern.breakoutLevel) return pattern.breakoutLevel;
        if (pattern.level) return pattern.level;
        if (pattern.peaks) return pattern.peaks[0]?.price;
        if (pattern.troughs) return pattern.troughs[0]?.price;
        return null;
    }

    _openTrade(direction, price, time, idx, pattern, stopLoss, takeProfit) {
        this.entryDir = direction;
        this.entryPrice = price;
        this.entryBarIdx = idx;
        this.stopLoss = stopLoss;
        this.takeProfit = takeProfit;
        this.activePattern = pattern.pattern;
        this.activeTrade = {
            direction,
            entryPrice: price,
            entryTime: time,
            exitPrice: null,
            exitReason: null,
            exitTime: null,
            pnl: null,
            outcome: null,
            pattern: pattern.pattern,
            patternConfidence: pattern.confidence || 0,
        };
        this.phase = 'IN_TRADE';
    }

    _manageTrade(bar, idx) {
        const dirSign = this.entryDir === 'BUY' ? 1 : -1;

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

        // Trailing stop
        if (this.trailingStop && !this.trailingActive) {
            const profit = (bar.close - this.entryPrice) * dirSign;
            const risk = Math.abs(this.entryPrice - this.stopLoss);
            if (profit > risk * 0.5) {
                this.trailingActive = true;
                this.trailingLevel = this.entryPrice + risk * 0.2 * dirSign;
            }
        }
        if (this.trailingActive) {
            const step = this.entryPrice * this.trailingStepPct;
            const newTrail = this.entryDir === 'BUY'
                ? this.trailingLevel + step
                : this.trailingLevel - step;
            // Only move in profit direction
            const inProfitDir = this.entryDir === 'BUY'
                ? bar.close > newTrail
                : bar.close < newTrail;
            if (inProfitDir) {
                this.trailingLevel = this.entryDir === 'BUY'
                    ? bar.close - step
                    : bar.close + step;
            }
            const trailHit = this.entryDir === 'BUY'
                ? bar.low <= this.trailingLevel
                : bar.high >= this.trailingLevel;
            if (trailHit) {
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

    finalize(lastBar) {
        if (this.phase === 'IN_TRADE' && this.activeTrade) {
            const favorable = (lastBar.close - this.entryPrice) *
                (this.entryDir === 'BUY' ? 1 : -1);
            this._closeTrade(lastBar.close,
                favorable > 0 ? 'RUNNER' : 'EOD_UNFAVORABLE',
                lastBar.time);
        } else if (this.phase === 'IDLE') {
            this.phase = 'NO_PATTERN';
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
            activePattern: this.activePattern,
        };
    }

    static getConfig() {
        return {
            name: 'Pattern Recognition',
            description: 'Trades classic chart patterns (double top/bottom, H&S, cup & handle, trendlines) with order flow confluence and marker alignment.',
            params: [
                { key: 'windowStart', label: 'Entry Window Start', type: 'time', default: '09:30:00' },
                { key: 'windowEnd', label: 'Entry Window End', type: 'time', default: '16:00:00' },
                { key: 'lookbackPeriod', label: 'Lookback Period (bars)', type: 'number', min: 10, max: 200, default: 50 },
                { key: 'minConfidence', label: 'Min Pattern Confidence', type: 'number', min: 0.2, max: 1, step: 0.05, default: 0.5 },
                { key: 'stopLossPct', label: 'Stop Loss %', type: 'number', min: 0.005, max: 0.1, step: 0.001, default: 0.02 },
                { key: 'riskReward', label: 'Risk:Reward Ratio', type: 'number', min: 0.5, max: 5, step: 0.1, default: 2.0 },
                { key: 'trailingStop', label: 'Enable Trailing Stop', type: 'checkbox', default: true },
                { key: 'trailingStepPct', label: 'Trailing Step %', type: 'number', min: 0.001, max: 0.02, step: 0.001, default: 0.005 },
                { key: 'useOrderFlowFilter', label: 'Order Flow Filter', type: 'checkbox', default: true },
                { key: 'requireMarkerConfluence', label: 'Require Marker Confluence', type: 'checkbox', default: true },
            ],
        };
    }
}
