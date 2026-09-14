import { BaseStrategy } from './BaseStrategy.js';
import { MarkerService } from '../market/MarkerService.js';

export class SniperStrategy extends BaseStrategy {
    constructor(config = {}) {
        super(config);
        this.bufferPct = config.bufferPct ?? 0.0015;       // 0.15% retest buffer
        this.windowStart = config.windowStart ?? '09:30:00';
        this.windowEnd = config.windowEnd ?? '09:45:00';     // 15-min entry window
        this.reverseStopCount = config.reverseStopCount ?? 3; // 3rd reverse = stop (low risk)
        this.trailingStop = config.trailingStop ?? true;     // trailing when profitable
        this.trailingStepPct = config.trailingStepPct ?? 0.005;
        this.hardStopPct = config.hardStopPct ?? 0;          // 0 = disabled. Set e.g. 0.005 for 0.5% hard stop
        this.breakevenAfterPct = config.breakevenAfterPct ?? 0; // 0 = disabled. Set e.g. 0.003 to move stop to breakeven after 0.3% profit
        this._prevBar = null;
        this._barIndex = 0;
    }

    reset(markerList, context = {}) {
        super.reset(markerList, context);
        this.markerList = markerList;
        this.crossMarker = null;
        this.crossDir = null;
        this.crossBarIdx = -1;
        this.entryMarker = null;
        this.entryDir = null;
        this.entryPrice = null;
        this.entryBarIdx = -1;
        this.profitMarker = null;
        this.stopLossMarker = null;
        this.reverseCrossings = [];
        this.forwardCrossings = [];
        this.activeTrade = null;
        this.trailingActive = false;
        this.trailingLevel = null;
        this.bestPrice = null;  // best (most profitable) price reached so far
        this._prevBar = null;
        this._barIndex = 0;
    }

    _inWindow(bar) {
        const t = bar.time.slice(0, this.windowEnd.length);
        return t >= this.windowStart.slice(0, this.windowEnd.length) && t < this.windowEnd.slice(0, this.windowEnd.length);
    }

    evaluate(bar) {
        const idx = this._barIndex++;
        if (this.phase === 'IDLE' && this._inWindow(bar) && this._prevBar) this._detectCross(bar, idx);
        if (this.phase === 'CROSSED' && this._inWindow(bar)) this._detectRetest(bar, idx);
        if (this.phase === 'IN_TRADE' && this._prevBar && idx !== this.entryBarIdx) this._manageTrade(bar, idx);
        this._prevBar = bar;
        return this.getState();
    }

    _detectCross(bar, idx) {
        for (const mk of this.markerList) {
            if (this._prevBar.low > mk.value && bar.low <= mk.value) {
                this.crossMarker = mk; this.crossDir = 'DOWN'; this.crossBarIdx = idx; this.phase = 'CROSSED'; return;
            }
            if (this._prevBar.high < mk.value && bar.high >= mk.value) {
                this.crossMarker = mk; this.crossDir = 'UP'; this.crossBarIdx = idx; this.phase = 'CROSSED'; return;
            }
        }
    }

    _detectRetest(bar, idx) {
        const buffer = this.crossMarker.value * this.bufferPct;
        if (this.crossDir === 'DOWN' && bar.high >= this.crossMarker.value - buffer) {
            this._openTrade('SELL', this.crossMarker, bar, idx);
        } else if (this.crossDir === 'UP' && bar.low <= this.crossMarker.value + buffer) {
            this._openTrade('BUY', this.crossMarker, bar, idx);
        }
    }

    _openTrade(direction, marker, bar, idx) {
        this.entryDir = direction;
        this.entryMarker = marker;
        this.entryPrice = marker.value;
        this.entryBarIdx = idx;
        const profitDir = direction === 'BUY' ? 'UP' : 'DOWN';
        this.profitMarker = MarkerService.nextMarker(this.markerList, marker.name, profitDir);
        this.activeTrade = {
            direction, entryPrice: this.entryPrice, entryMarker: marker.name,
            entryTime: bar.time, entryBarIdx: idx,
            exitPrice: null, exitReason: null, exitTime: null,
            profitMarker: this.profitMarker?.name || null,
            reverseCrossings: [], forwardCrossings: [],
            trailingActive: false, trailingLevel: null,
            pnl: null, outcome: null,
        };
        this.phase = 'IN_TRADE';
    }

    _manageTrade(bar, idx) {
        // Track best price reached (for runner/trailing logic)
        this._updateBestPrice(bar);

        // 0. Hard stop loss — always active when configured, caps max loss
        if (this.hardStopPct > 0 && !this.trailingActive) {
            const stopLevel = this.entryDir === 'BUY'
                ? this.entryPrice * (1 - this.hardStopPct)
                : this.entryPrice * (1 + this.hardStopPct);
            const stopHit = this.entryDir === 'BUY' ? bar.low <= stopLevel : bar.high >= stopLevel;
            if (stopHit) {
                this._closeTrade(stopLevel, 'HARD_STOP', bar.time); return;
            }
        }

        // 0b. Breakeven stop — move stop to entry once we have enough profit
        if (this.trailingStop && this.breakevenAfterPct > 0 && !this.trailingActive && this._profitPct(bar) >= this.breakevenAfterPct) {
            this._activateBreakevenStop();
        }

        // 1. Profit target
        if (this.profitMarker) {
            const hit = this.entryDir === 'SELL' ? bar.low <= this.profitMarker.value : bar.high >= this.profitMarker.value;
            if (hit) { this._closeTrade(this.profitMarker.value, 'MARKER_PROFIT', bar.time); return; }
        }
        // 2. Forward crossings (markers hit in profit direction)
        const prevFwd = this.forwardCrossings.length;
        this._trackForwardCrossings(bar);
        if (this.forwardCrossings.length > prevFwd && this.trailingActive) this._tightenTrailingStop();
        // 3. Reverse crossings
        const prevRev = this.reverseCrossings.length;
        this._trackReverseCrossings(bar);
        // 4. Reverse stop / trailing activation
        // Only check trailing activation on the exact bar where we reach reverseStopCount
        const justHitStopCount = this.reverseCrossings.length === this.reverseStopCount &&
            prevRev === this.reverseStopCount - 1;
        if (justHitStopCount) {
            if (this.trailingStop && this._isProfitable(bar.close)) {
                this._activateTrailingStop();
            } else {
                this._closeTrade(this.reverseCrossings[this.reverseStopCount - 1].level, 'REVERSE_STOP', bar.time);
                return;
            }
        }
        // 5. Trailing stop hit check (skip on the bar that just activated trailing)
        if (this.trailingActive && !justHitStopCount) {
            const hit = this.entryDir === 'SELL' ? bar.high >= this.trailingLevel : bar.low <= this.trailingLevel;
            if (hit) { this._closeTrade(this.trailingLevel, 'TRAILING_STOP', bar.time); return; }
        }
    }

    _profitPct(bar) {
        const dir = this.entryDir === 'BUY' ? 1 : -1;
        const price = this.entryDir === 'BUY' ? bar.high : bar.low;
        return ((price - this.entryPrice) / this.entryPrice) * dir;
    }

    _activateBreakevenStop() {
        // Move stop to entry price — lock in breakeven
        this.trailingActive = true;
        this.trailingLevel = this.entryPrice;
        if (this.activeTrade) {
            this.activeTrade.trailingActive = true;
            this.activeTrade.trailingLevel = this.entryPrice;
        }
    }

    _trackForwardCrossings(bar) {
        if (!this._prevBar) return;
        const forwardDir = this.entryDir === 'BUY' ? 'UP' : 'DOWN';
        let nextMk = MarkerService.nextMarker(this.markerList, this.entryMarker.name, forwardDir);
        while (nextMk) {
            if (this.forwardCrossings.some(c => c.marker === nextMk.name)) {
                nextMk = MarkerService.nextMarker(this.markerList, nextMk.name, forwardDir);
                continue;
            }
            let crossed = false;
            if (this.entryDir === 'BUY') {
                if (this._prevBar.high < nextMk.value && bar.high >= nextMk.value) crossed = true;
            } else {
                if (this._prevBar.low > nextMk.value && bar.low <= nextMk.value) crossed = true;
            }
            if (crossed) {
                const c = { marker: nextMk.name, level: nextMk.value, time: bar.time };
                this.forwardCrossings.push(c);
                this.activeTrade.forwardCrossings.push(c);
            }
            nextMk = MarkerService.nextMarker(this.markerList, nextMk.name, forwardDir);
        }
    }

    _trackReverseCrossings(bar) {
        if (!this._prevBar) return;
        const entryLevel = this.entryPrice;
        let crossed = false;
        if (this.entryDir === 'SELL') {
            if (this._prevBar.high < entryLevel && bar.high >= entryLevel) crossed = true;
        } else {
            if (this._prevBar.low > entryLevel && bar.low <= entryLevel) crossed = true;
        }
        if (crossed) {
            const c = { time: bar.time, level: entryLevel };
            this.reverseCrossings.push(c);
            this.activeTrade.reverseCrossings.push(c);
        }
    }

    _updateBestPrice(bar) {
        if (!this.activeTrade) return;
        const candidate = this.entryDir === 'SELL' ? bar.low : bar.high;
        if (this.bestPrice === null) {
            this.bestPrice = candidate;
            this.activeTrade.bestPrice = candidate;
            return;
        }
        const isBetter = this.entryDir === 'BUY'
            ? candidate > this.bestPrice
            : candidate < this.bestPrice;
        if (isBetter) {
            this.bestPrice = candidate;
            this.activeTrade.bestPrice = candidate;
        }
    }

    _isProfitable(price) {
        const dir = this.entryDir === 'BUY' ? 1 : -1;
        return (price - this.entryPrice) * dir > 0;
    }

    _activateTrailingStop() {
        this.trailingActive = true;
        this.trailingLevel = this.entryPrice;
        this.activeTrade.trailingActive = true;
        this.activeTrade.trailingLevel = this.entryPrice;
        this._tightenTrailingStop();
    }

    _tightenTrailingStop() {
        if (!this.trailingActive) return;
        const step = this.entryPrice * this.trailingStepPct;
        const fc = this.forwardCrossings.length;
        this.trailingLevel = this.entryDir === 'BUY' ? this.entryPrice + step * fc : this.entryPrice - step * fc;
        this.activeTrade.trailingLevel = this.trailingLevel;
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
        this.trailingLevel = null;
        this.phase = 'CLOSED';
    }

    finalize(lastBar) {
        if (this.phase === 'IN_TRADE' && this.activeTrade) {
            const favorable = (lastBar.close - this.entryPrice) * (this.entryDir === 'BUY' ? 1 : -1);
            this._closeTrade(lastBar.close, favorable > 0 ? 'RUNNER' : 'EOD_UNFAVORABLE', lastBar.time);
        } else if (this.phase === 'CROSSED') {
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
            crossMarker: this.crossMarker?.name || null,
            crossDir: this.crossDir,
            entryMarker: this.entryMarker?.name || null,
            entryDir: this.entryDir,
            entryPrice: this.entryPrice,
            profitMarker: this.profitMarker?.name || null,
            reverseCrossings: [...this.reverseCrossings],
            forwardCrossings: [...this.forwardCrossings],
            trailingActive: this.trailingActive,
            trailingLevel: this.trailingLevel,
        };
    }
}
