export class BaseStrategy {
    constructor(config = {}) {
        this.config = { ...config };
        this.phase = 'IDLE';
        this.trades = [];
        this.markers = null;
        this.context = null;
    }

    reset(markerList, context = {}) {
        this.phase = 'IDLE';
        this.trades = [];
        this.markers = markerList;
        this.context = context;
    }

    evaluate(bar) {
        throw new Error('Subclasses must implement evaluate()');
    }

    finalize(lastBar) {
        return this.getState();
    }

    getState() {
        return { phase: this.phase, trades: [...this.trades] };
    }
}