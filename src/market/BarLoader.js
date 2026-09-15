import fs from 'node:fs';

export class BarLoader {
    static fromCSV(filePath) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.trim().split('\n');
        if (lines.length < 2) return [];
        const header = lines[0].split(',').map(h => h.trim());
        const idx = Object.fromEntries(header.map((h, i) => [h, i]));
        const bars = [];
        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',');
            if (cols.length < header.length) continue;
            bars.push({
                symbol: cols[idx.symbol],
                date: cols[idx.date],
                time: cols[idx.time],
                open: parseFloat(cols[idx.open]),
                high: parseFloat(cols[idx.high]),
                low: parseFloat(cols[idx.low]),
                close: parseFloat(cols[idx.close]),
                volume: parseInt(cols[idx.volume], 10) || 0,
            });
        }
        return bars;
    }

    static toBarsMap(bars) {
        const map = {};
        for (const bar of bars) {
            const key = `${bar.symbol}|${bar.date}`;
            if (!map[key]) map[key] = [];
            map[key].push(bar);
        }
        for (const key of Object.keys(map)) {
            map[key].sort((a, b) => a.time.localeCompare(b.time));
        }
        return map;
    }

    static filterWindow(bars, start, end) {
        return bars.filter(b => {
            const t = b.time.slice(0, end.length);
            return t >= start.slice(0, end.length) && t < end.slice(0, end.length);
        });
    }

    /**
     * Aggregate bars into larger timeframes using clock-based bucketing.
     *
     * @param {Array} bars - Sorted array of bar objects with date, time, OHLCV
     * @param {number} periodSeconds - Aggregation period in seconds
     *   Supported: 5, 10, 15, 30, 60 (1m), 120 (2m), 300 (5m), 900 (15m)
     * @param {string} [barType='second'] - Source bar type: 'second' or 'minute'
     * @returns {Array} Aggregated bars with clock-aligned timestamps
     *
     * Notes:
     * - Uses wall-clock bucketing, not bar-count chunking
     * - Buckets are aligned to midnight: floor to nearest periodSeconds from 00:00:00
     * - Never blends data across dates — each bucket stays within its date
     * - Sparse bars are still aggregated correctly (gaps in data don't shift buckets)
     */
    static aggregate(bars, periodSeconds, barType = 'second') {
        if (periodSeconds <= 1 || !bars.length) return bars.map(b => ({ ...b }));

        const sourceSecondsPerBar = barType === 'minute' ? 60 : 1;
        const buckets = new Map();
        const order = [];

        for (const bar of bars) {
            // Parse HH:MM:SS into seconds since midnight
            const parts = bar.time.split(':');
            let sec = parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60;
            if (parts.length > 2) sec += parseInt(parts[2], 10);

            // Floor to nearest bucket
            const bucketSec = Math.floor(sec / periodSeconds) * periodSeconds;
            const key = `${bar.symbol}|${bar.date}|${bucketSec}`;

            if (!buckets.has(key)) {
                const hh = String(Math.floor(bucketSec / 3600)).padStart(2, '0');
                const mm = String(Math.floor((bucketSec % 3600) / 60)).padStart(2, '0');
                const ss = String(bucketSec % 60).padStart(2, '0');
                buckets.set(key, {
                    symbol: bar.symbol,
                    date: bar.date,
                    time: `${hh}:${mm}:${ss}`,
                    open: bar.open,
                    high: bar.high,
                    low: bar.low,
                    close: bar.close,
                    volume: bar.volume || 0,
                });
                order.push(key);
            } else {
                const b = buckets.get(key);
                b.high = Math.max(b.high, bar.high);
                b.low = Math.min(b.low, bar.low);
                b.close = bar.close;
                b.volume += bar.volume || 0;
            }
        }

        return order.map(k => buckets.get(k));
    }
}