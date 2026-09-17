import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeMarketEvent } from '../events/MarketEvent.js';

export class TapeRecorder {
    constructor({ filePath, source = 'unknown', session = null } = {}) {
        if (!filePath) throw new Error('TapeRecorder requires filePath');
        this.filePath = filePath;
        this.source = source;
        this.session = session;
    }

    async record(event) {
        const [record] = await this.recordMany([event]);
        return record;
    }

    async recordMany(events) {
        const records = events.map(event => this._envelope(event));
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        await fs.appendFile(
            this.filePath,
            records.map(record => JSON.stringify(record)).join('\n') + '\n',
            'utf8'
        );
        return records;
    }

    _envelope(event) {
        return {
            recordedAt: new Date().toISOString(),
            source: this.source,
            session: this.session,
            event: normalizeMarketEvent(event),
        };
    }

    static async read(filePath) {
        const text = await fs.readFile(filePath, 'utf8');
        return text
            .split('\n')
            .filter(Boolean)
            .map(line => JSON.parse(line));
    }
}
