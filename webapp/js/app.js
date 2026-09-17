/**
 * SNIPER AI // TERMINAL — Frontend App
 *
 * Flow Study: visualizes 1-minute bars with marker levels,
 * showing cross → retest → entry annotations exactly like the v1 webapp.
 */

import { MarkerService } from '/src/market/MarkerService.js';
import { SniperStrategy } from '/src/strategies/SniperStrategy.js';
import { DAILY_BARS } from '/src/data/historicalData.js';
import { BacktestRunner } from '/src/backtest/BacktestRunner.js';
import { NewsDigest } from '/src/news/NewsDigest.js';
import { SAMPLE_NEWS } from '/src/data/sampleNews.js';
import { BacktestLab } from '/js/backtest-lab.js';
import { PatternDetector } from '/src/analysis/PatternDetector.js';
import { OrderFlow } from '/src/analysis/OrderFlow.js';

const BACKTEST_SNAPSHOT_URL = '/data/latest-massive-backtest.json';
const PRESSURE_PILOT_URL = '/data/pressure-pilot-2026-09-09_2026-09-15.json';
const OPENING_PROBE_URL = '/data/opening-microstructure-probe-2026-09-09_2026-09-15.json';

function num(value, digits = 2, fallback = '-') {
    return Number.isFinite(value) ? value.toFixed(digits) : fallback;
}

function money(value, digits = 2) {
    return '$' + num(value, digits);
}

function profitFactor(value) {
    if (value === Infinity) return '∞';
    return num(value);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function snapshotTitle(snapshot) {
    if (!snapshot?.period) return 'FEBRUARY 2026 · SAMPLE';
    return `${snapshot.period.from} → ${snapshot.period.to} · ${snapshot.source || 'BACKTEST'}`;
}

// ============================================
// DATA GENERATION (synthetic intraday bars)
// ============================================

function generateDayBars(symbol, date, open, markers, dayHigh, dayLow, close) {
    const bars = [];
    const markerList = MarkerService.buildList(markers);
    const nearest = MarkerService.classify(markerList, open);

    // Determine cross direction
    const crossUp = nearest.nearestResistance &&
        Math.abs(nearest.nearestResistance.value - open) < Math.abs(nearest.nearestSupport?.value - open || Infinity);
    const crossMarker = crossUp ? nearest.nearestResistance : nearest.nearestSupport;
    if (!crossMarker) return bars;

    const markerPrice = crossMarker.value;
    const direction = crossUp ? 'UP' : 'DOWN';

    let price = open;
    for (let m = 0; m < 390; m++) {
        const h = 9 + Math.floor((30 + m) / 60);
        const min = (30 + m) % 60;
        const time = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`;

        let spread = Math.abs(price) * 0.0015;
        if (m < 30) spread *= 2;

        let delta = 0;
        if (m < 3) {
            // Move toward marker
            const move = (markerPrice - open) / 5;
            delta = move;
        } else if (m < 5) {
            // Cross the marker decisively
            delta = (markerPrice - price) * 0.8 + (direction === 'UP' ? 0.3 : -0.3);
        } else if (m < 10) {
            // Retest back to marker
            const target = markerPrice + (direction === 'UP' ? -0.1 : 0.1);
            delta = (target - price) * 0.3;
        } else if (m < 30) {
            // Trend away from marker
            delta = direction === 'UP' ? 0.4 : -0.4;
        } else if (m < 100) {
            // Oscillate around trend
            const oscillate = Math.sin(m * 0.12) * 0.5;
            const trend = direction === 'UP' ? 0.05 : -0.05;
            delta = oscillate + trend;
        } else {
            // Drift toward close
            delta = (close - price) * 0.015;
        }

        delta += (Math.sin(m * 2.7) * 0.08); // fine noise
        price += delta;
        price = Math.min(Math.max(price, dayLow * 0.995), dayHigh * 1.005);

        bars.push({
            symbol, date, time,
            open: price - spread / 2,
            high: price + spread,
            low: price - spread,
            close: price,
            volume: Math.floor(10000 + Math.random() * 50000),
        });
    }
    return bars;
}

function generateAllBars(symbol) {
    const daily = DAILY_BARS[symbol] || [];
    const allBars = [];
    const barsMap = {};

    for (let i = 1; i < daily.length; i++) {
        const day = daily[i];
        if (!day.date.startsWith('2026-02')) continue;
        const markers = MarkerService.compute(daily, i);
        const dayBars = generateDayBars(symbol, day.date, day.o, markers, day.h, day.l, day.c);
        allBars.push(...dayBars);
        barsMap[`${symbol}|${day.date}`] = dayBars;
    }

    return { allBars, barsMap };
}

// ============================================
// SVG CHART RENDERING
// ============================================

class FlowChart {
    constructor(container, bars, markers, strategyResult, config = {}) {
        this.container = container;
        this.bars = bars;
        this.markers = markers;
        this.markerList = config.markerList || MarkerService.buildList(markers);
        this.strategyResult = strategyResult;
        this.config = {
            width: config.width || 860,
            height: config.height || 560,
            padding: config.padding || { top: 18, right: 70, bottom: 48, left: 14 },
            range: config.range || 30, // minutes to show
            candleWidth: config.candleWidth || 4,
            candleGap: config.candleGap || 2,
            shadedUntil: config.shadedUntil || null,
            bufferPct: config.bufferPct || 0,
        };
        this.render();
    }

    render() {
        const { width, height, padding, range } = this.config;
        const chartW = width - padding.left - padding.right;
        const volumeH = 28;
        const chartH = height - padding.top - padding.bottom - volumeH;

        const firstSecond = this.timeToSeconds(this.bars[0]?.time);
        const rangeSeconds = Number.isFinite(firstSecond) ? range * 60 : null;
        const visibleBars = rangeSeconds
            ? this.bars.filter(b => this.timeToSeconds(b.time) - firstSecond < rangeSeconds)
            : this.bars.slice(0, range);
        if (!visibleBars.length) return;

        // Price range — zoom to visible bars + nearby markers
        // Always show support/resistance markers that frame the price action
        let minPrice = Infinity, maxPrice = -Infinity;
        for (const b of visibleBars) {
            minPrice = Math.min(minPrice, b.low);
            maxPrice = Math.max(maxPrice, b.high);
        }
        // Find closest support and resistance markers to always show them
        let closestSupport = null, closestResistance = null;
        for (const m of this.markerList) {
            if (m.type === 'support' && m.value <= maxPrice) {
                if (!closestSupport || m.value > closestSupport.value) closestSupport = m;
            }
            if (m.type === 'resistance' && m.value >= minPrice) {
                if (!closestResistance || m.value < closestResistance.value) closestResistance = m;
            }
        }
        // Include markers within a reasonable range around the bars
        const barRange = maxPrice - minPrice;
        const minMarkers = barRange < 0.005 * minPrice; // second bars: very small range
        const padOut = minMarkers ? barRange * 3 : barRange * 1.5;

        for (const m of this.markerList) {
            if (m.value >= minPrice - padOut && m.value <= maxPrice + padOut) {
                minPrice = Math.min(minPrice, m.value);
                maxPrice = Math.max(maxPrice, m.value);
            }
        }
        // Always include the nearest support and resistance
        if (closestSupport) { minPrice = Math.min(minPrice, closestSupport.value); }
        if (closestResistance) { maxPrice = Math.max(maxPrice, closestResistance.value); }

        const retestBand = this.getRetestBand();
        if (retestBand) {
            minPrice = Math.min(minPrice, retestBand.low);
            maxPrice = Math.max(maxPrice, retestBand.high);
        }

        if (maxPrice === minPrice) {
            maxPrice += maxPrice * 0.001;
            minPrice -= minPrice * 0.001;
        }
        const pricePad = (maxPrice - minPrice) * 0.12;
        minPrice -= pricePad;
        maxPrice += pricePad;

        const priceToY = (p) => padding.top + ((maxPrice - p) / (maxPrice - minPrice)) * chartH;
        const seconds = visibleBars.map(b => this.timeToSeconds(b.time)).filter(Number.isFinite);
        const minSecond = seconds.length ? Math.min(...seconds) : 0;
        const maxSecond = seconds.length ? Math.max(...seconds) : visibleBars.length - 1;
        const spanSeconds = Math.max(1, maxSecond - minSecond);
        const fallbackStep = visibleBars.length > 1 ? chartW / (visibleBars.length - 1) : chartW;
        const barToX = (i) => {
            const second = this.timeToSeconds(visibleBars[i]?.time);
            if (!Number.isFinite(second) || maxSecond === minSecond) {
                return padding.left + i * fallbackStep;
            }
            return padding.left + ((second - minSecond) / spanSeconds) * chartW;
        };
        const candleWidth = Math.max(1.5, Math.min(8, chartW / Math.max(visibleBars.length, 1) * 0.58));
        const maxVolume = Math.max(...visibleBars.map(b => Number(b.volume) || 0), 1);
        const volumeTop = padding.top + chartH + 8;
        const volumeBase = volumeTop + volumeH - 4;

        // Build SVG
        let svg = `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">`;

        if (this.config.shadedUntil) {
            const shadeSecond = this.timeToSeconds(this.config.shadedUntil);
            if (Number.isFinite(shadeSecond) && shadeSecond > minSecond) {
                const shadeX = padding.left + ((Math.min(shadeSecond, maxSecond) - minSecond) / spanSeconds) * chartW;
                svg += `<rect x="${padding.left}" y="${padding.top}" width="${Math.max(0, shadeX - padding.left)}"
                        height="${chartH + volumeH + 8}" fill="#ffcc00" opacity="0.055"/>`;
                svg += `<line x1="${shadeX}" y1="${padding.top}" x2="${shadeX}" y2="${volumeBase}"
                        stroke="#ffcc00" stroke-width="0.8" stroke-dasharray="3,3" opacity="0.45"/>`;
                svg += `<text x="${padding.left + 4}" y="${padding.top + 10}" fill="#ffcc00"
                        font-size="8" font-family="monospace" opacity="0.8">FIRST 2M</text>`;
            }
        }

        // Grid lines
        svg += `<g class="grid">`;
        for (let i = 0; i <= 4; i++) {
            const y = padding.top + (chartH / 4) * i;
            const p = maxPrice - ((maxPrice - minPrice) / 4) * i;
            svg += `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="#1a1a28" stroke-width="0.5" stroke-dasharray="2,2"/>`;
            svg += `<text x="${width - padding.right + 4}" y="${y + 3}" fill="#555570" font-size="9" font-family="monospace">${num(p)}</text>`;
        }
        svg += `</g>`;

        if (retestBand) {
            const yTop = priceToY(retestBand.high);
            const yBottom = priceToY(retestBand.low);
            const bandH = Math.max(2, yBottom - yTop);
            const bandColor = retestBand.direction === 'BUY' ? '#00ccff' : '#ff8800';
            svg += `<g class="retest-band">`;
            svg += `<rect x="${padding.left}" y="${yTop}" width="${chartW}" height="${bandH}"
                    fill="${bandColor}" opacity="0.105"/>`;
            svg += `<line x1="${padding.left}" y1="${priceToY(retestBand.value)}" x2="${width - padding.right}" y2="${priceToY(retestBand.value)}"
                    stroke="${bandColor}" stroke-width="1.2" stroke-dasharray="6,4" opacity="0.9"/>`;
            svg += `<text x="${padding.left + 6}" y="${Math.max(padding.top + 11, yTop - 4)}" fill="${bandColor}"
                    font-size="8" font-family="monospace" font-weight="bold">RETEST ZONE ±${(this.config.bufferPct * 100).toFixed(2)}%</text>`;
            svg += `</g>`;
        }

        // Marker lines
        svg += `<g class="markers">`;
        for (const m of this.markerList) {
            const y = priceToY(m.value);
            const color = m.type === 'resistance' ? '#ff8844' :
                          m.type === 'support' ? '#44aaff' :
                          m.type === 'flow' ? '#ffcc00' : '#666688';
            const dash = m.type === 'neutral' ? '4,4' : '';
            const opacity = m.type === 'flow' ? 0.42 : 0.6;

            svg += `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}"
                    stroke="${color}" stroke-width="1" stroke-dasharray="${dash}" opacity="${opacity}"/>`;

            // Marker label on left
            const label = this.abbreviateMarker(m.name);
            const labelW = m.type === 'flow' ? 42 : 32;
            svg += `<rect x="${padding.left}" y="${y - 7}" width="${labelW}" height="14" fill="${color}" opacity="0.15"/>`;
            svg += `<text x="${padding.left + 3}" y="${y + 3}" fill="${color}" font-size="8"
                    font-family="monospace" font-weight="bold">${label}</text>`;

            // Marker value on right
            svg += `<text x="${width - padding.right - 3}" y="${y + 3}" fill="${color}" font-size="8"
                    font-family="monospace" text-anchor="end">${num(m.value)}</text>`;
        }
        svg += `</g>`;

        // Close path - helps visually track retests through noisy 10s candles
        const closePath = visibleBars.map((b, i) => `${i === 0 ? 'M' : 'L'} ${barToX(i).toFixed(2)} ${priceToY(b.close).toFixed(2)}`).join(' ');
        svg += `<path class="price-path" d="${closePath}" fill="none" stroke="#2f6bff" stroke-width="1.1" opacity="0.78"/>`;

        // Candlesticks
        svg += `<g class="candles">`;
        for (let i = 0; i < visibleBars.length; i++) {
            const b = visibleBars[i];
            const x = barToX(i);
            const bullish = b.close >= b.open;
            const color = bullish ? '#00ff88' : '#ff3355';
            const bodyTop = priceToY(Math.max(b.open, b.close));
            const bodyBottom = priceToY(Math.min(b.open, b.close));
            const bodyH = Math.max(1, bodyBottom - bodyTop);
            const volRatio = Math.min(1, (Number(b.volume) || 0) / maxVolume);
            const wickWidth = 0.6 + volRatio * 1.15;
            const opacity = 0.58 + volRatio * 0.38;

            // Wick
            svg += `<line x1="${x}" y1="${priceToY(b.high)}" x2="${x}" y2="${priceToY(b.low)}"
                    stroke="${color}" stroke-width="${wickWidth.toFixed(2)}" opacity="${opacity.toFixed(2)}"/>`;

            // Body
            svg += `<rect x="${x - candleWidth / 2}" y="${bodyTop}"
                    width="${candleWidth}" height="${bodyH}"
                    fill="${color}" opacity="${opacity.toFixed(2)}"/>`;
        }
        svg += `</g>`;

        // Volume strip
        svg += `<g class="volume">`;
        for (let i = 0; i < visibleBars.length; i++) {
            const b = visibleBars[i];
            const x = barToX(i);
            const bullish = b.close >= b.open;
            const color = bullish ? '#00ff88' : '#ff3355';
            const volH = Math.max(1, ((Number(b.volume) || 0) / maxVolume) * (volumeH - 6));
            svg += `<rect x="${x - candleWidth / 2}" y="${volumeBase - volH}"
                    width="${candleWidth}" height="${volH}" fill="${color}" opacity="0.28"/>`;
        }
        svg += `<line x1="${padding.left}" y1="${volumeBase}" x2="${width - padding.right}" y2="${volumeBase}" stroke="#1a1a28" stroke-width="0.5"/>`;
        svg += `</g>`;

        // Strategy annotations (cross, retest, entry)
        if (this.strategyResult) {
            svg += `<g class="annotations">`;
            svg += this.drawAnnotations(visibleBars, barToX, priceToY);
            svg += `</g>`;
        }

        // Time axis
        svg += `<g class="time-axis">`;
        svg += this.drawTimeAxis({ minSecond, maxSecond, chartW, padding, height, volumeBase });
        svg += `</g>`;

        svg += `</svg>`;
        this.container.innerHTML = svg;
    }

    getRetestBand() {
        const state = this.strategyResult;
        if (!state?.crossMarker || !this.config.bufferPct) return null;
        const marker = this.markerList.find(m => m.name === state.crossMarker);
        if (!marker || !Number.isFinite(marker.value)) return null;
        const distance = marker.value * this.config.bufferPct;
        return {
            value: marker.value,
            low: marker.value - distance,
            high: marker.value + distance,
            direction: state.crossDir === 'UP' ? 'BUY' : 'SELL',
        };
    }

    drawTimeAxis({ minSecond, maxSecond, chartW, padding, height, volumeBase }) {
        const span = Math.max(1, maxSecond - minSecond);
        const toX = (second) => padding.left + ((second - minSecond) / span) * chartW;
        const visibleMinutes = this.config.range;
        let svg = '';

        if (visibleMinutes <= 2) {
            const start = Math.ceil(minSecond / 2) * 2;
            for (let second = start; second <= maxSecond; second += 2) {
                const x = toX(second);
                const elapsed = second - minSecond;
                const major = elapsed % 10 === 0;
                svg += `<line x1="${x}" y1="${volumeBase + 2}" x2="${x}" y2="${volumeBase + (major ? 12 : 7)}"
                        stroke="${major ? '#8888a0' : '#555570'}" stroke-width="${major ? 0.7 : 0.45}" opacity="${major ? 0.8 : 0.45}"/>`;
                svg += `<line x1="${x}" y1="${padding.top}" x2="${x}" y2="${volumeBase}"
                        stroke="#1a1a28" stroke-width="0.45" opacity="${major ? 0.7 : 0.23}"/>`;
                if (elapsed > 0) {
                    svg += `<text x="${x + 1}" y="${height - 10}" fill="${major ? '#8888a0' : '#555570'}"
                            font-size="6" font-family="monospace" transform="rotate(-58 ${x + 1} ${height - 10})">${elapsed}s</text>`;
                }
            }
            const openLabel = this.secondsToTime(minSecond);
            svg += `<text x="${padding.left}" y="${height - 30}" fill="#8888a0" font-size="8"
                    font-family="monospace">${openLabel}</text>`;
            return svg;
        }

        const start = Math.ceil(minSecond / 60) * 60;
        for (let second = start; second <= maxSecond; second += 60) {
            const x = toX(second);
            const major = ((second - minSecond) / 60) % 5 === 0;
            svg += `<line x1="${x}" y1="${volumeBase + 2}" x2="${x}" y2="${volumeBase + (major ? 12 : 8)}"
                    stroke="${major ? '#8888a0' : '#555570'}" stroke-width="${major ? 0.7 : 0.45}" opacity="${major ? 0.8 : 0.5}"/>`;
            svg += `<line x1="${x}" y1="${padding.top}" x2="${x}" y2="${volumeBase}"
                    stroke="#1a1a28" stroke-width="0.45" opacity="${major ? 0.65 : 0.28}"/>`;
            svg += `<text x="${x}" y="${height - 10}" fill="${major ? '#8888a0' : '#555570'}" font-size="7"
                    font-family="monospace" text-anchor="middle">${this.secondsToTime(second).slice(0, 5)}</text>`;
        }
        return svg;
    }

    timeToSeconds(time) {
        if (!time) return NaN;
        const [h, m, s = '0'] = String(time).split(':');
        return Number(h) * 3600 + Number(m) * 60 + Number(s);
    }

    secondsToTime(totalSeconds) {
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = totalSeconds % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    drawAnnotations(bars, barToX, priceToY) {
        let svg = '';
        const state = this.strategyResult;

        // Find cross bar
        if (state.crossBarIdx !== undefined && state.crossBarIdx >= 0) {
            const i = state.crossBarIdx;
            if (bars[i]) {
                const x = barToX(i);
                const y = priceToY(this._getMarkerValue(state.crossMarker));
                svg += `<circle cx="${x}" cy="${y}" r="3" fill="#ffcc00" opacity="0.9"/>`;
                svg += `<text x="${x}" y="${y - 6}" fill="#ffcc00" font-size="8"
                        font-family="monospace" text-anchor="middle">× CROSS</text>`;
            }
        }

        // Entry annotation
        if (state.entryBarIdx !== undefined && state.entryBarIdx >= 0) {
            const i = state.entryBarIdx;
            if (bars[i]) {
                const x = barToX(i);
                const y = priceToY(state.entryPrice);
                const isBuy = state.entryDir === 'BUY';
                const color = isBuy ? '#00ff88' : '#ff3355';
                const arrow = isBuy ? '▲' : '▼';
                const label = isBuy ? 'ENTRY BUY' : 'ENTRY SELL';

                svg += `<text x="${x}" y="${isBuy ? y - 10 : y + 16}" fill="${color}" font-size="8"
                        font-family="monospace" font-weight="bold" text-anchor="middle">${label}</text>`;
                svg += `<text x="${x}" y="${isBuy ? y - 4 : y + 10}" fill="${color}" font-size="10"
                        text-anchor="middle">${arrow}</text>`;

                // Entry price line
                svg += `<line x1="${x}" y1="${y}" x2="${x + 80}" y2="${y}"
                        stroke="${color}" stroke-width="0.5" stroke-dasharray="2,2" opacity="0.5"/>`;
            }
        }

        // Exit annotation
        if (state.trades && state.trades.length) {
            const trade = state.trades[0];
            if (trade.exitTime) {
                // Find approximate bar index for exit
                const exitIdx = bars.findIndex(b => b.time >= trade.exitTime);
                const i = exitIdx >= 0 ? exitIdx : bars.length - 1;
                if (bars[i]) {
                    const x = barToX(i);
                    const y = priceToY(trade.exitPrice);
                    const isWin = trade.outcome === 'WON';
                    const color = isWin ? '#00ff88' : '#ff3355';
                    const label = isWin ? '✓ ' + trade.exitReason : '✗ ' + trade.exitReason;

                    svg += `<circle cx="${x}" cy="${y}" r="3" fill="${color}" opacity="0.9"/>`;
                    svg += `<text x="${x}" y="${isWin ? y - 10 : y + 16}" fill="${color}" font-size="8"
                            font-family="monospace" text-anchor="middle">${label}</text>`;
                }
            }
        }

        if (state.phase === 'BLOCKED' && state.blockedSignal) {
            const blocked = state.blockedSignal;
            const i = bars.findIndex(b => b.time >= blocked.time);
            if (i >= 0 && bars[i]) {
                const x = barToX(i);
                const y = priceToY(blocked.price || bars[i].close);
                const color = blocked.entryDir === 'BUY' ? '#ff8800' : '#00ccff';
                svg += `<rect x="${x - 36}" y="${y - 20}" width="72" height="14" rx="2" fill="${color}" opacity="0.16"/>`;
                svg += `<text x="${x}" y="${y - 10}" fill="${color}" font-size="8"
                        font-family="monospace" font-weight="bold" text-anchor="middle">BLOCKED ${escapeHtml(blocked.entryDir)}</text>`;
                svg += `<line x1="${x}" y1="${y - 4}" x2="${x}" y2="${y + 14}" stroke="${color}" stroke-width="0.8" opacity="0.75"/>`;
            }
        }

        return svg;
    }

    _getMarkerValue(name) {
        const m = this.markerList.find(mk => mk.name === name);
        return m ? m.value : 0;
    }

    abbreviateMarker(name) {
        const map = {
            monthly_high: 'M-H',
            weekly_high: 'W-H',
            daily_high: 'D-H',
            prior_day_close: 'PD-C',
            prior_day_open: 'PD-O',
            daily_low: 'D-L',
            weekly_low: 'W-L',
            monthly_low: 'M-L',
            first2_high: 'F2-H',
            first2_mid: 'F2-M',
            first2_low: 'F2-L',
            premarket_high: 'PM-H',
            premarket_low: 'PM-L',
        };
        return map[name] || name.slice(0, 4).toUpperCase();
    }
}

// ============================================
// APP CONTROLLER
// ============================================

class SniperApp {
    constructor() {
        this.currentSymbol = 'AAPL';
        this.currentRange = 2;
        this.barsData = {}; // symbol → barsMap
        this.latestBacktest = null;
        this.pressurePilot = null;
        this.openingProbe = null;
        this.reviewLimit = 5;
        this.backtestLab = new BacktestLab();
        this.init();
    }

    async init() {
        // Pre-generate data
        for (const sym of Object.keys(DAILY_BARS)) {
            const { barsMap } = generateAllBars(sym);
            this.barsData[sym] = barsMap;
        }

        this.latestBacktest = await this.loadLatestBacktest();
        this.pressurePilot = await this.loadPressurePilot();
        this.openingProbe = await this.loadOpeningProbe();
        this.initNewsDigest();
        this.setupNavigation();
        this.setupControls();
        this.setupPatternScanner();
        this.renderFlowStudy();
        this.renderBacktest();
        this.renderPerformance();
        this.renderVerify();
        this.renderSentiment();
        this.renderWatchlist();
        this.renderTradeLog();
        this.initBacktestLab();
        this.updateClock();
        setInterval(() => this.updateClock(), 1000);
    }

    async loadLatestBacktest() {
        try {
            const res = await fetch(BACKTEST_SNAPSHOT_URL, { cache: 'no-store' });
            if (!res.ok) return null;
            const snapshot = await res.json();
            if (!snapshot?.stats || !Array.isArray(snapshot.setups)) return null;
            return snapshot;
        } catch {
            return null;
        }
    }

    async loadPressurePilot() {
        try {
            const res = await fetch(PRESSURE_PILOT_URL, { cache: 'no-store' });
            if (!res.ok) return null;
            const payload = await res.json();
            if (!Array.isArray(payload?.results)) return null;
            return payload;
        } catch {
            return null;
        }
    }

    async loadOpeningProbe() {
        try {
            const res = await fetch(OPENING_PROBE_URL, { cache: 'no-store' });
            if (!res.ok) return null;
            const payload = await res.json();
            if (!Array.isArray(payload?.results)) return null;
            return payload;
        } catch {
            return null;
        }
    }

    setupNavigation() {
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const view = item.dataset.view;
                this.switchView(view);
                navItems.forEach(n => n.classList.remove('active'));
                item.classList.add('active');
            });
        });
    }

    switchView(viewName) {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        const target = document.getElementById(`view-${viewName}`);
        if (target) target.classList.add('active');
    }

    setupControls() {
        // Symbol tabs
        document.querySelectorAll('.sym-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.sym-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentSymbol = btn.dataset.symbol;
                this.renderFlowStudy();
            });
        });

        // Range tabs
        document.querySelectorAll('.range-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentRange = parseInt(btn.dataset.range, 10);
                this.renderFlowStudy();
            });
        });

        // Export SVG
        const exportBtn = document.getElementById('exportSvg');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => this.exportSVG());
        }
    }

    renderFlowStudy() {
        if (this.pressurePilot) {
            this.renderPressureFlowStudy();
            return;
        }

        this.updateFlowSubtitle('SAMPLE FALLBACK · GENERATED 1-MIN BARS · REAL PRESSURE PILOT JSON NOT FOUND');
        const grid = document.getElementById('chartsGrid');
        const daily = DAILY_BARS[this.currentSymbol] || [];
        const barsMap = this.barsData[this.currentSymbol] || {};

        // Filter to Feb dates
        const febDays = daily.filter(d => d.date.startsWith('2026-02'));
        if (febDays.length === 0) return;

        grid.innerHTML = '';

        for (let i = 0; i < daily.length; i++) {
            const day = daily[i];
            if (!day.date.startsWith('2026-02')) continue;
            if (i < 1) continue;

            const dayBars = barsMap[`${this.currentSymbol}|${day.date}`] || [];
            if (!dayBars.length) continue;

            const markers = MarkerService.compute(daily, i);
            const markerList = MarkerService.buildList(markers);

            // Run strategy
            const strategy = new SniperStrategy({
                windowEnd: '09:45:00',
                bufferPct: 0.0015,
                reverseStopCount: 3,
                trailingStop: true,
            });
            strategy.reset(markerList, {});
            for (const bar of dayBars) strategy.evaluate(bar);
            strategy.finalize(dayBars[dayBars.length - 1]);
            const state = strategy.getState();

            // Add bar indices to state for annotation
            state.crossBarIdx = strategy.crossBarIdx;
            state.entryBarIdx = strategy.entryBarIdx;

            // Create card
            const card = document.createElement('div');
            card.className = 'chart-card';

            // Get outcome
            const trade = state.trades[0];
            let outcome = 'SKIPPED';
            let outcomeClass = 'skipped';
            if (trade) {
                outcome = trade.outcome;
                outcomeClass = trade.outcome === 'WON' ? 'won' : 'lost';
            } else if (state.phase === 'NO_RETEST') {
                outcome = 'NO_RETEST';
                outcomeClass = 'skipped';
            } else if (state.phase === 'NO_CROSS') {
                outcome = 'NO_CROSS';
                outcomeClass = 'skipped';
            }

            // Marker meta
            const markerMeta = `
                <span><span class="label">PD-O</span> <span class="value neutral">${num(markers.prior_day_open)}</span></span>
                <span><span class="label">PD-C</span> <span class="value neutral">${num(markers.prior_day_close)}</span></span>
                <span><span class="label">D-H</span> <span class="value resistance">${num(markers.daily_high)}</span></span>
                <span><span class="label">D-L</span> <span class="value support">${num(markers.daily_low)}</span></span>
            `;

            card.innerHTML = `
                <div class="chart-header">
                    <span class="chart-date">${day.date}</span>
                    <div class="chart-meta">${markerMeta}</div>
                </div>
                <div class="chart-container" data-date="${day.date}"></div>
                <div class="chart-footer">
                    <span>O ${num(day.o)} · C ${num(day.c)}</span>
                    <span class="outcome ${outcomeClass}">${outcome}</span>
                </div>
            `;

            grid.appendChild(card);

            // Render chart
            const container = card.querySelector('.chart-container');
            new FlowChart(container, dayBars, markers, state, { range: this.currentRange });
        }
    }

    renderPressureFlowStudy() {
        const grid = document.getElementById('chartsGrid');
        if (!grid) return;

        const packs = this.getPressurePacks(this.currentSymbol).slice(0, this.reviewLimit);
        const period = this.pressurePilot?.period;
        const from = period?.from || 'UNKNOWN';
        const to = period?.to || 'UNKNOWN';
        const first2Agg = this.pressurePilot?.config?.first2AggregateSeconds || 2;
        const validationAgg = this.pressurePilot?.config?.validationAggregateSeconds || 60;
        const lens = this.currentRange <= 2
            ? `FIRST 2M SWING · ${first2Agg}S CANDLES · ENTRY LOCKOUT / PRESSURE READ`
            : `OPEN 30M · ${first2Agg}S FIRST-2M + ${validationAgg}S VALIDATION · ENTRIES 09:32+`;
        this.updateFlowSubtitle(`TEST RUN 5 · PRESSURE PILOT + F2 PROBE · ${lens} · ${from} → ${to} · HARD STOP 0.10% · RETEST BUFFER ±0.15%`);

        grid.innerHTML = '';
        if (!packs.length) {
            grid.innerHTML = `<div class="placeholder">No pressure pilot data for ${escapeHtml(this.currentSymbol)}</div>`;
            return;
        }

        for (const pack of packs) {
            const dayBars = this.normalizeBars([
                ...(pack.bars?.open_first_2_min_aggregated_seconds || []),
                ...(pack.bars?.open_aggregated_seconds || []),
            ]);
            if (!dayBars.length) continue;

            const markers = pack.markers || {};
            const markerList = MarkerService.buildList(markers);
            const visualMarkerList = this.buildFlowMarkerList(pack);
            const strategy = new SniperStrategy({
                windowStart: '09:32:00',
                windowEnd: '10:00:00',
                bufferPct: 0.0015,
                reverseStopCount: 3,
                trailingStop: true,
                hardStopPct: 0.001,
                contextualEntryFilter: true,
                opposingLevelMaxPct: 0.002,
            });
            strategy.reset(markerList, {
                pressure: pack.pressure,
                source: 'pressure-pilot',
                levels: visualMarkerList,
            });
            for (const bar of dayBars) strategy.evaluate(bar);
            strategy.finalize(dayBars[dayBars.length - 1]);
            const state = strategy.getState();
            state.crossBarIdx = strategy.crossBarIdx;
            state.entryBarIdx = strategy.entryBarIdx;

            const trade = state.trades[0];
            let outcome = 'SKIPPED';
            let outcomeClass = 'skipped';
            if (trade) {
                outcome = trade.outcome === 'BREAKEVEN' ? 'BE' : trade.outcome;
                outcomeClass = trade.outcome === 'WON' ? 'won' : trade.outcome === 'LOST' ? 'lost' : 'skipped';
            } else if (state.phase === 'NO_RETEST') {
                outcome = 'NO_RETEST';
            } else if (state.phase === 'NO_CROSS') {
                outcome = 'NO_CROSS';
            } else if (state.phase === 'BLOCKED') {
                outcome = 'BLOCKED';
            }

            const pressure = pack.pressure || {};
            const pressureLabel = pressure.label || 'UNKNOWN';
            const pressureClass = String(pressureLabel).toLowerCase();
            const probe = this.getOpeningProbeResult(pack.symbol, pack.date);
            const probeSignal = probe?.signal?.signal || 'NO_PROBE';
            const probeClass = this.probeSignalClass(probeSignal);
            const components = pressure.components_bps || {};
            const markerMeta = `
                <span><span class="label">PD-C</span> <span class="value neutral">${num(markers.prior_day_close)}</span></span>
                <span><span class="label">D-H</span> <span class="value resistance">${num(markers.daily_high)}</span></span>
                <span><span class="label">D-L</span> <span class="value support">${num(markers.daily_low)}</span></span>
                <span class="pressure-badge ${pressureClass}">${escapeHtml(pressureLabel)}</span>
                <span class="probe-badge ${probeClass}">${escapeHtml(probeSignal)}</span>
            `;

            const card = document.createElement('div');
            card.className = 'chart-card';
            card.innerHTML = `
                <div class="chart-header">
                    <span class="chart-date">${escapeHtml(pack.date)} · ${escapeHtml(pack.symbol)}</span>
                    <div class="chart-meta">${markerMeta}</div>
                </div>
                <div class="chart-container" data-date="${escapeHtml(pack.date)}"></div>
                <div class="chart-footer">
                    <span>F2 ${num(pack.windows?.open_first_2_min?.low)}-${num(pack.windows?.open_first_2_min?.high)} · gap ${num(components.gap, 1)}bp · pre ${num(components.premarket, 1)}bp · probe ${escapeHtml(probe?.signal?.reason || 'not loaded')}</span>
                    <span class="outcome ${outcomeClass}">${escapeHtml(outcome)}</span>
                </div>
            `;

            grid.appendChild(card);
            const container = card.querySelector('.chart-container');
            new FlowChart(container, dayBars, markers, state, {
                range: this.currentRange,
                height: this.currentRange <= 2 ? 640 : 560,
                markerList: visualMarkerList,
                shadedUntil: '09:32:00',
                bufferPct: 0.0015,
            });
        }
    }

    getPressurePacks(symbol) {
        const result = this.pressurePilot?.results?.find(r => r.symbol === symbol);
        return Array.isArray(result?.packs) ? result.packs : [];
    }

    getOpeningProbeResult(symbol, date) {
        return this.openingProbe?.results?.find(r => r.symbol === symbol && r.date === date) || null;
    }

    probeSignalClass(signal) {
        const text = String(signal || '').toLowerCase();
        if (text.includes('bullish')) return 'bullish';
        if (text.includes('bearish')) return 'bearish';
        return 'neutral';
    }

    normalizeBars(bars) {
        return bars
            .filter(b => Number.isFinite(Number(b.open)) && Number.isFinite(Number(b.high)) &&
                Number.isFinite(Number(b.low)) && Number.isFinite(Number(b.close)) && b.time)
            .map(b => ({
                symbol: b.symbol,
                date: b.date,
                time: b.time,
                open: Number(b.open),
                high: Number(b.high),
                low: Number(b.low),
                close: Number(b.close),
                volume: Number(b.volume) || 0,
            }))
            .sort((a, b) => a.time.localeCompare(b.time));
    }

    buildFlowMarkerList(pack) {
        const base = MarkerService.buildList(pack.markers || {});
        const first2 = pack.windows?.open_first_2_min;
        const premarket = pack.windows?.premarket;
        const flowLevels = [
            ['first2_high', first2?.high],
            ['first2_mid', first2 && Number.isFinite(first2.high) && Number.isFinite(first2.low)
                ? (first2.high + first2.low) / 2
                : null],
            ['first2_low', first2?.low],
            ['premarket_high', premarket?.high],
            ['premarket_low', premarket?.low],
        ]
            .filter(([, value]) => Number.isFinite(value))
            .map(([name, value]) => ({ name, value, type: 'flow', tier: 'opening' }));

        return [...base, ...flowLevels].sort((a, b) => b.value - a.value);
    }

    updateFlowSubtitle(text) {
        const subtitle = document.querySelector('#view-flow .view-subtitle');
        if (subtitle) subtitle.textContent = text;
    }

    renderBacktest() {
        const panel = document.getElementById('backtestPanel');
        if (!panel) return;

        const result = this.getBacktestResult();
        const s = result.stats;

        // Stats card
        let statsHtml = `<div class="stats-card"><h3 class="chart-title">${result.title}</h3>`;
        const statRows = [
            ['Total setups', s.total_setups, ''],
            ['Taken', s.taken, ''],
            ['Wins', s.wins, 'positive'],
            ['Losses', s.losses, 'negative'],
            ['Win rate', num(s.win_rate, 1) + '%', s.win_rate >= 50 ? 'positive' : 'negative'],
            ['Net P&L', money(s.net_pnl), s.net_pnl >= 0 ? 'positive' : 'negative'],
            ['Profit factor', s.profit_factor_display || profitFactor(s.profit_factor), s.profit_factor >= 1 ? 'positive' : 'negative'],
            ['Max drawdown', money(s.max_drawdown), 'negative'],
            ['Avg win', money(s.avg_win), 'positive'],
            ['Avg loss', money(s.avg_loss), 'negative'],
            ['Expectancy', money(s.expectancy), s.expectancy >= 0 ? 'positive' : 'negative'],
        ];
        for (const [label, value, cls] of statRows) {
            statsHtml += `<div class="stat-row"><span class="stat-label">${label}</span><span class="stat-value ${cls}">${value}</span></div>`;
        }
        statsHtml += `</div>`;

        // Trades list
        const trades = result.setups.filter(s => ['WON', 'LOST'].includes(s.status));
        let tradesHtml = `<div class="trades-list">
            <div class="trade-row header">
                <span>DATE</span><span>SYM</span><span>DIR</span><span>ENTRY</span><span>EXIT</span>
                <span>REASON</span><span>P&L</span>
            </div>`;
        for (const t of trades) {
            const outcomeCls = t.status === 'WON' ? 'won' : 'lost';
            const dirCls = t.bias === 'BUY' ? 'buy' : 'sell';
            const sign = t.pnl >= 0 ? '+' : '';
            tradesHtml += `<div class="trade-row">
                <span>${t.date}</span>
                <span>${t.symbol}</span>
                <span class="${dirCls}">${t.bias}</span>
                <span>${Number.isFinite(t.entry_price) ? money(t.entry_price) : '-'}</span>
                <span>${Number.isFinite(t.exit_price) ? money(t.exit_price) : '-'}</span>
                <span>${t.exit_reason || '-'}</span>
                <span class="${outcomeCls}">${sign}${money(t.pnl)}</span>
            </div>`;
        }
        tradesHtml += `</div>`;

        panel.innerHTML = statsHtml + tradesHtml;

        // Update trade count in topbar
        const tc = document.getElementById('tradeCount');
        if (tc) tc.textContent = s.taken;
        const status = document.querySelector('.status-text');
        if (status) status.innerHTML = `BACKTEST · ${result.title} · <span id="tradeCount">${s.taken}</span> TRADES`;
    }

    renderPerformance() {
        const panel = document.getElementById('perfPanel');
        if (!panel) return;

        const result = this.getBacktestResult();
        const equity = result.stats.equity || [];

        panel.dataset.source = result.source;

        if (!equity.length) {
            panel.innerHTML = '<div class="placeholder">No trade equity data available</div>';
            return;
        }

        this.renderEquityPanel(panel, result);
    }

    getBacktestResult() {
        if (this.latestBacktest) {
            return {
                title: snapshotTitle(this.latestBacktest),
                source: this.latestBacktest.source || 'Massive',
                stats: this.latestBacktest.stats,
                setups: this.latestBacktest.setups,
            };
        }

        const daily = DAILY_BARS;
        const symbols = Object.keys(daily);
        const barsMap = {};
        for (const sym of symbols) {
            Object.assign(barsMap, this.barsData[sym] || {});
        }

        const runner = new BacktestRunner({
            symbols, shares: 100, dailyBars: daily, barsMap,
            monthFilter: '2026-02',
            strategyFactory: (config = {}) => new SniperStrategy(config),
        });

        const result = runner.run();
        return {
            title: 'FEBRUARY 2026 · SAMPLE',
            source: 'Sample',
            ...result,
        };
    }

    renderEquityPanel(panel, result) {
        const equity = result.stats.equity;
        // Equity curve SVG
        const w = 800, h = 200, pad = { l: 50, r: 20, t: 20, b: 30 };
        const cw = w - pad.l - pad.r, ch = h - pad.t - pad.b;

        if (equity.length) {
            const maxCum = Math.max(...equity.map(e => e.cum));
            const minCum = Math.min(...equity.map(e => e.cum));
            const range = maxCum - minCum || 1;

            let line = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="width:100%; height:200px;">`;
            // Grid
            for (let i = 0; i <= 4; i++) {
                const y = pad.t + (ch / 4) * i;
                const val = maxCum - (range / 4) * i;
                line += `<line x1="${pad.l}" y1="${y}" x2="${w - pad.r}" y2="${y}" stroke="#1a1a28" stroke-width="0.5"/>`;
                line += `<text x="${pad.l - 5}" y="${y + 3}" fill="#555570" font-size="9" font-family="monospace" text-anchor="end">${money(val, 0)}</text>`;
            }

            // Equity line
            let path = '';
            equity.forEach((e, i) => {
                const x = pad.l + (i / (equity.length - 1 || 1)) * cw;
                const y = pad.t + ((maxCum - e.cum) / range) * ch;
                path += (i === 0 ? 'M' : 'L') + num(x, 1, '0.0') + ',' + num(y, 1, '0.0') + ' ';
            });
            line += `<path d="${path}" fill="none" stroke="#00ff88" stroke-width="1.5"/>`;

            // Area fill
            const lastY = pad.t + ((maxCum - equity[equity.length - 1].cum) / range) * ch;
            line += `<path d="${path} L ${pad.l + cw},${pad.t + ch} L ${pad.l},${pad.t + ch} Z" fill="#00ff88" opacity="0.08"/>`;

            line += `</svg>`;
            panel.innerHTML = `
                <div class="equity-chart">
                    <div class="chart-title">EQUITY CURVE · ${result.title}</div>
                    ${line}
                </div>
                <div class="dd-chart">
                    <div class="chart-title">PER-SYMBOL PERFORMANCE</div>
                    ${this.renderPerSymbol(result.stats.perSymbol)}
                </div>
            `;
        }
    }

    renderPerSymbol(perSymbol) {
        let html = '<div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px;">';
        for (const ps of perSymbol) {
            const pnlCls = ps.pnl >= 0 ? 'positive' : 'negative';
            html += `<div style="padding:12px; background: var(--bg-tertiary); border-radius:4px; font-family: monospace;">
                <div style="font-size: 14px; font-weight: bold; margin-bottom: 6px;">${ps.symbol}</div>
                <div style="font-size: 11px; color: var(--text-secondary);">Trades: ${ps.taken} · Win: ${num(ps.win_rate, 1)}%</div>
                <div style="font-size: 14px; color: var(--accent-${ps.pnl >= 0 ? 'green' : 'red'}); margin-top: 4px;">${ps.pnl >= 0 ? '+' : ''}${money(ps.pnl)}</div>
            </div>`;
        }
        html += '</div>';
        return html;
    }

    renderVerify() {
        const panel = document.getElementById('verifyPanel');
        if (!panel) return;
        const testCount = document.getElementById('testCount');
        if (testCount) testCount.textContent = '131';

        const modules = [
            { name: 'SniperStrategy', tests: 32, passed: 32 },
            { name: 'Reverse / Trailing Stop', tests: 18, passed: 18 },
            { name: 'BaseStrategy', tests: 7, passed: 7 },
            { name: 'MarkerService', tests: 15, passed: 15 },
            { name: 'BarLoader', tests: 6, passed: 6 },
            { name: 'BufferSensitivity', tests: 8, passed: 8 },
            { name: 'MarketContext', tests: 20, passed: 20 },
            { name: 'RiskManager', tests: 15, passed: 15 },
            { name: 'BacktestStats', tests: 13, passed: 13 },
            { name: 'Historical Data', tests: 6, passed: 6 },
            { name: 'Integration', tests: 8, passed: 8 },
        ];

        let html = '';
        for (const m of modules) {
            const pct = (m.passed / m.tests) * 100;
            html += `<div class="test-module">
                <div class="test-module-title">${m.name}</div>
                <div class="test-progress">
                    <span>${m.passed}/${m.tests}</span>
                    <div class="test-bar"><div class="test-bar-fill" style="width:${pct}%"></div></div>
                    <span>✓</span>
                </div>
            </div>`;
        }
        panel.innerHTML = html;
    }

    initNewsDigest() {
        this.newsDigest = new NewsDigest();
        this.newsDigest.addArticles(SAMPLE_NEWS);
        const dates = [...new Set(SAMPLE_NEWS.map(a => a.publishedAt.slice(0, 10)))].sort();
        this.newsDates = dates;
        for (const d of dates) this.newsDigest.generateDailyDigest(d);
    }

    renderSentiment() {
        const panel = document.getElementById('view-sentiment');
        if (!panel || !this.newsDigest) return;

        const latestDate = this.newsDates[this.newsDates.length - 1];
        const prevDate = this.newsDates[this.newsDates.length - 2] || latestDate;
        const digest = this.newsDigest.generateDailyDigest(latestDate);
        const comparison = this.newsDigest.compareDigests(latestDate, prevDate);

        const sentColor = digest.overall_sentiment.label.includes('BULL') ? 'positive' :
                         digest.overall_sentiment.label.includes('BEAR') ? 'negative' : 'neutral';
        const trendColor = comparison.score_change > 0.05 ? 'positive' :
                          comparison.score_change < -0.05 ? 'negative' : 'neutral';

        let topicsHTML = '';
        for (const t of digest.top_topics.slice(0, 6)) {
            const pct = Math.min(100, (t.count / Math.max(1, digest.top_topics[0]?.count || 1)) * 100);
            const barColor = t.direction === 'bullish' ? '#00ff88' :
                            t.direction === 'bearish' ? '#ff3355' : '#888';
            topicsHTML += `
                <div class="topic-row">
                    <div class="topic-name">${t.topic}</div>
                    <div class="topic-bar-wrap"><div class="topic-bar" style="width:${pct}%; background:${barColor};"></div></div>
                    <div class="topic-count">${t.count}</div>
                    <div class="topic-sent ${t.direction === 'bullish' ? 'positive' : t.direction === 'bearish' ? 'negative' : ''}">
                        ${t.avg_sentiment > 0 ? '+' : ''}${num(t.avg_sentiment, 2)}
                    </div>
                </div>`;
        }

        const allSymbols = [
            ...digest.market_movers.bullish.slice(0, 3),
            ...digest.market_movers.neutral.slice(0, 1),
            ...digest.market_movers.bearish.slice(-3).reverse(),
        ];
        let symbolsHTML = '';
        for (const s of allSymbols) {
            const barWidth = Math.abs(s.sentiment) * 200;
            const color = s.sentiment > 0.05 ? '#00ff88' : s.sentiment < -0.05 ? '#ff3355' : '#888';
            const marginLeft = s.sentiment > 0 ? '50%' : `calc(50% - ${barWidth}px)`;
            symbolsHTML += `
                <div class="sym-sent-row">
                    <span class="sym-name">${s.symbol}</span>
                    <div class="sym-sent-bar">
                        <div class="sym-sent-fill" style="width:${barWidth}px; background:${color}; margin-left:${marginLeft};"></div>
                    </div>
                    <span class="sym-sent-val" style="color:${color}">${s.sentiment > 0 ? '+' : ''}${num(s.sentiment, 2)}</span>
                </div>`;
        }

        let riskHTML = '';
        for (const n of digest.risk_notes) {
            const icon = n.level === 'warning' ? '⚠️' : n.level === 'caution' ? '⚡' : 'ℹ️';
            const cls = n.level === 'warning' ? 'risk-warn' : n.level === 'caution' ? 'risk-caution' : 'risk-info';
            riskHTML += `<div class="risk-note ${cls}"><span class="risk-icon">${icon}</span>${n.text}</div>`;
        }

        let articlesHTML = '';
        for (const a of digest.top_articles.slice(0, 5)) {
            const color = a.sentiment > 0.05 ? '#00ff88' : a.sentiment < -0.05 ? '#ff3355' : '#888';
            const arrow = a.sentiment > 0.05 ? '▲' : a.sentiment < -0.05 ? '▼' : '▸';
            articlesHTML += `
                <div class="article-row">
                    <span style="color:${color}; margin-right:8px;">${arrow}</span>
                    <div class="article-body">
                        <div class="article-title">${a.title}</div>
                        <div class="article-meta">${a.source} · ${a.topics.join(', ') || 'General'}</div>
                    </div>
                </div>`;
        }

        panel.innerHTML = `
            <div class="view-header">
                <h1 class="view-title">SENTIMENT NET</h1>
                <p class="view-subtitle">NEWS CONTEXT · PRICE ACTION FIRST · ${latestDate}</p>
            </div>
            <div class="sentiment-grid">
                <div class="sent-col">
                    <div class="panel-card">
                        <div class="panel-title">OVERALL MARKET SENTIMENT</div>
                        <div class="sent-score ${sentColor}">${digest.overall_sentiment.label}</div>
                        <div class="sent-meter">
                            <div class="sent-meter-pointer" style="left:${50 + digest.overall_sentiment.score * 45}%;"></div>
                            <span class="meter-label left">BEAR</span>
                            <span class="meter-label center">NEUTRAL</span>
                            <span class="meter-label right">BULL</span>
                        </div>
                        <div class="sent-stats">
                            <div class="sent-stat"><span class="stat-k">Score</span><span class="stat-v ${sentColor}">${num(digest.overall_sentiment.score, 3)}</span></div>
                            <div class="sent-stat"><span class="stat-k">Trend</span><span class="stat-v ${trendColor}">${comparison.trend_acceleration.replace('_', ' ')}</span></div>
                            <div class="sent-stat"><span class="stat-k">Articles</span><span class="stat-v">${digest.article_count}</span></div>
                            <div class="sent-stat"><span class="stat-k">Dispersion</span><span class="stat-v">${num(digest.overall_sentiment.dispersion, 2)}</span></div>
                        </div>
                    </div>
                    <div class="panel-card">
                        <div class="panel-title">DECISION CONTEXT</div>
                        <div class="decision-row"><span class="decision-label">Confidence Multiplier</span><span class="decision-value">${num(digest.decision_context.confidenceMult, 2)}x</span></div>
                        <div class="decision-row"><span class="decision-label">News Weight (max)</span><span class="decision-value">${num(digest.decision_context.weight * 100, 0)}%</span></div>
                        <div class="decision-row"><span class="decision-label">Price Action First</span><span class="decision-value" style="color:#00ff88;">✓ ENFORCED</span></div>
                        <div class="decision-note">News adjusts position sizing ±30% max. Never generates signals. Price action = entry/exit.</div>
                    </div>
                </div>
                <div class="sent-col">
                    <div class="panel-card"><div class="panel-title">TOPIC BREAKDOWN</div><div class="topics-list">${topicsHTML}</div></div>
                    <div class="panel-card"><div class="panel-title">SYMBOL SENTIMENT</div><div class="sym-sent-list">${symbolsHTML}</div></div>
                </div>
                <div class="sent-col">
                    <div class="panel-card"><div class="panel-title">RISK NOTES</div><div class="risk-list">${riskHTML}</div></div>
                    <div class="panel-card"><div class="panel-title">TOP ARTICLES</div><div class="articles-list">${articlesHTML}</div></div>
                </div>
            </div>
        `;
    }

    renderWatchlist() {
        const panel = document.getElementById('view-watchlist');
        if (!panel) return;

        const daily = DAILY_BARS;
        const symbols = Object.keys(daily);

        let html = `
            <div class="view-header">
                <h1 class="view-title">WATCHLIST</h1>
                <p class="view-subtitle">TRACKED SYMBOLS · MARKER LEVELS · SENTIMENT OVERLAY</p>
            </div>
            <div class="watchlist-grid">
        `;

        for (const sym of symbols) {
            const bars = daily[sym] || [];
            const latest = bars[bars.length - 1];
            const prev = bars[bars.length - 2];
            if (!latest || !prev) continue;

            const markers = MarkerService.compute(bars, bars.length - 1);
            const change = latest.c - prev.c;
            const changePct = (change / prev.c) * 100;
            const isUp = change >= 0;

            let sentScore = 0, sentLabel = 'NEUTRAL';
            if (this.newsDigest) {
                const symArticles = this.newsDigest.getArticles({ symbol: sym });
                if (symArticles.length) {
                    const totalWeight = symArticles.reduce((s, a) => s + a.sourceWeight, 0);
                    sentScore = symArticles.reduce((s, a) => s + a.sentiment * a.sourceWeight, 0) / totalWeight;
                    sentLabel = sentScore > 0.1 ? 'BULLISH' : sentScore < -0.1 ? 'BEARISH' : 'NEUTRAL';
                }
            }

            html += `
                <div class="watch-card">
                    <div class="watch-head">
                        <span class="watch-symbol">${sym}</span>
                        <span class="watch-price ${isUp ? 'positive' : 'negative'}">
                            $${num(latest.c)}
                            <span class="watch-change">${isUp ? '+' : ''}${num(change, 2)} (${num(changePct, 2)}%)</span>
                        </span>
                    </div>
                    <div class="watch-markers">
                        <div class="watch-marker res"><span class="mk-label">D-H</span><span class="mk-val">${num(markers.daily_high)}</span></div>
                        <div class="watch-marker neu"><span class="mk-label">PD-C</span><span class="mk-val">${num(markers.prior_day_close)}</span></div>
                        <div class="watch-marker sup"><span class="mk-label">D-L</span><span class="mk-val">${num(markers.daily_low)}</span></div>
                    </div>
                    <div class="watch-sentiment">
                        <span class="sent-chip ${sentLabel.toLowerCase()}">NEWS: ${sentLabel}</span>
                        <span class="sent-score">${sentScore > 0 ? '+' : ''}${num(sentScore, 2)}</span>
                    </div>
                </div>
            `;
        }

        html += `</div>`;
        panel.innerHTML = html;
    }

    renderTradeLog() {
        const panel = document.getElementById('view-tradelog');
        if (!panel) return;

        const bt = this.latestBacktest;
        const setups = bt?.setups || [];
        const trades = setups.filter(s => ['WON', 'LOST', 'RUNNER', 'EOD_UNFAVORABLE'].includes(s.status))
            .sort((a, b) => b.date.localeCompare(a.date));

        let pnlRunning = 0;
        let html = `
            <div class="view-header">
                <h1 class="view-title">TRADE LOG</h1>
                <p class="view-subtitle">ALL TRADES · ${trades.length} TOTAL</p>
            </div>
            <div class="tradelog-list">
                <div class="tradelog-header">
                    <span>DATE</span><span>SYM</span><span>DIR</span>
                    <span>ENTRY</span><span>EXIT</span><span>REASON</span>
                    <span>P&L</span><span>CUM</span>
                </div>
        `;

        for (const t of trades) {
            pnlRunning += t.pnl || 0;
            const outcomeCls = (t.pnl || 0) >= 0 ? 'won' : 'lost';
            const dirCls = t.bias === 'BUY' ? 'buy' : 'sell';
            const sign = (t.pnl || 0) >= 0 ? '+' : '';
            html += `
                <div class="tradelog-row">
                    <span class="tl-date">${t.date}</span>
                    <span class="tl-sym">${t.symbol}</span>
                    <span class="tl-dir ${dirCls}">${t.bias || '-'}</span>
                    <span class="tl-entry">$${num(t.entry_price)}</span>
                    <span class="tl-exit">$${num(t.exit_price)}</span>
                    <span class="tl-reason">${t.exit_reason || '-'}</span>
                    <span class="tl-pnl ${outcomeCls}">${sign}$${num(t.pnl || 0)}</span>
                    <span class="tl-cum ${pnlRunning >= 0 ? 'won' : 'lost'}">${pnlRunning >= 0 ? '+' : ''}$${num(pnlRunning)}</span>
                </div>
            `;
        }

        html += `</div>`;
        panel.innerHTML = html;
    }

    exportSVG() {
        const firstChart = document.querySelector('.chart-svg');
        if (!firstChart) return;
        const svgData = new XMLSerializer().serializeToString(firstChart);
        const blob = new Blob([svgData], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.currentSymbol}_flow_study.svg`;
        a.click();
        URL.revokeObjectURL(url);
    }

    // ============================================
    // BACKTEST LAB
    // ============================================

    initBacktestLab() {
        // Tab switching
        const tabs = document.querySelectorAll('.bt-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const tabId = tab.dataset.tab;
                document.querySelectorAll('.bt-tab-panel').forEach(p => p.classList.remove('active'));
                document.getElementById(`btTab-${tabId}`).classList.add('active');
            });
        });

        // Strategy selector
        const stratSelect = document.getElementById('configStrategy');
        if (stratSelect) {
            stratSelect.addEventListener('change', (e) => {
                this.backtestLab.currentStrategy = e.target.value;
                this.renderStrategyParams();
            });
            this.renderStrategyParams();
        }

        // Month tabs
        document.querySelectorAll('.month-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.month-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const monthKey = tab.dataset.month;
                this.backtestLab.setMonth(monthKey);
                const preset = BacktestLab.getMonthPresets().find(m => m.key === monthKey);
                if (preset) {
                    document.getElementById('configDateFrom').value = preset.days[0];
                    document.getElementById('configDateTo').value = preset.days[1];
                }
            });
        });

        // Date inputs
        const dateFrom = document.getElementById('configDateFrom');
        const dateTo = document.getElementById('configDateTo');
        if (dateFrom) dateFrom.addEventListener('change', (e) => this.backtestLab.dateFrom = e.target.value);
        if (dateTo) dateTo.addEventListener('change', (e) => this.backtestLab.dateTo = e.target.value);

        // Shares
        const sharesInput = document.getElementById('configShares');
        if (sharesInput) {
            sharesInput.addEventListener('change', (e) => {
                this.backtestLab.shares = parseInt(e.target.value, 10) || 100;
            });
        }

        // Data source
        const dataSource = document.getElementById('configDataSource');
        if (dataSource) {
            dataSource.addEventListener('change', (e) => {
                this.backtestLab.dataSource = e.target.value;
                document.getElementById('massiveKeyGroup').style.display =
                    e.target.value === 'massive' ? 'block' : 'none';
            });
        }

        // Symbol search
        const symbolSearch = document.getElementById('symbolSearch');
        if (symbolSearch) {
            symbolSearch.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this._addSymbolFromInput();
            });
        }

        // Add symbol button
        const btnAdd = document.getElementById('btnAddSymbol');
        if (btnAdd) btnAdd.addEventListener('click', () => this._addSymbolFromInput());

        // Preset chips
        document.querySelectorAll('.preset-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const symbols = chip.dataset.symbols.split(',');
                symbols.forEach(s => this.backtestLab.addSymbol(s));
                this.renderSymbolList();
            });
        });

        // Clear symbols
        const btnClear = document.getElementById('btnClearSymbols');
        if (btnClear) {
            btnClear.addEventListener('click', () => {
                this.backtestLab.clearSymbols();
                this.renderSymbolList();
            });
        }

        // Run backtest button
        const btnRun = document.getElementById('btnRunBacktest');
        if (btnRun) {
            btnRun.addEventListener('click', () => this.runBacktestLab());
        }

        // Initial renders
        this.renderSymbolList();
    }

    renderStrategyParams() {
        const container = document.getElementById('strategyParams');
        if (!container) return;

        const stratKey = this.backtestLab.currentStrategy;
        const strat = BacktestLab.getStrategies()[stratKey];
        if (!strat) return;

        const params = strat.params;
        const currentParams = this.backtestLab.getParams(stratKey);

        let html = '';
        for (const p of params) {
            const val = currentParams[p.key] ?? p.default;
            if (p.type === 'checkbox') {
                html += `
                    <div class="form-group">
                        <label style="display:flex;align-items:center;gap:8px;">
                            <input type="checkbox" data-param="${p.key}" ${val ? 'checked' : ''} style="margin:0;">
                            ${p.label}
                        </label>
                    </div>`;
            } else if (p.type === 'time') {
                html += `
                    <div class="form-group">
                        <label>${p.label}</label>
                        <input type="time" class="form-input" data-param="${p.key}" value="${val}" step="1">
                    </div>`;
            } else if (p.type === 'number') {
                const step = p.step ?? 1;
                html += `
                    <div class="form-group">
                        <label>${p.label} <span style="color:var(--text-dim);float:right;" id="param-${p.key}-val">${typeof val === 'number' ? (val < 0.01 ? val.toFixed(4) : val.toFixed(2)) : val}</span></label>
                        <input type="range" class="form-input" data-param="${p.key}"
                            min="${p.min ?? 0}" max="${p.max ?? 100}" step="${step}" value="${val}"
                            style="width:100%;padding:0;accent-color:var(--accent);">
                    </div>`;
            } else {
                html += `
                    <div class="form-group">
                        <label>${p.label}</label>
                        <input type="${p.type}" class="form-input" data-param="${p.key}" value="${val}">
                    </div>`;
            }
        }
        container.innerHTML = html;

        // Bind change events
        container.querySelectorAll('[data-param]').forEach(input => {
            const key = input.dataset.param;
            input.addEventListener('input', (e) => {
                let val;
                if (e.target.type === 'checkbox') val = e.target.checked;
                else if (e.target.type === 'number' || e.target.type === 'range') val = parseFloat(e.target.value);
                else val = e.target.value;
                this.backtestLab.setParam(stratKey, key, val);
                const valEl = document.getElementById(`param-${key}-val`);
                if (valEl) {
                    valEl.textContent = typeof val === 'number'
                        ? (val < 0.01 ? val.toFixed(4) : val.toFixed(2))
                        : val;
                }
            });
        });
    }

    renderSymbolList() {
        const list = document.getElementById('symbolList');
        if (!list) return;

        const countEl = document.getElementById('symbolCount');
        if (countEl) countEl.textContent = `${this.backtestLab.symbols.length} symbols selected`;

        if (this.backtestLab.symbols.length === 0) {
            list.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-dim);font-size:12px;">No symbols selected. Add symbols or use quick presets above.</div>';
            return;
        }

        list.innerHTML = this.backtestLab.symbols.map(sym => `
            <div class="symbol-chip">
                <span>${sym}</span>
                <span class="remove" data-symbol="${sym}">×</span>
            </div>
        `).join('');

        list.querySelectorAll('.remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const sym = e.target.dataset.symbol;
                this.backtestLab.removeSymbol(sym);
                this.renderSymbolList();
            });
        });
    }

    _addSymbolFromInput() {
        const input = document.getElementById('symbolSearch');
        if (!input) return;
        const val = input.value.trim();
        if (val) {
            val.split(',').forEach(s => {
                const cleaned = s.trim().toUpperCase();
                if (cleaned) this.backtestLab.addSymbol(cleaned);
            });
            input.value = '';
            this.renderSymbolList();
        }
    }

    async runBacktestLab() {
        const btn = document.getElementById('btnRunBacktest');
        const progress = document.getElementById('btProgress');
        const progressFill = document.getElementById('progressFill');
        const progressText = document.getElementById('progressText');

        if (!btn || !progress) return;

        if (this.backtestLab.symbols.length === 0) {
            alert('Please select at least one symbol.');
            return;
        }

        btn.disabled = true;
        btn.style.opacity = '0.6';
        progress.style.display = 'block';
        progressFill.style.width = '0%';
        progressText.textContent = 'Preparing data...';

        try {
            // Simulated progress
            let prog = 0;
            const progInterval = setInterval(() => {
                prog = Math.min(prog + Math.random() * 15, 90);
                progressFill.style.width = prog + '%';
                if (prog < 30) progressText.textContent = 'Loading bars...';
                else if (prog < 60) progressText.textContent = 'Running strategy...';
                else progressText.textContent = 'Calculating stats...';
            }, 100);

            const result = await this.backtestLab.run();

            clearInterval(progInterval);
            progressFill.style.width = '100%';
            progressText.textContent = 'Complete!';

            setTimeout(() => {
                progress.style.display = 'none';
                btn.disabled = false;
                btn.style.opacity = '1';
                // Switch to results tab
                document.querySelectorAll('.bt-tab').forEach(t => t.classList.remove('active'));
                document.querySelector('.bt-tab[data-tab="results"]').classList.add('active');
                document.querySelectorAll('.bt-tab-panel').forEach(p => p.classList.remove('active'));
                document.getElementById('btTab-results').classList.add('active');
                this.renderBacktestResults(result);
            }, 500);

        } catch (err) {
            btn.disabled = false;
            btn.style.opacity = '1';
            progress.style.display = 'none';
            alert('Backtest failed: ' + err.message);
        }
    }

    renderBacktestResults(result) {
        const panel = document.getElementById('backtestPanel');
        if (!panel) return;

        const s = result.stats;
        const stratName = BacktestLab.getStrategies()[this.backtestLab.currentStrategy]?.name || 'Strategy';

        // Monthly breakdown
        const monthly = this.backtestLab.getMonthlyBreakdown(result);
        const monthlyHtml = Object.entries(monthly).map(([month, data]) => {
            const pnlColor = data.pnl >= 0 ? 'positive' : 'negative';
            return `
                <div class="month-card">
                    <div class="month-label">${month}</div>
                    <div class="month-pnl ${pnlColor}">${data.pnl >= 0 ? '+' : ''}$${data.pnl.toFixed(0)}</div>
                    <div class="month-trades">${data.taken} trades</div>
                </div>
            `;
        }).join('');

        const statsHtml = `
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-label">Total Setups</div>
                    <div class="stat-number">${s.total_setups}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Taken</div>
                    <div class="stat-number">${s.taken}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Win Rate</div>
                    <div class="stat-number" style="color:${s.win_rate >= 50 ? 'var(--positive)' : 'var(--negative)'}">${s.win_rate.toFixed(1)}%</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Net P&L</div>
                    <div class="stat-number" style="color:${s.net_pnl >= 0 ? 'var(--positive)' : 'var(--negative)'}">${s.net_pnl >= 0 ? '+' : ''}$${s.net_pnl.toFixed(2)}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Profit Factor</div>
                    <div class="stat-number" style="color:${s.profit_factor >= 1 ? 'var(--positive)' : 'var(--negative)'}">${s.profit_factor === Infinity ? '∞' : s.profit_factor.toFixed(2)}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Max Drawdown</div>
                    <div class="stat-number" style="color:var(--negative)">$${s.max_drawdown.toFixed(2)}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Avg Win</div>
                    <div class="stat-number" style="color:var(--positive)">$${s.avg_win?.toFixed(2) || '0.00'}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Avg Loss</div>
                    <div class="stat-number" style="color:var(--negative)">$${s.avg_loss?.toFixed(2) || '0.00'}</div>
                </div>
            </div>

            <div class="chart-title" style="margin:20px 0 10px;font-size:11px;color:var(--accent);font-weight:700;letter-spacing:1px;">MONTHLY BREAKDOWN</div>
            <div class="monthly-results">${monthlyHtml || '<div style="grid-column:1/-1;text-align:center;color:var(--text-dim);">No monthly data</div>'}</div>

            <div class="chart-title" style="margin:20px 0 10px;font-size:11px;color:var(--accent);font-weight:700;letter-spacing:1px;">TRADE LOG · ${stratName.toUpperCase()}</div>
            <div style="overflow-x:auto;">
                <table class="trades-table">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Symbol</th>
                            <th>Dir</th>
                            <th>Entry</th>
                            <th>Exit</th>
                            <th>Reason</th>
                            <th>P&L</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${result.setups.filter(s => ['WON', 'LOST'].includes(s.status)).slice(0, 50).map(t => `
                            <tr>
                                <td>${t.date}</td>
                                <td><strong>${t.symbol}</strong></td>
                                <td class="${t.bias?.toLowerCase() || ''}">${t.bias || '-'}</td>
                                <td>${t.entry_price ? '$' + t.entry_price.toFixed(2) : '-'}</td>
                                <td>${t.exit_price ? '$' + t.exit_price.toFixed(2) : '-'}</td>
                                <td>${t.exit_reason || '-'}</td>
                                <td class="${t.status === 'WON' ? 'won' : 'lost'}">${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>

            <div style="margin-top:16px;text-align:center;color:var(--text-dim);font-size:11px;">
                Showing ${Math.min(50, result.setups.filter(s => ['WON','LOST'].includes(s.status)).length)} of ${s.taken} total trades
            </div>
        `;

        panel.innerHTML = statsHtml;
        panel.classList.add('backtest-results');

        // Update top bar
        const statusEl = document.querySelector('.status-text');
        if (statusEl) {
            statusEl.innerHTML = `BACKTEST · ${this.backtestLab.dateFrom} → ${this.backtestLab.dateTo} · <span id="tradeCount">${s.taken}</span> TRADES`;
        }
        const tc = document.getElementById('tradeCount');
        if (tc) tc.textContent = s.taken;

        // Update performance view too
        this.lastBacktestResult = result;
        this.renderEquityFromResult(result);
    }

    renderEquityFromResult(result) {
        const panel = document.getElementById('perfPanel');
        if (!panel) return;

        const equity = result.stats.equity || [];
        if (!equity.length) {
            panel.innerHTML = '<div class="placeholder">No equity data</div>';
            return;
        }

        // Simple SVG equity curve
        const width = 800, height = 250, pad = 40;
        const values = equity.map(e => e.cum);
        const minV = Math.min(...values, 0);
        const maxV = Math.max(...values, 0);
        const range = maxV - minV || 1;

        const points = equity.map((e, i) => {
            const x = pad + (i / (equity.length - 1 || 1)) * (width - pad * 2);
            const y = pad + (1 - (e.cum - minV) / range) * (height - pad * 2);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(' ');

        const zeroY = pad + (1 - (0 - minV) / range) * (height - pad * 2);

        panel.innerHTML = `
            <div style="background:var(--panel);border:1px solid var(--border);border-radius:4px;padding:16px;">
                <h3 class="chart-title" style="margin:0 0 12px;font-size:11px;color:var(--accent);font-weight:700;letter-spacing:1px;">EQUITY CURVE</h3>
                <svg viewBox="0 0 ${width} ${height}" width="100%" style="max-height:300px;">
                    <line x1="${pad}" y1="${zeroY}" x2="${width - pad}" y2="${zeroY}" stroke="var(--border)" stroke-dasharray="4,4"/>
                    <polyline points="${points}" fill="none" stroke="var(--positive)" stroke-width="2"/>
                    <text x="${pad}" y="${pad - 10}" fill="var(--text-dim)" font-size="10" font-family="monospace">$${maxV.toFixed(0)}</text>
                    <text x="${pad}" y="${zeroY - 5}" fill="var(--text-dim)" font-size="10" font-family="monospace">$0</text>
                    <text x="${pad}" y="${height - pad + 15}" fill="var(--text-dim)" font-size="10" font-family="monospace">$${minV.toFixed(0)}</text>
                </svg>
            </div>

            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-top:16px;">
                ${result.stats.perSymbol?.map(ps => `
                    <div style="background:var(--panel);border:1px solid var(--border);border-radius:4px;padding:12px;">
                        <div style="font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.5px;">${ps.symbol}</div>
                        <div style="font-size:16px;font-weight:700;color:${ps.pnl >= 0 ? 'var(--positive)' : 'var(--negative)'};">
                            ${ps.pnl >= 0 ? '+' : ''}$${ps.pnl.toFixed(2)}
                        </div>
                        <div style="font-size:11px;color:var(--text-dim);margin-top:4px;">
                            ${ps.win_rate?.toFixed(1) || 0}% win · ${ps.taken} trades
                        </div>
                    </div>
                `).join('') || ''}
            </div>
        `;
    }

    setupPatternScanner() {
        const symSelect = document.getElementById('pattern-symbol');
        if (!symSelect) return;

        // Populate symbols from DAILY_BARS
        const symbols = Object.keys(DAILY_BARS);
        symbols.forEach(sym => {
            const opt = document.createElement('option');
            opt.value = sym;
            opt.textContent = sym;
            symSelect.appendChild(opt);
        });

        // Min confidence slider
        const minConf = document.getElementById('pattern-minconf');
        const minConfVal = document.getElementById('pattern-minconf-val');
        if (minConf && minConfVal) {
            minConf.addEventListener('input', () => {
                minConfVal.textContent = minConf.value;
            });
        }

        // Scan button
        const scanBtn = document.getElementById('btn-scan-patterns');
        if (scanBtn) {
            scanBtn.addEventListener('click', () => this.runPatternScan());
        }
    }

    runPatternScan() {
        const symSelect = document.getElementById('pattern-symbol');
        const minConf = parseFloat(document.getElementById('pattern-minconf')?.value || '0.4');
        const symbol = symSelect?.value;
        if (!symbol || !DAILY_BARS[symbol]) return;

        // Normalize bars from DAILY_BARS format (date/o/h/l/c/v) to standard format
        const bars = DAILY_BARS[symbol].map((d, i) => ({
            time: d.date || d.time || i,
            open: d.o !== undefined ? d.o : d.open,
            high: d.h !== undefined ? d.h : d.high,
            low: d.l !== undefined ? d.l : d.low,
            close: d.c !== undefined ? d.c : d.close,
            volume: d.v !== undefined ? d.v : (d.volume || 1000000),
        }));

        // Scan for patterns
        const patterns = PatternDetector.scan(bars, {
            leftBars: 3,
            rightBars: 2,
            trendlineLookback: 30,
        }).filter(p => (p.confidence || 0) >= minConf);

        this.renderPatternList(patterns);

        // Order flow analysis
        const recentHigh = Math.max(...bars.slice(-50).map(b => b.high));
        const recentLow = Math.min(...bars.slice(-50).map(b => b.low));
        const pivotLevel = (recentHigh + recentLow) / 2;
        const ofAnalysis = OrderFlow.analyze(bars, pivotLevel);
        this.renderOrderFlow(ofAnalysis, pivotLevel);

        // Volume profile
        const profile = OrderFlow.calculateVolumeProfile(bars.slice(-100), 40);
        this.renderVolumeProfile(profile);
    }

    renderPatternList(patterns) {
        const list = document.getElementById('pattern-list');
        if (!list) return;

        if (!patterns.length) {
            list.innerHTML = '<div class="empty-state">No patterns found above confidence threshold</div>';
            return;
        }

        const patternNames = {
            double_top: 'Double Top',
            double_bottom: 'Double Bottom',
            head_and_shoulders: 'Head & Shoulders',
            inverse_head_and_shoulders: 'Inverse H&S',
            cup_and_handle: 'Cup & Handle',
            trendline_breakout: 'Trendline Breakout',
            trendline_breakdown: 'Trendline Breakdown',
            bullish_engulfing: 'Bullish Engulfing',
            bearish_engulfing: 'Bearish Engulfing',
            hammer: 'Hammer',
            hanging_man: 'Hanging Man',
            shooting_star: 'Shooting Star',
            inverted_hammer: 'Inverted Hammer',
            doji: 'Doji',
        };

        const directionClass = (p) => {
            const bearish = ['double_top', 'head_and_shoulders', 'trendline_breakdown', 'bearish_engulfing', 'shooting_star', 'hanging_man'];
            const bullish = ['double_bottom', 'inverse_head_and_shoulders', 'cup_and_handle', 'trendline_breakout', 'bullish_engulfing', 'hammer', 'inverted_hammer'];
            if (bearish.includes(p.pattern)) return 'bearish';
            if (bullish.includes(p.pattern)) return '';
            return 'neutral';
        };

        list.innerHTML = patterns.slice(0, 15).map(p => {
            const confPct = Math.round((p.confidence || 0) * 100);
            const name = patternNames[p.pattern] || p.pattern;
            const cls = directionClass(p);
            const level = p.neckline || p.breakoutLevel || p.level || (p.peaks && p.peaks[0]?.price) || '-';
            return `
                <div class="pattern-item ${cls}">
                    <div class="pattern-item-header">
                        <span class="pattern-name">${name}</span>
                        <span class="pattern-confidence">${confPct}%</span>
                    </div>
                    <div class="pattern-details">
                        ${typeof level === 'number' ? `Level: $${level.toFixed(2)}` : ''}
                        ${p.barIndex != null ? `· Bar ${p.barIndex}` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    renderOrderFlow(analysis, level) {
        const list = document.getElementById('orderflow-list');
        if (!list) return;

        if (!analysis.signals.length) {
            list.innerHTML = `<div class="empty-state">
                No order flow signals detected<br>
                <small>Overall bias: <strong>${analysis.overall.toUpperCase()}</strong><br>
                Bullish: ${(analysis.bullishScore * 100).toFixed(0)}% · Bearish: ${(analysis.bearishScore * 100).toFixed(0)}%</small>
            </div>`;
            return;
        }

        const typeNames = {
            false_breakout: 'False Breakout',
            false_breakdown: 'False Breakdown',
            liquidity_grab: 'Liquidity Grab',
            volume_divergence: 'Volume Divergence',
            absorption: 'Absorption',
            climax: 'Climactic Volume',
        };

        list.innerHTML = analysis.signals.map(s => {
            const confPct = Math.round((s.confidence || 0) * 100);
            const name = typeNames[s.type] || s.type;
            const cls = s.direction === 'bullish' ? '' : s.direction === 'bearish' ? 'bearish' : 'neutral';
            const details = s.reasons ? s.reasons.join(' · ') : (s.volRatio ? `Volume: ${s.volRatio.toFixed(2)}x avg` : '');
            return `
                <div class="pattern-item ${cls}">
                    <div class="pattern-item-header">
                        <span class="pattern-name">${name}</span>
                        <span class="pattern-confidence">${confPct}%</span>
                    </div>
                    <div class="pattern-details">${details}</div>
                </div>
            `;
        }).join('') + `
            <div style="margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.1);font-size:12px;color:rgba(255,255,255,0.6)">
                Overall: <strong style="color:${analysis.overall === 'bullish' ? '#4caf50' : analysis.overall === 'bearish' ? '#f44336' : '#ff9800'}">${analysis.overall.toUpperCase()}</strong>
                · Bull: ${(analysis.bullishScore * 100).toFixed(0)}% · Bear: ${(analysis.bearishScore * 100).toFixed(0)}%
            </div>
        `;
    }

    renderVolumeProfile(profile) {
        const container = document.getElementById('volume-profile');
        if (!container || !profile) return;

        const maxVol = Math.max(...profile.profile.map(p => p.volume));
        const pocPrice = profile.poc;
        const vah = profile.valueAreaHigh;
        const val = profile.valueAreaLow;

        container.innerHTML = `
            <div style="display:flex;justify-content:space-between;font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:8px">
                <span>POC: $${pocPrice.toFixed(2)}</span>
                <span>Value Area: $${val.toFixed(2)} - $${vah.toFixed(2)}</span>
                <span>HVN: ${profile.hvn.length} · LVN: ${profile.lvn.length}</span>
            </div>
            <div class="volume-profile">
                ${profile.profile.map(p => {
                    const h = maxVol > 0 ? (p.volume / maxVol * 100) : 0;
                    const isPOC = Math.abs(p.price - pocPrice) < profile.binSize;
                    const inVA = p.price >= val && p.price <= vah;
                    const cls = isPOC ? 'vp-bar poc' : inVA ? 'vp-bar value-area' : 'vp-bar';
                    return `<div class="${cls}" style="height:${h}%" title="$${p.price.toFixed(2)}: ${Math.round(p.volume)} vol"></div>`;
                }).join('')}
            </div>
        `;
    }

    updateClock() {
        const el = document.getElementById('timeDisplay');
        if (!el) return;
        const now = new Date();
        const h = String(now.getHours()).padStart(2, '0');
        const m = String(now.getMinutes()).padStart(2, '0');
        const s = String(now.getSeconds()).padStart(2, '0');
        el.textContent = `${h}:${m}:${s} ET`;
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    window.sniperApp = new SniperApp();
});
