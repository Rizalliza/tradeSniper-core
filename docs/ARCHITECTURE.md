# System Architecture

## Current Architecture (Stage 1)

```
┌─────────────────────────────────────────────────────────┐
│                    Web UI (Base44)                      │
│  Command Deck / Sniper / Backtest / Flow Study / etc.  │
└──────────────────────┬──────────────────────────────────┘
                       │
        ┌──────────────┴──────────────┐
        │                             │
┌───────▼────────┐          ┌────────▼─────────┐
│  Strategy Engine │         │  Market Data      │
│  (Node.js)       │         │  (Massive.com)    │
│  - SniperStrategy│         │  - REST API       │
│  - MarkerService │         │  - S3 flat files  │
│  - BacktestRunner│         │  - WebSocket      │
│  - RiskManager   │         └──────────────────┘
│  - MarketContext │
└──────────────────┘
```

## Target Architecture (Stage 2+ — MultiAgent)

```
                        ┌──────────────────────┐
                        │   Coordinator Agent   │
                        │   (MultiAgent)        │
                        │   - Task planning     │
                        │   - Progress tracking │
                        │   - Quality control   │
                        └──────────┬───────────┘
           ┌───────────────────────┼───────────────────────┐
           │                       │                       │
  ┌────────▼───────┐    ┌─────────▼────────┐    ┌─────────▼────────┐
  │  Code Builder   │    │  Strategy Analyst │    │  Research Agent   │
  │  Agent          │    │  Agent            │    │                   │
  │  - Bug fixes    │    │  - Backtests      │    │  - News & sentiment│
  │  - Features     │    │  - Optimization    │    │  - Watchlist rank │
  │  - Testing      │    │  - Parameter tune │    │  - Market context │
  │  - Git commits  │    │  - Reporting      │    │  - Earnings/FOMC  │
  └─────────────────┘    └──────────────────┘    └──────────────────┘
           │
  ┌────────▼─────────┐
  │  Deploy / Ops    │
  │  Agent           │
  │  - Environments  │
  │  - Deployments   │
  │  - Monitoring    │
  └──────────────────┘
```

## Data Flow

```
Market Data (Massive)
    │
    ▼
BarLoader (CSV / API / S3)
    │
    ├─── Raw bars (1s / 1m / 1d)
    │
    ├─── Aggregated bars (5s / 15s / 30s / 5m)
    │
    ▼
MarkerService
    │
    ├─── 8 marker levels (daily/weekly/monthly + prior OHLC)
    ├─── Support / resistance classification
    └─── Next/prev marker lookup
         │
         ▼
    SniperStrategy
         │
         ├─── Phase 1: Cross detection
         ├─── Phase 2: Retest detection  
         ├─── Phase 3: Entry execution
         └─── Trade management (stop, target, trailing)
              │
              ▼
         BacktestStats / RiskManager
              │
              ▼
         Web UI / Reports
```

## Target Research Core (Opening Microstructure)

The next architecture step is event-driven research, not a larger UI or direct
broker execution. The first two minutes after the U.S. open are treated as a
price-discovery event that creates reference levels to be tested statistically.

```
EventSource
  │
  ├── HistoricalReplay
  └── LiveWebSocket
        │
        ▼
Normalized MarketEvent
        │
        ├── TapeRecorder          raw trades/quotes, timestamps, sequence ids
        ├── BarBuilder            1s/2s/5s/minute bars for visualization
        ├── OpeningMicrostructure F2-H/M/L/VWAP/range/order of high/low
        ├── LevelInteraction      touch/cross/reject/reclaim/accept states
        └── PathStudy             MFE/MAE/forward returns after each event
        │
        ▼
MarketState
        │
        ▼
SniperStrategy
        │
        ├── Research decisions
        └── Future paper/live execution
```

### Core Rule

Live and historical data must use the same engine:

```
engine.process(event)
```

The strategy should not know whether an event came from a recorded tape or from
a live WebSocket. This prevents a split-brain system where backtests and live
signals behave differently.

### Normalized Events

Everything downstream should consume normalized events:

```js
{
  type: 'TRADE',
  symbol: 'AAPL',
  exchangeTs: 0,
  sipTs: 0,
  receiveTs: 0,
  sequence: 0,
  price: 329.93,
  size: 100,
  exchange: 'XNAS',
  conditions: []
}
```

```js
{
  type: 'QUOTE',
  symbol: 'AAPL',
  exchangeTs: 0,
  sipTs: 0,
  receiveTs: 0,
  sequence: 0,
  bid: 329.92,
  bidSize: 400,
  ask: 329.94,
  askSize: 300
}
```

### Opening Map

OpeningMicrostructure must construct and persist, at minimum:

- F2 high, midpoint, low
- F2 open, close, VWAP, volume
- F2 range, range percentage, range versus ATR
- close position inside the F2 range
- high timestamp and low timestamp
- first direction: low-to-high or high-to-low
- premarket high/low and legacy daily/weekly/monthly levels for confluence

The current Flow Study can draw F2-H/M/L, but it does not yet know acceptance,
rejection, reclaim, sweep, or event ordering.

### Sniper Position In The Stack

Sniper should sit downstream of market intelligence. It should consume evidence
from OpeningMicrostructure and LevelInteraction instead of trying to infer all
market state from OHLC bars.

## Risk Management Layers

1. **Position sizing** — Risk % of account per trade (default 1%)
2. **Daily loss limit** — 3% max daily loss
3. **Daily trade cap** — Max 5 trades per day
4. **Reverse stop** — N reverse crossings of entry marker
5. **Hard stop** — Fixed % loss cap (0.8% default)
6. **Trailing stop** — Locks in profits when reversing
7. **Market context skip** — Skip FOMC days, earnings within 48h
8. **Streak adjustment** — Halve position after 2+ losses

## Coding Standards

- All tests must pass before commit (149+ tests)
- No synthetic data for strategy validation (real data only)
- Minimal, focused commits — one change per commit
- Conventional commit messages: fix:, feat:, refactor:, test:, docs:
- Develop branch for work, main for verified releases
- Every milestone has a verification checklist
