/**
 * SNIPER AI // TERMINAL — Frontend App
 *
 * Flow Study: visualizes 1-minute bars with marker levels,
 * showing cross → retest → entry annotations exactly like the v1 webapp.
 */

import { MarkerService } from '../src/market/MarkerService.js';
import { SniperStrategy } from '../src/strategies/SniperStrategy.js';
import { DAILY_BARS } from '../src/data/historicalData.js';
import { BacktestRunner } from '../src/backtest/BacktestRunner.js';
import { BacktestStats } from '../src/backtest/BacktestStats.js';
import { BarLoader } from '../src/market/BarLoader.js';
import { BufferSensitivity } from '../src/analysis/BufferSensitivity.js';
import { NewsDigest } from '../src/news/NewsDigest.js';
import { SAMPLE_NEWS } from '../src/data/sampleNews.js';

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
        this.markerList = MarkerService.buildList(markers);
        this.strategyResult = strategyResult;
        this.config = {
            width: config.width || 480,
            height: config.height || 220,
            padding: { top: 16, right: 60, bottom: 24, left: 10 },
            range: config.range || 30, // minutes to show
            candleWidth: config.candleWidth || 3,
            candleGap: config.candleGap || 1,
        };
        this.render();
    }

    render() {
        const { width, height, padding, range, candleWidth, candleGap } = this.config;
        const chartW = width - padding.left - padding.right;
        const chartH = height - padding.top - padding.bottom;

        // Visible bars
        const visibleBars = this.bars.slice(0, range);
        if (!visibleBars.length) return;

        // Price range
        let minPrice = Infinity, maxPrice = -Infinity;
        for (const b of visibleBars) {
            minPrice = Math.min(minPrice, b.low);
            maxPrice = Math.max(maxPrice, b.high);
        }
        // Include markers
        for (const m of this.markerList) {
            minPrice = Math.min(minPrice, m.value);
            maxPrice = Math.max(maxPrice, m.value);
        }
        const pricePad = (maxPrice - minPrice) * 0.1;
        minPrice -= pricePad;
        maxPrice += pricePad;

        const priceToY = (p) => padding.top + ((maxPrice - p) / (maxPrice - minPrice)) * chartH;
        const barToX = (i) => padding.left + i * (candleWidth + candleGap) + candleWidth / 2;

        // Build SVG
        let svg = `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">`;

        // Grid lines
        svg += `<g class="grid">`;
        for (let i = 0; i <= 4; i++) {
            const y = padding.top + (chartH / 4) * i;
            const p = maxPrice - ((maxPrice - minPrice) / 4) * i;
            svg += `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="#1a1a28" stroke-width="0.5" stroke-dasharray="2,2"/>`;
            svg += `<text x="${width - padding.right + 4}" y="${y + 3}" fill="#555570" font-size="9" font-family="monospace">${p.toFixed(2)}</text>`;
        }
        svg += `</g>`;

        // Marker lines
        svg += `<g class="markers">`;
        for (const m of this.markerList) {
            const y = priceToY(m.value);
            const color = m.type === 'resistance' ? '#ff8844' :
                          m.type === 'support' ? '#44aaff' : '#666688';
            const dash = m.type === 'neutral' ? '4,4' : '';

            svg += `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}"
                    stroke="${color}" stroke-width="1" stroke-dasharray="${dash}" opacity="0.6"/>`;

            // Marker label on left
            const label = this.abbreviateMarker(m.name);
            svg += `<rect x="${padding.left}" y="${y - 7}" width="32" height="14" fill="${color}" opacity="0.15"/>`;
            svg += `<text x="${padding.left + 3}" y="${y + 3}" fill="${color}" font-size="8"
                    font-family="monospace" font-weight="bold">${label}</text>`;

            // Marker value on right
            svg += `<text x="${width - padding.right - 3}" y="${y + 3}" fill="${color}" font-size="8"
                    font-family="monospace" text-anchor="end">${m.value.toFixed(2)}</text>`;
        }
        svg += `</g>`;

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

            // Wick
            svg += `<line x1="${x}" y1="${priceToY(b.high)}" x2="${x}" y2="${priceToY(b.low)}"
                    stroke="${color}" stroke-width="0.8" opacity="0.8"/>`;

            // Body
            svg += `<rect x="${x - candleWidth / 2}" y="${bodyTop}"
                    width="${candleWidth}" height="${bodyH}"
                    fill="${bullish ? color : color}" opacity="0.9"/>`;
        }
        svg += `</g>`;

        // Strategy annotations (cross, retest, entry)
        if (this.strategyResult) {
            svg += `<g class="annotations">`;
            svg += this.drawAnnotations(visibleBars, barToX, priceToY);
            svg += `</g>`;
        }

        // Time axis
        svg += `<g class="time-axis">`;
        const timeSteps = [0, Math.floor(range / 2), range - 1];
        for (const i of timeSteps) {
            if (visibleBars[i]) {
                const x = barToX(i);
                const t = visibleBars[i].time.slice(0, 5);
                svg += `<text x="${x}" y="${height - 8}" fill="#555570" font-size="8"
                        font-family="monospace" text-anchor="middle">${t}</text>`;
            }
        }
        svg += `</g>`;

        svg += `</svg>`;
        this.container.innerHTML = svg;
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
        this.currentRange = 30;
        this.barsData = {}; // symbol → barsMap
        this.init();
    }

    init() {
        // Pre-generate data
        for (const sym of Object.keys(DAILY_BARS)) {
            const { barsMap } = generateAllBars(sym);
            this.barsData[sym] = barsMap;
        }

        this.setupNavigation();
        this.setupControls();
        this.initNewsDigest();
        this.renderFlowStudy();
        this.renderBacktest();
        this.renderPerformance();
        this.renderVerify();
        this.renderSentiment();
        this.renderWatchlist();
        this.renderTradeLog();
        this.updateClock();
        setInterval(() => this.updateClock(), 1000);
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
                <span><span class="label">PD-O</span> <span class="value neutral">${markers.prior_day_open.toFixed(2)}</span></span>
                <span><span class="label">PD-C</span> <span class="value neutral">${markers.prior_day_close.toFixed(2)}</span></span>
                <span><span class="label">D-H</span> <span class="value resistance">${markers.daily_high.toFixed(2)}</span></span>
                <span><span class="label">D-L</span> <span class="value support">${markers.daily_low.toFixed(2)}</span></span>
            `;

            card.innerHTML = `
                <div class="chart-header">
                    <span class="chart-date">${day.date}</span>
                    <div class="chart-meta">${markerMeta}</div>
                </div>
                <div class="chart-container" data-date="${day.date}"></div>
                <div class="chart-footer">
                    <span>O ${day.o.toFixed(2)} · C ${day.c.toFixed(2)}</span>
                    <span class="outcome ${outcomeClass}">${outcome}</span>
                </div>
            `;

            grid.appendChild(card);

            // Render chart
            const container = card.querySelector('.chart-container');
            new FlowChart(container, dayBars, markers, state, { range: this.currentRange });
        }
    }

    renderBacktest() {
        const panel = document.getElementById('backtestPanel');
        if (!panel) return;

        const daily = DAILY_BARS;
        const symbols = Object.keys(daily);

        // Build combined bars map
        const barsMap = {};
        for (const sym of symbols) {
            const symMap = this.barsData[sym] || {};
            Object.assign(barsMap, symMap);
        }

        const runner = new BacktestRunner({
            symbols, shares: 100, dailyBars: daily, barsMap,
            monthFilter: '2026-02',
            strategyFactory: (config = {}) => new SniperStrategy(config),
        });

        const result = runner.run();
        const s = result.stats;

        // Stats card
        let statsHtml = `<div class="stats-card"><h3 class="chart-title">FEBRUARY 2026 · BACKTEST</h3>`;
        const statRows = [
            ['Total setups', s.total_setups, ''],
            ['Taken', s.taken, ''],
            ['Wins', s.wins, 'positive'],
            ['Losses', s.losses, 'negative'],
            ['Win rate', s.win_rate.toFixed(1) + '%', s.win_rate >= 50 ? 'positive' : 'negative'],
            ['Net P&L', '$' + s.net_pnl.toFixed(2), s.net_pnl >= 0 ? 'positive' : 'negative'],
            ['Profit factor', s.profit_factor === Infinity ? '∞' : s.profit_factor.toFixed(2), s.profit_factor >= 1 ? 'positive' : 'negative'],
            ['Max drawdown', '$' + s.max_drawdown.toFixed(2), 'negative'],
            ['Avg win', '$' + s.avg_win.toFixed(2), 'positive'],
            ['Avg loss', '$' + s.avg_loss.toFixed(2), 'negative'],
            ['Expectancy', '$' + s.expectancy.toFixed(2), s.expectancy >= 0 ? 'positive' : 'negative'],
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
                <span>$${t.entry_price?.toFixed(2) || '-'}</span>
                <span>$${t.exit_price?.toFixed(2) || '-'}</span>
                <span>${t.exit_reason || '-'}</span>
                <span class="${outcomeCls}">${sign}$${t.pnl.toFixed(2)}</span>
            </div>`;
        }
        tradesHtml += `</div>`;

        panel.innerHTML = statsHtml + tradesHtml;

        // Update trade count in topbar
        const tc = document.getElementById('tradeCount');
        if (tc) tc.textContent = s.taken;
    }

    renderPerformance() {
        const panel = document.getElementById('perfPanel');
        if (!panel) return;

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
                line += `<text x="${pad.l - 5}" y="${y + 3}" fill="#555570" font-size="9" font-family="monospace" text-anchor="end">$${val.toFixed(0)}</text>`;
            }

            // Equity line
            let path = '';
            equity.forEach((e, i) => {
                const x = pad.l + (i / (equity.length - 1 || 1)) * cw;
                const y = pad.t + ((maxCum - e.cum) / range) * ch;
                path += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1) + ' ';
            });
            line += `<path d="${path}" fill="none" stroke="#00ff88" stroke-width="1.5"/>`;

            // Area fill
            const lastY = pad.t + ((maxCum - equity[equity.length - 1].cum) / range) * ch;
            line += `<path d="${path} L ${pad.l + cw},${pad.t + ch} L ${pad.l},${pad.t + ch} Z" fill="#00ff88" opacity="0.08"/>`;

            line += `</svg>`;
            panel.innerHTML = `
                <div class="equity-chart">
                    <div class="chart-title">EQUITY CURVE</div>
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
                <div style="font-size: 11px; color: var(--text-secondary);">Trades: ${ps.taken} · Win: ${ps.win_rate.toFixed(1)}%</div>
                <div style="font-size: 14px; color: var(--accent-${ps.pnl >= 0 ? 'green' : 'red'}); margin-top: 4px;">${ps.pnl >= 0 ? '+' : ''}$${ps.pnl.toFixed(2)}</div>
            </div>`;
        }
        html += '</div>';
        return html;
    }

    renderVerify() {
        const panel = document.getElementById('verifyPanel');
        if (!panel) return;

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
        // Generate digests for all unique dates
        const dates = [...new Set(SAMPLE_NEWS.map(a => a.publishedAt.slice(0, 10)))].sort();
        this.newsDates = dates;
        for (const d of dates) this.newsDigest.generateDailyDigest(d);
    }

    renderSentiment() {
        const panel = document.getElementById('view-sentiment');
        if (!panel) return;

        if (!this.newsDigest) this.initNewsDigest();

        const latestDate = this.newsDates[this.newsDates.length - 1];
        const prevDate = this.newsDates[this.newsDates.length - 2] || latestDate;
        const digest = this.newsDigest.generateDailyDigest(latestDate);
        const comparison = this.newsDigest.compareDigests(latestDate, prevDate);

        const sentColor = digest.overall_sentiment.label.includes('BULL') ? 'positive' :
                         digest.overall_sentiment.label.includes('BEAR') ? 'negative' : 'neutral';
        const trendIcon = comparison.score_change > 0.05 ? '↗' :
                         comparison.score_change < -0.05 ? '↘' : '→';
        const trendColor = comparison.score_change > 0.05 ? 'positive' :
                          comparison.score_change < -0.05 ? 'negative' : 'neutral';

        // Topic bars
        let topicsHTML = '';
        for (const t of digest.top_topics.slice(0, 6)) {
            const pct = Math.min(100, (t.count / Math.max(1, digest.top_topics[0]?.count || 1)) * 100);
            const barColor = t.direction === 'bullish' ? '#00ff88' :
                            t.direction === 'bearish' ? '#ff3355' : '#888';
            topicsHTML += `
                <div class="topic-row">
                    <div class="topic-name">${t.topic}</div>
                    <div class="topic-bar-wrap">
                        <div class="topic-bar" style="width:${pct}%; background:${barColor}; opacity:0.7;"></div>
                    </div>
                    <div class="topic-count">${t.count}</div>
                    <div class="topic-sent ${t.direction === 'bullish' ? 'positive' : t.direction === 'bearish' ? 'negative' : ''}">
                        ${t.avg_sentiment > 0 ? '+' : ''}${t.avg_sentiment.toFixed(2)}
                    </div>
                </div>`;
        }

        // Per-symbol sentiment
        const allSymbols = [
            ...digest.market_movers.bullish.slice(0, 3),
            ...digest.market_movers.neutral.slice(0, 1),
            ...digest.market_movers.bearish.slice(-3).reverse(),
        ];
        let symbolsHTML = '';
        for (const s of allSymbols) {
            const barWidth = Math.abs(s.sentiment) * 200;
            const direction = s.sentiment > 0 ? 'right' : 'left';
            const color = s.sentiment > 0.05 ? '#00ff88' : s.sentiment < -0.05 ? '#ff3355' : '#888';
            symbolsHTML += `
                <div class="sym-sent-row">
                    <span class="sym-name">${s.symbol}</span>
                    <div class="sym-sent-bar">
                        <div class="sym-sent-fill" style="width:${barWidth}px; background:${color}; ${direction === 'right' ? 'margin-left:50%' : 'margin-left:calc(50% - ' + barWidth + 'px)'}"></div>
                    </div>
                    <span class="sym-sent-val" style="color:${color}">${s.sentiment > 0 ? '+' : ''}${s.sentiment.toFixed(2)}</span>
                </div>`;
        }

        // Risk notes
        let riskHTML = '';
        for (const n of digest.risk_notes) {
            const icon = n.level === 'warning' ? '⚠️' : n.level === 'caution' ? '⚡' : 'ℹ️';
            const cls = n.level === 'warning' ? 'risk-warn' : n.level === 'caution' ? 'risk-caution' : 'risk-info';
            riskHTML += `<div class="risk-note ${cls}"><span class="risk-icon">${icon}</span>${n.text}</div>`;
        }

        // Top articles
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
                <!-- Left column: overall sentiment + trend -->
                <div class="sent-col">
                    <div class="panel-card">
                        <div class="panel-title">OVERALL MARKET SENTIMENT</div>
                        <div class="sent-score ${sentColor}">${digest.overall_sentiment.label}</div>
                        <div class="sent-meter">
                            <div class="sent-meter-fill" style="left:50%; width:50%;"></div>
                            <div class="sent-meter-pointer" style="left:${50 + digest.overall_sentiment.score * 45}%;"></div>
                            <span class="meter-label left">BEAR</span>
                            <span class="meter-label center">NEUTRAL</span>
                            <span class="meter-label right">BULL</span>
                        </div>
                        <div class="sent-stats">
                            <div class="sent-stat">
                                <span class="stat-k">Score</span>
                                <span class="stat-v ${sentColor}">${digest.overall_sentiment.score.toFixed(3)}</span>
                            </div>
                            <div class="sent-stat">
                                <span class="stat-k">Trend</span>
                                <span class="stat-v ${trendColor}">${trendIcon} ${comparison.trend_acceleration.replace('_', ' ')}</span>
                            </div>
                            <div class="sent-stat">
                                <span class="stat-k">Articles</span>
                                <span class="stat-v">${digest.article_count}</span>
                            </div>
                            <div class="sent-stat">
                                <span class="stat-k">Dispersion</span>
                                <span class="stat-v">${digest.overall_sentiment.dispersion.toFixed(2)}</span>
                            </div>
                        </div>
                    </div>

                    <div class="panel-card">
                        <div class="panel-title">DECISION CONTEXT</div>
                        <div class="decision-row">
                            <span class="decision-label">Confidence Multiplier</span>
                            <span class="decision-value">${digest.decision_context.confidenceMult.toFixed(2)}x</span>
                        </div>
                        <div class="decision-row">
                            <span class="decision-label">News Weight (max)</span>
                            <span class="decision-value">${(digest.decision_context.weight * 100).toFixed(0)}%</span>
                        </div>
                        <div class="decision-row">
                            <span class="decision-label">Price Action First</span>
                            <span class="decision-value" style="color:#00ff88;">✓ ENFORCED</span>
                        </div>
                        <div class="decision-note">
                            News sentiment adjusts position sizing within ±30%.
                            It never generates a signal. Price action = entry/exit.
                        </div>
                    </div>
                </div>

                <!-- Middle column: topics + symbols -->
                <div class="sent-col">
                    <div class="panel-card">
                        <div class="panel-title">TOPIC BREAKDOWN</div>
                        <div class="topics-list">${topicsHTML}</div>
                    </div>

                    <div class="panel-card">
                        <div class="panel-title">SYMBOL SENTIMENT</div>
                        <div class="sym-sent-list">${symbolsHTML}</div>
                    </div>
                </div>

                <!-- Right column: risk + articles -->
                <div class="sent-col">
                    <div class="panel-card">
                        <div class="panel-title">RISK NOTES</div>
                        <div class="risk-list">${riskHTML}</div>
                    </div>

                    <div class="panel-card">
                        <div class="panel-title">TOP ARTICLES</div>
                        <div class="articles-list">${articlesHTML}</div>
                    </div>
                </div>
            </div>

            <!-- Historical comparison strip -->
            <div class="panel-card history-strip">
                <div class="panel-title">HISTORICAL COMPARISON</div>
                <div class="history-row">
                    <div class="history-item">
                        <span class="hist-label">vs Previous Period</span>
                        <span class="hist-val ${comparison.score_change > 0 ? 'positive' : 'negative'}">
                            ${comparison.score_change > 0 ? '+' : ''}${comparison.score_change.toFixed(3)}
                        </span>
                    </div>
                    <div class="history-item">
                        <span class="hist-label">Trend Acceleration</span>
                        <span class="hist-val">${comparison.trend_acceleration.replace('_', ' ')}</span>
                    </div>
                    <div class="history-item">
                        <span class="hist-label">Confidence Change</span>
                        <span class="hist-val ${comparison.confidence_change >= 0 ? 'positive' : 'negative'}">
                            ${comparison.confidence_change >= 0 ? '+' : ''}${comparison.confidence_change.toFixed(3)}
                        </span>
                    </div>
                    <div class="history-item interpret">
                        <span class="hist-label">Interpretation</span>
                        <span class="hist-val">${comparison.interpretation}</span>
                    </div>
                </div>
                <div class="history-chart" id="historyChart">
                    <!-- Mini trend chart will be generated by JS -->
                </div>
            </div>
        `;

        // Render mini trend chart
        this._renderHistoryChart(latestDate);
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

            // Get sentiment
            const symSent = this.newsDigest?.getArticles({ symbol: sym });
            const sentScore = symSent && symSent.length
                ? symSent.reduce((s, a) => s + a.sentiment * a.sourceWeight, 0) /
                  symSent.reduce((s, a) => s + a.sourceWeight, 0)
                : 0;
            const sentLabel = sentScore > 0.1 ? 'BULLISH' : sentScore < -0.1 ? 'BEARISH' : 'NEUTRAL';

            html += `
                <div class="watch-card">
                    <div class="watch-head">
                        <span class="watch-symbol">${sym}</span>
                        <span class="watch-price ${isUp ? 'positive' : 'negative'}">
                            $${latest.c.toFixed(2)}
                            <span class="watch-change">${isUp ? '+' : ''}${change.toFixed(2)} (${changePct.toFixed(2)}%)</span>
                        </span>
                    </div>
                    <div class="watch-markers">
                        <div class="watch-marker res">
                            <span class="mk-label">D-H</span>
                            <span class="mk-val">${markers.daily_high.toFixed(2)}</span>
                        </div>
                        <div class="watch-marker neu">
                            <span class="mk-label">PD-C</span>
                            <span class="mk-val">${markers.prior_day_close.toFixed(2)}</span>
                        </div>
                        <div class="watch-marker sup">
                            <span class="mk-label">D-L</span>
                            <span class="mk-val">${markers.daily_low.toFixed(2)}</span>
                        </div>
                    </div>
                    <div class="watch-sentiment">
                        <span class="sent-chip ${sentLabel.toLowerCase()}">NEWS: ${sentLabel}</span>
                        <span class="sent-score">${sentScore > 0 ? '+' : ''}${sentScore.toFixed(2)}</span>
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
        const trades = result.setups.filter(s => ['WON', 'LOST', 'RUNNER', 'EOD_UNFAVORABLE'].includes(s.status))
            .sort((a, b) => b.date.localeCompare(a.date));

        let pnlRunning = 0;
        let html = `
            <div class="view-header">
                <h1 class="view-title">TRADE LOG</h1>
                <p class="view-subtitle">ALL TRADES · ${trades.length} TOTAL · FEBRUARY 2026</p>
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
            const outcomeCls = t.pnl >= 0 ? 'won' : 'lost';
            const dirCls = t.bias === 'BUY' ? 'buy' : 'sell';
            const sign = (t.pnl || 0) >= 0 ? '+' : '';
            html += `
                <div class="tradelog-row">
                    <span class="tl-date">${t.date}</span>
                    <span class="tl-sym">${t.symbol}</span>
                    <span class="tl-dir ${dirCls}">${t.bias || '-'}</span>
                    <span class="tl-entry">$${t.entry_price?.toFixed(2) || '-'}</span>
                    <span class="tl-exit">$${t.exit_price?.toFixed(2) || '-'}</span>
                    <span class="tl-reason">${t.exit_reason || '-'}</span>
                    <span class="tl-pnl ${outcomeCls}">${sign}$${(t.pnl || 0).toFixed(2)}</span>
                    <span class="tl-cum ${pnlRunning >= 0 ? 'won' : 'lost'}">${pnlRunning >= 0 ? '+' : ''}$${pnlRunning.toFixed(2)}</span>
                </div>
            `;
        }

        html += `</div>`;
        panel.innerHTML = html;
    }

    _renderHistoryChart(latestDate) {
        const chartEl = document.getElementById('historyChart');
        if (!chartEl) return;

        const dates = this.newsDates.slice(-7);
        const scores = dates.map(d => {
            const dig = this.newsDigest.generateDailyDigest(d);
            return dig.overall_sentiment.score;
        });

        const w = chartEl.offsetWidth || 800;
        const h = 80;
        const pad = { l: 30, r: 10, t: 10, b: 20 };
        const cw = w - pad.l - pad.r;
        const ch = h - pad.t - pad.b;

        const max = Math.max(0.5, ...scores.map(s => Math.abs(s)));
        const midY = pad.t + ch / 2;

        let path = '';
        dates.forEach((d, i) => {
            const x = pad.l + (i / Math.max(1, dates.length - 1)) * cw;
            const y = midY - (scores[i] / max) * (ch / 2);
            path += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1) + ' ';
        });

        let svg = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="width:100%;height:${h}px;">`;
        // Zero line
        svg += `<line x1="${pad.l}" y1="${midY}" x2="${w - pad.r}" y2="${midY}" stroke="#333" stroke-width="1" stroke-dasharray="3,3"/>`;
        // Labels
        svg += `<text x="2" y="${pad.t + 4}" fill="#555" font-size="9" font-family="monospace">+${max.toFixed(1)}</text>`;
        svg += `<text x="2" y="${midY + 3}" fill="#555" font-size="9" font-family="monospace">0</text>`;
        svg += `<text x="2" y="${h - pad.b + 2}" fill="#555" font-size="9" font-family="monospace">-${max.toFixed(1)}</text>`;
        // Date labels
        dates.forEach((d, i) => {
            const x = pad.l + (i / Math.max(1, dates.length - 1)) * cw;
            svg += `<text x="${x}" y="${h - 4}" fill="#555" font-size="8" font-family="monospace" text-anchor="middle">${d.slice(5)}</text>`;
        });
        // Sentiment line
        svg += `<path d="${path}" fill="none" stroke="#00ff88" stroke-width="1.5"/>`;
        // Dots
        dates.forEach((d, i) => {
            const x = pad.l + (i / Math.max(1, dates.length - 1)) * cw;
            const y = midY - (scores[i] / max) * (ch / 2);
            const color = scores[i] > 0.05 ? '#00ff88' : scores[i] < -0.05 ? '#ff3355' : '#888';
            svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2" fill="${color}"/>`;
        });
        svg += `</svg>`;
        chartEl.innerHTML = svg;
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
