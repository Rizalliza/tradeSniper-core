import { MARKET_EVENT_TYPES, normalizeMarketEvent } from '../events/MarketEvent.js';

export class OpeningMicrostructureState {
    constructor({
        symbol,
        session,
        startTime = '09:30:00',
        endTime = '09:32:00',
    } = {}) {
        if (!symbol) throw new Error('OpeningMicrostructureState requires symbol');
        if (!session) throw new Error('OpeningMicrostructureState requires session');

        this.symbol = symbol.toUpperCase();
        this.session = session;
        this.startTime = startTime;
        this.endTime = endTime;
        this.reset();
    }

    reset() {
        this.open = null;
        this.close = null;
        this.high = null;
        this.low = null;
        this.highTime = null;
        this.lowTime = null;
        this.volume = 0;
        this.tradeCount = 0;
        this.lastObservedTime = null;
        this._vwapNumerator = 0;
    }

    process(event) {
        const normalized = normalizeMarketEvent(event);
        if (normalized.symbol === this.symbol && normalized.date === this.session) {
            this.lastObservedTime = this._eventTime(normalized);
        }
        if (normalized.type !== MARKET_EVENT_TYPES.TRADE) return this.snapshot();
        if (normalized.symbol !== this.symbol) return this.snapshot();
        if (!this._inOpeningWindow(normalized)) return this.snapshot();

        this._observeTrade(normalized);
        return this.snapshot();
    }

    snapshot() {
        if (!this.tradeCount) {
            return {
                symbol: this.symbol,
                session: this.session,
                complete: false,
                f2: null,
            };
        }

        const range = this.high - this.low;
        return {
            symbol: this.symbol,
            session: this.session,
            complete: true,
            f2: {
                high: this.high,
                low: this.low,
                midpoint: (this.high + this.low) / 2,
                open: this.open,
                close: this.close,
                vwap: this.volume ? this._vwapNumerator / this.volume : this.close,
                range,
                rangePct: this.open ? range / this.open : null,
                volume: this.volume,
                tradeCount: this.tradeCount,
                closePosition: range ? (this.close - this.low) / range : 0.5,
                highTime: this.highTime,
                lowTime: this.lowTime,
                firstDirection: this._firstDirection(),
                isFinal: this._isFinal(),
                elapsedMs: this._elapsedMs(),
            },
        };
    }

    _observeTrade(event) {
        const price = event.price;
        const size = event.size || 0;
        const time = event.time || event.sipTs || event.exchangeTs || event.receiveTs;

        if (this.open == null) this.open = price;
        this.close = price;
        this.volume += size;
        this.tradeCount += 1;
        this._vwapNumerator += price * size;

        if (this.high == null || price > this.high) {
            this.high = price;
            this.highTime = time;
        }
        if (this.low == null || price < this.low) {
            this.low = price;
            this.lowTime = time;
        }
    }

    _inOpeningWindow(event) {
        if (event.date && event.date !== this.session) return false;
        const time = event.time || this._timeFromTimestamp(event.sipTs ?? event.exchangeTs);
        if (!time) return true;
        return time >= this.startTime && time < this.endTime;
    }

    _eventTime(event) {
        return event.time || this._timeFromTimestamp(event.sipTs ?? event.exchangeTs);
    }

    _isFinal() {
        return Boolean(this.lastObservedTime && this.lastObservedTime >= this.endTime);
    }

    _elapsedMs() {
        const time = this.lastObservedTime || this.highTime || this.lowTime;
        if (!time) return 0;
        return Math.max(0, Math.min(timeToMs(time) - timeToMs(this.startTime), timeToMs(this.endTime) - timeToMs(this.startTime)));
    }

    _firstDirection() {
        if (this.highTime == null || this.lowTime == null) return 'UNKNOWN';
        if (this.highTime === this.lowTime) return 'FLAT';
        return this.lowTime < this.highTime ? 'LOW_TO_HIGH' : 'HIGH_TO_LOW';
    }

    _timeFromTimestamp(timestamp) {
        if (!Number.isFinite(Number(timestamp))) return null;
        return new Date(Number(timestamp)).toISOString().slice(11, 19);
    }
}

function timeToMs(time) {
    const [hh = 0, mm = 0, ss = 0] = String(time).split(':').map(Number);
    return ((hh * 60 * 60) + (mm * 60) + ss) * 1000;
}
