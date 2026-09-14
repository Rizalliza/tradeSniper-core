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

    static aggregate(bars, period) {
        if (period <= 1) return bars.map(b => ({ ...b }));
        const result = [];
        for (let i = 0; i < bars.length; i += period) {
            const chunk = bars.slice(i, i + period);
            result.push({
                symbol: chunk[0].symbol,
                date: chunk[0].date,
                time: chunk[0].time,
                open: chunk[0].open,
                high: Math.max(...chunk.map(b => b.high)),
                low: Math.min(...chunk.map(b => b.low)),
                close: chunk[chunk.length - 1].close,
                volume: chunk.reduce((s, b) => s + b.volume, 0),
            });
        }
        return result;
    }
}