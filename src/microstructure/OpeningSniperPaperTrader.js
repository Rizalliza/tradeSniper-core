export class OpeningSniperPaperTrader {
    constructor({
        symbol,
        date,
        zonePct = 0.0015,
        scalpTargetPct = 0.001,
        hardStopPct = 0.001,
        runnerTriggerPct = 0.0015,
        runnerTrailPct = 0.001,
        entryWindowEnd = '09:32:00',
        wrongSideGuard = true,
    } = {}) {
        if (!symbol) throw new Error('OpeningSniperPaperTrader requires symbol');
        if (!date) throw new Error('OpeningSniperPaperTrader requires date');
        this.symbol = symbol;
        this.date = date;
        this.zonePct = zonePct;
        this.scalpTargetPct = scalpTargetPct;
        this.hardStopPct = hardStopPct;
        this.runnerTriggerPct = runnerTriggerPct;
        this.runnerTrailPct = runnerTrailPct;
        this.entryWindowEnd = entryWindowEnd;
        this.wrongSideGuard = wrongSideGuard;
        this.reset();
    }

    reset() {
        this.phase = 'IDLE';
        this.pending = null;
        this.trade = null;
        this.events = [];
        this.high = null;
        this.low = null;
        this.prevBar = null;
        this.openingBarsSeen = 0;
        this.localBias = 'NEUTRAL';
        this.upPressureRun = 0;
        this.downPressureRun = 0;
    }

    processOpeningBar(inputBar) {
        const bar = normalizeBar(inputBar);
        if (bar.time >= this.entryWindowEnd) return this.snapshot();

        if (this.openingBarsSeen === 0) {
            this._observeOpeningRange(bar);
            this.prevBar = bar;
            this.openingBarsSeen += 1;
            return this.snapshot();
        }

        this._updateLocalBias(bar);
        if (this.phase === 'IDLE') this._detectCross(bar);
        if (this.phase === 'PENDING_RETEST') this._detectRetest(bar);
        if (this.phase === 'IN_TRADE' || this.phase === 'RUNNER') this._manageTrade(bar, false);

        this._observeOpeningRange(bar);
        this.prevBar = bar;
        this.openingBarsSeen += 1;
        return this.snapshot();
    }

    closeOpeningWindow(lastOpeningBar) {
        if (!this.trade || this.trade.exitReason) return this.snapshot();
        const bar = normalizeBar(lastOpeningBar);
        if (this.trade.runner) return this.snapshot();

        const favorablePct = this._favorablePct(bar.close);
        if (favorablePct >= this.runnerTriggerPct) {
            this._armRunner(bar, 'WINDOW_END_RUNNER');
            return this.snapshot();
        }

        const reason = favorablePct > 0 ? 'WINDOW_END_SCALP_EXIT' : 'WINDOW_END_INVALIDATION';
        this._closeTrade(bar.close, reason, bar.time);
        return this.snapshot();
    }

    processRunnerBar(inputBar) {
        const bar = normalizeBar(inputBar);
        if (!this.trade || this.trade.exitReason) return this.snapshot();
        if (!this.trade.runner) return this.snapshot();
        this._manageTrade(bar, true);
        return this.snapshot();
    }

    finalize(lastBar) {
        if (this.trade && !this.trade.exitReason) {
            const bar = normalizeBar(lastBar);
            this._closeTrade(bar.close, this.trade.runner ? 'RUNNER_HELD_TO_END' : 'PAPER_EOD_EXIT', bar.time);
        }
        if (!this.trade && this.phase === 'PENDING_RETEST') this.phase = 'NO_RETEST';
        if (!this.trade && this.phase === 'IDLE') this.phase = 'NO_CROSS';
        return this.snapshot();
    }

    snapshot() {
        return {
            symbol: this.symbol,
            date: this.date,
            phase: this.phase,
            pending: this.pending ? { ...this.pending } : null,
            trade: this.trade ? cloneTrade(this.trade) : null,
            events: this.events.map(event => ({ ...event })),
            openingRange: this.high == null ? null : {
                high: round(this.high),
                low: round(this.low),
                midpoint: round((this.high + this.low) / 2),
            },
            localBias: this.localBias,
        };
    }

    _detectCross(bar) {
        const levels = this._levels();
        for (const level of levels) {
            const zone = level.value * this.zonePct;
            const crossedUp = this.prevBar.close <= level.value + zone && bar.high > level.value + zone;
            const crossedDown = this.prevBar.close >= level.value - zone && bar.low < level.value - zone;

            if (crossedUp) {
                this._setPending('BUY', level, bar, 'CROSS_UP');
                return;
            }
            if (crossedDown) {
                this._setPending('SELL', level, bar, 'CROSS_DOWN');
                return;
            }
        }
    }

    _detectRetest(bar) {
        if (!this.pending || bar.index === this.pending.crossIndex) return;
        const zone = this.pending.levelValue * this.zonePct;
        if (this.pending.direction === 'BUY') {
            const retested = bar.low <= this.pending.levelValue + zone && bar.close >= this.pending.levelValue - zone;
            if (retested) this._tryOpenTrade(bar, 'RETEST_FROM_ABOVE');
            return;
        }

        const retested = bar.high >= this.pending.levelValue - zone && bar.close <= this.pending.levelValue + zone;
        if (retested) this._tryOpenTrade(bar, 'RETEST_FROM_BELOW');
    }

    _manageTrade(bar, allowRunner) {
        if (!this.trade || this.trade.exitReason) return;
        if (bar.index === this.trade.entryIndex) return;
        this._updateBestPrice(bar);

        const stopPrice = this.trade.direction === 'BUY'
            ? this.trade.entryPrice * (1 - this.hardStopPct)
            : this.trade.entryPrice * (1 + this.hardStopPct);
        const stopHit = this.trade.direction === 'BUY' ? bar.low <= stopPrice : bar.high >= stopPrice;
        if (stopHit) {
            this._closeTrade(stopPrice, this.trade.runner ? 'RUNNER_HARD_STOP' : 'HARD_STOP', bar.time);
            return;
        }

        if (this.trade.runner) {
            this._updateTrail();
            const trailHit = this.trade.direction === 'BUY'
                ? bar.low <= this.trade.trailingStop
                : bar.high >= this.trade.trailingStop;
            if (trailHit) this._closeTrade(this.trade.trailingStop, 'RUNNER_TRAIL', bar.time);
            return;
        }

        const targetPrice = this.trade.direction === 'BUY'
            ? this.trade.entryPrice * (1 + this.scalpTargetPct)
            : this.trade.entryPrice * (1 - this.scalpTargetPct);
        const targetHit = this.trade.direction === 'BUY' ? bar.high >= targetPrice : bar.low <= targetPrice;
        if (!targetHit) return;

        if (allowRunner || this._favorablePct(bar.close) >= this.runnerTriggerPct) {
            this._armRunner(bar, 'SCALP_TARGET_RUNNER');
            return;
        }
        this._closeTrade(targetPrice, 'SCALP_TARGET', bar.time);
    }

    _setPending(direction, level, bar, eventType) {
        this.pending = {
            direction,
            level: level.name,
            levelValue: round(level.value),
            crossTime: bar.time,
            crossIndex: this.openingBarsSeen,
        };
        this.phase = 'PENDING_RETEST';
        this.events.push({
            type: eventType,
            direction,
            level: level.name,
            levelValue: round(level.value),
            time: bar.time,
            close: round(bar.close),
        });
    }

    _tryOpenTrade(bar, retestType) {
        const block = this._wrongSideBlock(this.pending.direction, bar);
        if (block) {
            this.events.push(block);
            this.pending = null;
            this.phase = 'BLOCKED';
            return;
        }
        this._openTrade(bar, retestType);
    }

    _wrongSideBlock(direction, bar) {
        if (!this.wrongSideGuard) return null;
        const blocked =
            (direction === 'BUY' && this.localBias === 'BEARISH') ||
            (direction === 'SELL' && this.localBias === 'BULLISH');
        if (!blocked) return null;
        return {
            type: 'PAPER_BLOCK',
            reason: 'LOCAL_OPENING_BIAS_CONFLICT',
            direction,
            localBias: this.localBias,
            pendingLevel: this.pending.level,
            pendingLevelValue: this.pending.levelValue,
            time: bar.time,
            close: round(bar.close),
        };
    }

    _openTrade(bar, retestType) {
        this.trade = {
            symbol: this.symbol,
            date: this.date,
            direction: this.pending.direction,
            entryPrice: this.pending.levelValue,
            entryTime: bar.time,
            entryIndex: bar.index,
            entryReason: retestType,
            crossTime: this.pending.crossTime,
            crossLevel: this.pending.level,
            bestPrice: this.pending.direction === 'BUY' ? bar.high : bar.low,
            runner: false,
            runnerArmedTime: null,
            trailingStop: null,
            exitPrice: null,
            exitTime: null,
            exitReason: null,
            pnlPct: null,
            outcome: null,
        };
        this.events.push({
            type: 'PAPER_ENTRY',
            direction: this.trade.direction,
            level: this.pending.level,
            entryPrice: round(this.trade.entryPrice),
            time: bar.time,
            retestType,
        });
        this.pending = null;
        this.phase = 'IN_TRADE';
    }

    _armRunner(bar, reason) {
        this.trade.runner = true;
        this.trade.runnerArmedTime = bar.time;
        this._updateTrail();
        this.phase = 'RUNNER';
        this.events.push({
            type: reason,
            direction: this.trade.direction,
            time: bar.time,
            bestPrice: round(this.trade.bestPrice),
            trailingStop: round(this.trade.trailingStop),
        });
    }

    _closeTrade(price, reason, time) {
        this.trade.exitPrice = round(price);
        this.trade.exitTime = time;
        this.trade.exitReason = reason;
        this.trade.pnlPct = round(this._favorablePct(price), 6);
        this.trade.outcome = this.trade.pnlPct > 0 ? 'WON' : this.trade.pnlPct < 0 ? 'LOST' : 'BREAKEVEN';
        this.phase = 'CLOSED';
        this.events.push({
            type: 'PAPER_EXIT',
            direction: this.trade.direction,
            reason,
            time,
            exitPrice: round(price),
            pnlPct: this.trade.pnlPct,
            outcome: this.trade.outcome,
        });
    }

    _levels() {
        return [
            { name: 'F2-H', value: this.high },
            { name: 'F2-M', value: (this.high + this.low) / 2 },
            { name: 'F2-L', value: this.low },
        ].filter(level => Number.isFinite(level.value));
    }

    _updateLocalBias(bar) {
        if (this.high == null || this.low == null) return;
        const priorHigh = this.high;
        const priorLow = this.low;
        const priorMid = (priorHigh + priorLow) / 2;
        const upsidePressure = bar.high > priorHigh && bar.close > priorMid;
        const downsidePressure = bar.low < priorLow && bar.close < priorMid;

        this.upPressureRun = upsidePressure ? this.upPressureRun + 1 : 0;
        this.downPressureRun = downsidePressure ? this.downPressureRun + 1 : 0;

        if (this.upPressureRun >= 2) this.localBias = 'BULLISH';
        if (this.downPressureRun >= 2) this.localBias = 'BEARISH';
    }

    _observeOpeningRange(bar) {
        this.high = this.high == null ? bar.high : Math.max(this.high, bar.high);
        this.low = this.low == null ? bar.low : Math.min(this.low, bar.low);
    }

    _updateBestPrice(bar) {
        const candidate = this.trade.direction === 'BUY' ? bar.high : bar.low;
        const better = this.trade.direction === 'BUY'
            ? candidate > this.trade.bestPrice
            : candidate < this.trade.bestPrice;
        if (better) this.trade.bestPrice = candidate;
    }

    _updateTrail() {
        if (!this.trade.runner) return;
        this.trade.trailingStop = this.trade.direction === 'BUY'
            ? this.trade.bestPrice * (1 - this.runnerTrailPct)
            : this.trade.bestPrice * (1 + this.runnerTrailPct);
    }

    _favorablePct(price) {
        const dir = this.trade.direction === 'BUY' ? 1 : -1;
        return ((price - this.trade.entryPrice) / this.trade.entryPrice) * dir;
    }
}

export function replayOpeningSniperPaper({ symbol, date, first2Bars = [], validationBars = [], config = {} }) {
    const trader = new OpeningSniperPaperTrader({ symbol, date, ...config });
    const indexedFirst2 = first2Bars.map((bar, index) => ({ ...bar, index }));
    for (const bar of indexedFirst2) trader.processOpeningBar(bar);

    const lastOpeningBar = indexedFirst2.at(-1);
    if (lastOpeningBar) trader.closeOpeningWindow(lastOpeningBar);

    const indexedValidation = validationBars.map((bar, index) => ({ ...bar, index: indexedFirst2.length + index }));
    for (const bar of indexedValidation) trader.processRunnerBar(bar);

    const lastBar = indexedValidation.at(-1) || lastOpeningBar;
    if (lastBar) return trader.finalize(lastBar);
    return trader.snapshot();
}

function normalizeBar(bar = {}) {
    const normalized = {
        symbol: bar.symbol,
        date: bar.date,
        time: bar.time,
        index: bar.index,
        open: Number(bar.open),
        high: Number(bar.high),
        low: Number(bar.low),
        close: Number(bar.close),
        volume: Number(bar.volume) || 0,
    };
    for (const field of ['open', 'high', 'low', 'close']) {
        if (!Number.isFinite(normalized[field])) {
            throw new Error(`OpeningSniperPaperTrader bar requires finite ${field}`);
        }
    }
    if (!normalized.time) throw new Error('OpeningSniperPaperTrader bar requires time');
    return normalized;
}

function cloneTrade(trade) {
    return trade ? { ...trade } : null;
}

function round(value, digits = 6) {
    return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}
