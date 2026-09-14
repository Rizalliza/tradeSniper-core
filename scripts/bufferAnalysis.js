#!/usr/bin/env node
/**
 * Buffer sensitivity analysis script.
 *
 * Runs the Sniper strategy across a range of buffer percentages
 * to find the optimal retest buffer for the given data.
 *
 * Usage: node scripts/bufferAnalysis.js --bars data.csv [--symbol AAPL] [--date 2026-02-02]
 */
import { BufferSensitivity } from '../src/analysis/BufferSensitivity.js';
import { BarLoader } from '../src/market/BarLoader.js';
import { MarkerService } from '../src/market/MarkerService.js';
import { DAILY_BARS } from '../src/data/historicalData.js';

const args = process.argv.slice(2);
const getArg = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };

const barsPath = getArg('--bars');
const symbol = getArg('--symbol') || 'AAPL';
const date = getArg('--date') || '2026-02-02';

if (!barsPath) {
    console.error('Usage: node scripts/bufferAnalysis.js --bars data.csv [--symbol AAPL] [--date 2026-02-02]');
    process.exit(1);
}

const bars = BarLoader.fromCSV(barsPath);
const dayBars = bars.filter(b => b.symbol === symbol && b.date === date);

if (!dayBars.length) {
    console.error(`No bars found for ${symbol} on ${date}`);
    process.exit(1);
}

const daily = DAILY_BARS[symbol] || [];
const dayIdx = daily.findIndex(d => d.date === date);

if (dayIdx < 1) {
    console.error(`Cannot compute markers for ${symbol} on ${date} (need prior day)`);
    process.exit(1);
}

const markers = MarkerService.compute(daily, dayIdx);
const markerList = MarkerService.buildList(markers);

console.log(`\nBuffer Sensitivity Analysis: ${symbol} - ${date}`);
console.log(`Markers: ${markerList.map(m => `${m.name}(${m.value})`).join(', ')}\n`);

const results = BufferSensitivity.analyze(dayBars, markerList, {
    buffers: [0.0005, 0.00075, 0.001, 0.0015, 0.002, 0.003, 0.005, 0.0075, 0.01],
});

console.log(BufferSensitivity.formatTable(results));

const optimal = BufferSensitivity.findOptimal(results);
console.log(`\nOptimal buffer: ${optimal.optimalBps || 'N/A'} bps`);
console.log(`Consistent range: ${optimal.consistentRange.length > 0
    ? optimal.consistentRange.map(b => (b * 10000).toFixed(1) + ' bps').join(', ')
    : 'N/A'}`);
console.log(`Analysis: ${optimal.analysis}`);
console.log(`Entries: ${optimal.entryCount}/${results.length} levels, Wins: ${optimal.winCount}`);
