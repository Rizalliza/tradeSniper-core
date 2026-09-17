# TradeSniper Roadmap

Staged approach to building the full trading system. Each stage must be verified
working before moving to the next.

---

## Stage 1: Foundation & Strategy Validation
**Goal:** Prove the strategy works reliably with real data. Fix all critical bugs.

### Phase 1.1: Bug Fixes & Hardening ✅
- [x] Enable hard stop by default
- [x] Fix outcome accuracy (breakeven split)
- [x] Fix test coverage (all 149 tests run)
- [x] Align web UI defaults with strategy defaults
- [x] Add CLI flags for backtest parameters
- [x] Create documentation and decision log

### Phase 1.2: Opening Microstructure Research 🔄
- [x] Add first-two-minute visual levels to Flow Study (F2-H/F2-M/F2-L)
- [x] Split opening visualization into 2s first-window candles and 1m validation candles
- [x] Build normalized `MarketEvent` schema for trades and quotes
- [x] Build JSONL `TapeRecorder` foundation for normalized events
- [x] Build `MarketReplay` foundation so event sources feed the exact same engine
- [x] Build `OpeningMicrostructureState` foundation for F2-H/M/L/VWAP/range/high-time/low-time
- [x] Add bar-level `openingMicrostructureProbe` to test F2 acceptance/failure without WebSocket
- [ ] Wire `TapeRecorder` to Massive WebSocket trades/NBBO
- [ ] Add historical tape loading/downloading path
- [ ] Build `LevelInteractionEngine` for touch/cross/reject/reclaim/accept states
- [ ] Build `PathStudy` output for forward return, MFE, and MAE after every interaction
- [ ] Prove whether F2 interactions have distinct forward path distributions versus baselines

### Phase 1.3: Multi-Timeframe Validation
- [ ] Run full timeframe comparison (1s, 2s, 5s, 10s, 15s, 30s, 60s)
- [ ] Determine whether event-level ordering adds edge beyond 1s or 2s bars
- [ ] Identify per-symbol useful aggregation levels for visualization and summary
- [ ] Compare retest zones:
  - percentage zones: ±0.05%, ±0.10%, ±0.15%, ±0.20%
  - ATR zones: 0.10, 0.15, 0.20, 0.25 ATR
- [ ] Score event paths, not only trades:
  - forward return, MFE, MAE, time above/below/inside zone
  - volume above/below/inside zone
  - spread and quote behavior at touch/reclaim/rejection

### Phase 1.4: Sniper V2 Context Integration
- [ ] Modify Sniper to consume OpeningMicrostructure and LevelInteraction state
- [ ] Block bullish entries after failed F2-H / lost F2-M conditions
- [ ] Block bearish entries after swept F2-L / reclaimed F2-M conditions
- [ ] Use raw/event replay for entry and stop ordering where available
- [ ] Keep bar-based fallback for historical periods without tape data

### Phase 1.5: Parameter Optimization
- [ ] Per-symbol buffer optimization
- [ ] Per-symbol hard stop optimization
- [ ] Entry window optimization (is 9:30-9:45 optimal?)
- [ ] Risk mode calibration (high/mid/low = what N?)
- [ ] Trailing stop step optimization

**Stage 1 Exit Criteria:**
- F2/level interactions are mechanically detected and auditable in Flow Study
- Historical replay and live data share the same event-processing interface
- F2 interaction paths show useful separation from baselines after costs
- Sniper V2 improves wrong-side-entry filtering without curve-fitting one month
- Strategy passes out-of-sample validation on a different month and symbol basket

---

## Stage 2: Live Signal Generation
**Goal:** Real-time signals, paper trading, daily market analysis.

### Phase 2.1: Real-Time Data Pipeline
- [ ] Massive WebSocket connection for active-universe trades and NBBO quotes
- [ ] Real-time marker computation
- [ ] Live shadow signals without orders
- [ ] Sniper mode real-time signal generation from MarketState
- [ ] Signal alerting (webhook / email / telegram)

### Phase 2.2: Research & News Integration
- [ ] Pre-market briefing (news + sentiment for watchlist)
- [ ] Earnings calendar skip rules
- [ ] FOMC / macro event skip rules
- [ ] VIX regime adaptation
- [ ] Watchlist ranking based on news/context

### Phase 2.3: Paper Trading
- [ ] Virtual portfolio tracking
- [ ] Position management
- [ ] Trade journal with performance tracking
- [ ] Daily P&L and equity curve

### Phase 2.4: Watchlist Expansion
- [ ] Add more US large-cap stocks
- [ ] Add forex/gold symbols (as you specialize)
- [ ] Per-symbol strategy configuration

---

## Stage 3: Production & Subscription-Ready
**Goal:** Industrial-grade product for paying subscribers.

### Phase 3.1: Multi-Tenant Architecture
- [ ] User accounts and authentication
- [ ] Per-user watchlists and preferences
- [ ] Subscription management
- [ ] Usage tracking and billing

### Phase 3.2: Advanced Analytics
- [ ] BytePlus Data Intelligence integration
- [ ] Backtest at scale
- [ ] Performance dashboards
- [ ] Strategy comparison tools

### Phase 3.3: AI-Enhanced Decision Making
- [ ] BytePlus MLP integration
- [ ] ML-based pattern recognition
- [ ] Adaptive parameter tuning
- [ ] Market regime classification

### Phase 3.4: Professional Features
- [ ] API access for subscribers
- [ ] Custom indicator builder
- [ ] Strategy library
- [ ] Community / social features

---

## Technology Stack

| Layer | Technology | Status |
|---|---|---|
| Strategy Engine | JavaScript / Node.js | ✅ Exists |
| Frontend | Vanilla JS + SVG | ✅ Exists (Base44) |
| Market Data | Massive.com (Polygon) | ✅ Integrated |
| News & Sentiment | InfoQuest / Massive | ✅ Available |
| Cloud Environment | BytePlus Managed Agents | ✅ Set up |
| Code Agents | BytePlus Managed Agents | ✅ Code Builder v2 |
| Version Control | GitHub | ✅ tradeSniper-core |
| Data Analytics | BytePlus Data Intelligence | 🔜 Stage 3 |
| ML Platform | BytePlus MLP | 🔜 Stage 3 |
| Subscriptions | Base44 / custom | 🔜 Stage 3 |
