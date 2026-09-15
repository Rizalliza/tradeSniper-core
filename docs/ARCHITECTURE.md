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
