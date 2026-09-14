import { SniperStrategy } from '../strategies/SniperStrategy.js';

export class BufferSensitivity {
    static analyze(bars, markerList, config = {}) {
        const buffers = config.buffers || [0.0005, 0.001, 0.0015, 0.002, 0.003, 0.005, 0.0075, 0.01];
        const results = [];
        for (const bufferPct of buffers) {
            const strategy = new SniperStrategy({
                windowEnd: config.windowEnd || '09:45:00', bufferPct,
                reverseStopCount: config.reverseStopCount ?? 3,
                trailingStop: config.trailingStop ?? true,
            });
            strategy.reset(markerList, {});
            for (const bar of bars) strategy.evaluate(bar);
            strategy.finalize(bars[bars.length - 1]);
            const state = strategy.getState();
            const trade = state.trades[0] || null;
            results.push({
                bufferPct,
                bufferBps: (bufferPct * 10000).toFixed(1),
                phase: state.phase,
                hadEntry: state.trades.length > 0,
                pnl: trade?.pnl ?? 0,
                outcome: trade?.outcome || null,
                exitReason: trade?.exitReason || null,
                entryPrice: trade?.entryPrice ?? null,
                exitPrice: trade?.exitPrice ?? null,
                reverseCrossings: state.reverseCrossings.length,
                forwardCrossings: state.forwardCrossings.length,
                trailing: state.trailingActive,
            });
        }
        return results;
    }

    static findOptimal(results) {
        const withEntries = results.filter(r => r.hadEntry);
        const profitable = withEntries.filter(r => r.outcome === 'WON');
        if (!withEntries.length) {
            return {
                optimalPct: null, optimalBps: null, consistentRange: [],
                entryCount: 0, winCount: 0, bestPnl: 0,
                analysis: 'No entries found at any buffer level'
            };
        }
        let best = null;
        for (const r of profitable) {
            if (!best || r.pnl > best.pnl) best = r;
        }
        const entryIndices = withEntries.map(r => results.indexOf(r));
        const ranges = [];
        let start = entryIndices[0];
        for (let i = 1; i < entryIndices.length; i++) {
            if (entryIndices[i] !== entryIndices[i - 1] + 1) {
                ranges.push([start, entryIndices[i - 1]]);
                start = entryIndices[i];
            }
        }
        if (entryIndices.length) ranges.push([start, entryIndices[entryIndices.length - 1]]);
        const widestRange = ranges.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0];
        const consistentRange = widestRange
            ? results.slice(widestRange[0], widestRange[1] + 1).map(r => r.bufferPct) : [];
        return {
            optimalPct: best?.bufferPct ?? null,
            optimalBps: best?.bufferBps ?? null,
            consistentRange,
            entryCount: withEntries.length,
            winCount: profitable.length,
            bestPnl: best?.pnl ?? 0,
            analysis: consistentRange.length >= 3
                ? `Consistent entries across ${(consistentRange[0] * 10000).toFixed(1)}-${(consistentRange[consistentRange.length - 1] * 10000).toFixed(1)} bps. Optimal at ${best?.bufferBps} bps.`
                : `Entries found at ${withEntries.length}/${results.length} levels. Optimal at ${best?.bufferBps || 'N/A'} bps.`,
        };
    }

    static formatTable(results) {
        const lines = [];
        lines.push('Buffer   | Phase    | Entry | PnL     | Exit Reason         | Rev | Fwd');
        lines.push('─────────┼──────────┼───────┼─────────┼─────────────────────┼─────┼────');
        for (const r of results) {
            const buf = r.bufferBps.padStart(5) + ' bps';
            const phase = r.phase.padEnd(8);
            const entry = r.hadEntry ? ' YES ' : '  no ';
            const pnl = (r.pnl >= 0 ? '+' : '') + r.pnl.toFixed(2).padStart(6);
            const reason = (r.exitReason || '-').padEnd(19);
            lines.push(`${buf} | ${phase} | ${entry} | ${pnl} | ${reason} | ${String(r.reverseCrossings).padStart(3)} | ${String(r.forwardCrossings).padStart(3)}`);
        }
        return lines.join('\n');
    }
}