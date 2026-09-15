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

### Phase 1.2: Multi-Timeframe Validation 🔄
- [ ] Run full timeframe comparison (5s through 15min)
- [ ] Identify optimal aggregation timeframe for signal detection
- [ ] Determine if 1-second execution precision improves results
- [ ] Score each timeframe against 8 metrics:
  - Win rate, Net P&L, Profit factor, Avg win/loss ratio
  - Breakeven count, Hard stop count, Trailing stop count, Avg hold time

### Phase 1.3: Multi-Timeframe Strategy
- [ ] Implement multi-bar-size strategy engine
- [ ] Aggregated bars for cross/retest detection
- [ ] Raw bars for entry precision and stop execution
- [ ] Cross-confirmation logic for seconds-level data

### Phase 1.4: Parameter Optimization
- [ ] Per-symbol buffer optimization
- [ ] Per-symbol hard stop optimization
- [ ] Entry window optimization (is 9:30-9:45 optimal?)
- [ ] Risk mode calibration (high/mid/low = what N?)
- [ ] Trailing stop step optimization

**Stage 1 Exit Criteria:**
- Strategy is profitable on all 3 test symbols with real data
- Profit factor > 1.3 consistently
- Maximum drawdown < 5% of starting capital
- Strategy passes out-of-sample validation on a different month

---

## Stage 2: Live Signal Generation
**Goal:** Real-time signals, paper trading, daily market analysis.

### Phase 2.1: Real-Time Data Pipeline
- [ ] Massive WebSocket connection for live data
- [ ] Real-time marker computation
- [ ] Sniper mode real-time signal generation
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
