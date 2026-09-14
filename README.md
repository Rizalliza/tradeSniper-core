# TradeSniper Core v2.0

Marker-retest stock trading strategy engine + full web-based visualization dashboard.
Price-action first, context-aware, risk-managed.

## Web Dashboard

The webapp at `webapp/` is a full Terminal-style dark UI with:

**Flow Study** — The core visualization from v1:
- Grid of daily 1-minute bar charts
- All 8 marker levels with support/resistance coloring (orange = resistance, blue = support, gray = neutral)
- Cross × retest → entry annotations on each chart
- BUY (green ▲) and SELL (red ▼) entry markers
- Win/loss outcome badge per day
- Symbol tabs (AAPL / TSLA / NVDA)
- Time range: OPEN 30MIN / FULL DAY
- SVG export

**Other Views:**
- Backtest — full results with trade list and statistics
- Performance — equity curve + per-symbol breakdown
- Verify — test suite status
- Sniper Mode — real-time signal detection (production mode)
- Sentiment Net — market context overview
- Watchlist / Trade Log

Run the webapp:
```bash
npm start        # or: npm run webapp:dev
# Open http://localhost:3000
```

No build step required — pure vanilla JS with SVG rendering, ES module imports directly from `src/`.

## Strategy Overview

The Sniper strategy is a 3-phase marker-retest system:

1. **Phase 1 — Cross**: Price crosses a key marker level (daily/weekly/monthly high/low, prior open/close)
2. **Phase 2 — Retest**: Price returns to the crossed marker within a buffer zone (default 0.15%)
3. **Phase 3 — Entry**: Enter at the marker level in the retest direction

**Exit logic:**
- Profit target: next adjacent marker in the trade direction
- Reverse stop: N reverse crossings of the entry marker (default 3 for low risk)
- Trailing stop: when reverseStopCount is reached but trade is profitable, activate trailing stop at entry level, tightening as forward markers are hit
- EOD: open trades become RUNNER (profitable) or EOD_UNFAVORABLE (losing)

**Entry window:** 09:30–09:45 ET (first 15 minutes)

## Architecture

```
src/
├── strategies/
│   ├── BaseStrategy.js      # Base class with state management
│   └── SniperStrategy.js    # Core marker-retest strategy
├── market/
│   ├── MarkerService.js     # 8 price markers + crossing detection + support/resistance
│   └── BarLoader.js         # CSV loading, aggregation, window filtering
├── data/
│   ├── MassiveData.js       # Massive.com (Polygon) API + S3 flat file adapter
│   └── historicalData.js    # Test data for AAPL/TSLA/NVDA
├── backtest/
│   ├── BacktestRunner.js    # Multi-symbol multi-day backtest engine
│   └── BacktestStats.js     # Statistics + equity curve + per-symbol breakdown
├── analysis/
│   └── BufferSensitivity.js # Buffer percentage optimization tool
├── context/
│   └── MarketContext.js     # Market context: VIX regime, earnings, FOMC
└── risk/
    └── RiskManager.js       # Position sizing, daily limits, streak adjustment
```

## Installation

```bash
npm install
```

## Running Tests

```bash
npm test
# 128 tests pass
```

## Backtesting

With synthetic test data (generates + runs):
```bash
npm run backtest:gen
```

With your own CSV data:
```bash
node scripts/runBacktest.js --bars path/to/bars.csv --month 2026-02 --risk low
```

Options:
- `--bars` - Path to CSV with intraday bars
- `--month` - Month filter (YYYY-MM format)
- `--risk` - Risk mode: `high` (1 reverse), `mid` (2 reverses), `low` (3 reverses)
- `--reverse-stop` - Custom reverse stop count
- `--buffer` - Buffer percentage (e.g., `0.002` for 0.2%)
- `--window-end` - Entry window end time

## Buffer Sensitivity Analysis

Find the optimal retest buffer:
```bash
node scripts/bufferAnalysis.js --bars data/test_minute_bars.csv
```

## Market Context

The strategy adapts parameters based on market context:

| VIX Level | Regime | Buffer | Reverse Stops |
|-----------|--------|--------|---------------|
| < 12      | EXTREME_LOW | 0.7x | 0.67x |
| 12-18     | LOW    | 0.85x  | 0.83x |
| 18-25     | NORMAL | 1.0x   | 1.0x |
| 25-35     | HIGH   | 1.5x   | 1.33x |
| > 35      | EXTREME | 2.0x  | 1.67x |

**Skip rules:**
- FOMC days: skip all trades
- Earnings within 2 days: skip that symbol
- Configurable per symbol

## Risk Management

- Position sizing: risk % of account per trade (default 1%)
- Max daily loss: 3% of account
- Max daily trades: 5
- Loss streak reduction: halve position after 2+ losses
- Win streak increase: +20% after 3+ wins (capped at 2x)

## Data Adapters

**Massive.com (Polygon) API:**
- REST API for on-demand bars (second/minute/day)
- S3 flat files for bulk historical downloads

Add your API key to `.env`:
```
MASSIVE_API_KEY=your_key_here
MASSIVE_ACCESS_KEY=your_s3_key
MASSIVE_SECRET_KEY=your_s3_secret
```

## Support & Resistance

All markers are typed:
- `monthly_high`, `weekly_high`, `daily_high` → **resistance**
- `daily_low`, `weekly_low`, `monthly_low` → **support**
- `prior_day_close`, `prior_day_open` → **neutral**

Use `MarkerService.classify(markerList, currentPrice)` to get nearest support and resistance.

## Test Coverage

- **128 tests** across all modules
- Unit tests for every strategy state transition
- Integration tests for full backtest pipeline
- Edge cases for buffer boundaries, reverse crossings, trailing stops
