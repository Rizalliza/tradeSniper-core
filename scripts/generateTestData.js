#!/usr/bin/env node
/**
 * Generate synthetic intraday minute bars for backtesting.
 * Creates realistic patterns around marker levels to test the Sniper strategy.
 *
 * Usage: node scripts/generateTestData.js [--output data/test_minute_bars.csv]
 */
import fs from 'node:fs';
import path from 'node:path';
import { DAILY_BARS } from '../src/data/historicalData.js';
import { MarkerService } from '../src/market/MarkerService.js';

const args = process.argv.slice(2);
const outputIdx = args.indexOf('--output');
const outputPath = outputIdx >= 0 ? args[outputIdx + 1] : 'data/test_minute_bars.csv';

const symbols = Object.keys(DAILY_BARS);
const allBars = [];

for (const symbol of symbols) {
    const daily = DAILY_BARS[symbol];
    for (let i = 1; i < daily.length; i++) {
        const day = daily[i];
        if (!day.date.startsWith('2026-02')) continue; // Only Feb data

        const markers = MarkerService.compute(daily, i);
        const markerList = MarkerService.buildList(markers);

        // Find the marker nearest to the open price
        // We'll create a pattern that crosses and retests this marker
        let nearestMarker = null;
        let nearestDist = Infinity;
        for (const m of markerList) {
            const dist = Math.abs(m.value - day.o);
            if (dist < nearestDist && dist > 0.5) {
                nearestDist = dist;
                nearestMarker = m;
            }
        }

        if (!nearestMarker) continue;

        // Generate 390 minute bars (9:30 - 16:00 ET)
        const bars = generateDayBars(symbol, day.date, day.o, nearestMarker, day.h, day.l, day.c);
        allBars.push(...bars);
    }
}

// Write CSV
const header = 'symbol,date,time,open,high,low,close,volume';
const lines = allBars.map(b =>
    `${b.symbol},${b.date},${b.time},${b.open.toFixed(2)},${b.high.toFixed(2)},${b.low.toFixed(2)},${b.close.toFixed(2)},${b.volume}`
);

const outDir = path.dirname(outputPath);
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outputPath, header + '\n' + lines.join('\n') + '\n');

console.log(`Generated ${allBars.length} bars for ${symbols.length} symbols`);
console.log(`Output: ${outputPath}`);

function generateDayBars(symbol, date, open, nearestMarker, dayHigh, dayLow, close) {
    const bars = [];
    // Decide direction: if open is above marker, cross down; if below, cross up
    const crossDown = open > nearestMarker.value;
    const markerPrice = nearestMarker.value;

    // Pattern:
    // 1. First 3-5 min: move toward marker
    // 2. Cross the marker
    // 3. Minutes 5-10: retest back to marker
    // 4. Minutes 10-30: trend away from marker (target direction)
    // 5. Minutes 30-100: oscillate around entry direction
    // 6. Rest of day: gradual drift toward close

    let price = open;
    const startHour = 9, startMin = 30;

    for (let m = 0; m < 390; m++) {
        const totalMin = startMin + m;
        const h = startHour + Math.floor(totalMin / 60);
        const min = totalMin % 60;
        const time = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`;

        let spread = Math.abs(price) * 0.001; // 0.1% spread
        if (m < 30) spread *= 1.5; // wider in first 30 min

        // Phase-based movement
        let delta = 0;
        if (m < 3) {
            // Phase 1: move toward marker
            delta = (crossDown ? -1 : 1) * Math.abs(open - markerPrice) / 5;
        } else if (m < 5) {
            // Phase 2: cross marker
            delta = (crossDown ? -1 : 1) * Math.abs(price - markerPrice) / 2 + (crossDown ? -0.2 : 0.2);
        } else if (m < 10) {
            // Phase 3: retest back to marker
            const target = markerPrice + (crossDown ? 0.15 : -0.15); // just past marker
            delta = (target - price) / (10 - m);
        } else if (m < 30) {
            // Phase 4: trend away (profit direction)
            const trendDir = crossDown ? -1 : 1;
            delta = trendDir * 0.3;
        } else if (m < 100) {
            // Phase 5: oscillate
            const oscillate = Math.sin(m * 0.15) * 0.4;
            const trendDir = crossDown ? -1 : 1;
            delta = oscillate + trendDir * 0.05;
        } else {
            // Phase 6: drift toward close
            const progress = (m - 100) / 290;
            const target = close;
            delta = (target - price) * 0.02;
        }

        // Add some noise
        delta += (Math.random() - 0.5) * 0.1;

        price += delta;

        // Clamp to day high/low
        price = Math.min(Math.max(price, dayLow * 0.99), dayHigh * 1.01);

        const bar = {
            symbol,
            date,
            time,
            open: price - spread / 2,
            high: price + spread,
            low: price - spread,
            close: price,
            volume: Math.floor(10000 + Math.random() * 50000 + (m < 30 ? 20000 : 0)),
        };
        bars.push(bar);
    }

    return bars;
}
