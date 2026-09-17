import { compareMarketEvents, normalizeMarketEvent } from '../events/MarketEvent.js';

export class MarketReplay {
    constructor({ engine, sort = true } = {}) {
        if (!engine) throw new Error('MarketReplay requires engine');
        this.engine = engine;
        this.sort = sort;
    }

    async replay(events) {
        const normalized = events.map(item => normalizeMarketEvent(item.event || item));
        const ordered = this.sort
            ? [...normalized].sort(compareMarketEvents)
            : normalized;

        for (const event of ordered) {
            await this._process(event);
        }

        return {
            count: ordered.length,
            first: ordered[0] || null,
            last: ordered[ordered.length - 1] || null,
        };
    }

    async _process(event) {
        if (typeof this.engine === 'function') {
            return this.engine(event);
        }
        if (typeof this.engine.process === 'function') {
            return this.engine.process(event);
        }
        throw new Error('Replay engine must be a function or expose process(event)');
    }
}
