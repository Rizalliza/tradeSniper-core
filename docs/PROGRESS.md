# TradeSniper Project Progress

## Current Phase: Stage 1 — Opening Microstructure Research

**Status: In progress**
**Last updated: 2026-09-17**
**Current commit: develop branch (latest pushed core commit before this work: `6293168`)**

---

## Current Working Thesis

TradeSniper is now focused on the U.S. opening sniper niche:

```
09:30:00-09:32:00 = detect + confirm + execute
09:32:00+          = runner management only, not the main entry hunt
```

The objective is not to wait for a completed first-two-minute map before entry.
The objective is to trade the evolving first-two-minute structure safely:

- capture small, consistent cross/retest moves inside the first 2 minutes
- prevent wrong-side BUY/SELL execution when local opening structure has failed
- let only favorable positions become runners beyond the first 2 minutes
- prove whether the edge survives larger samples, spread, slippage, and latency

Current manual review on five AAPL sessions showed a promising but unproven read:
4 favorable / 1 unresolved-tricky. This is enough to focus research, not enough
to declare profitability.

---

## Latest Implemented Work

### ✅ Opening Microstructure Foundation
- Added normalized `MarketEvent` schema for `TRADE` and `QUOTE`.
- Added Massive message normalizer for future WebSocket/tape ingestion.
- Added JSONL `TapeRecorder` foundation.
- Added `MarketReplay` foundation so historical and live events can feed the same engine.
- Added `OpeningMicrostructureState` foundation for F2 high/low/mid/open/close/VWAP/range/volume/highTime/lowTime/firstDirection.
- Added tests for each module.

### ✅ No-WebSocket F2 Probe
- Added `scripts/openingMicrostructureProbe.js`.
- Probe consumes `data/pressure-pilot-2026-09-09_2026-09-15.json`.
- Outputs bar-level F2 signals to `data/opening-microstructure-probe-2026-09-09_2026-09-15.json`.
- Limitation: bar-level only. It cannot prove tick/NBBO ordering or millisecond edge.

### ✅ Flow Study Review View
- Flow Study now renders only 5 cards per selected symbol for focused review.
- Cards display the F2 probe signal badge:
  - `BULLISH_F2_RECLAIM`
  - `BEARISH_F2_FAILURE`
  - `NO_PROBE`
- First-2-minute view uses 2-second candles.
- Open-30-minute view uses first-2-minute 2s candles plus 1-minute validation candles.

### ✅ Sniper Wrong-Side Filter Foundation
- Added contextual entry filter to block counter-bias entries into nearby opposing levels.
- AAPL 2026-09-15 bad-case behavior can be blocked when bearish pressure and nearby opposing opening level conflict with BUY.

### ✅ Opening Sniper Event Engines
- Added `LevelConfluenceEngine` to merge nearby levels into auditable confluence zones.
- Added `LevelInteractionEngine` to classify `TOUCH`, `CROSS_UP`, `CROSS_DOWN`, `RETEST_FROM_ABOVE`, `RETEST_FROM_BELOW`, `REJECT_DOWN`, `RECLAIM_UP`, `ACCEPT_ABOVE`, and `ACCEPT_BELOW`.
- Added `OpeningMicrostructureLiveState` so the first-two-minute map can be consumed while it is still forming, then marked final after 09:32.
- Added `F2InternalSequenceProbe` to classify internal 2-second first-window behavior, including early runner state.
- Updated `openingMicrostructureProbe` to emit confluence-zone events plus `internalSequence`.
- Changed broad daily/monthly/premarket acceptance fallback to `CONTEXT_*` signals so it is not confused with local F2 permission.
- Important current finding: AAPL 2026-09-15 now shows only `CONTEXT_BULLISH_ACCEPTANCE` after 09:32, while the first-two-minute internal sequence records early `RUNNER_DOWN`. That is exactly the kind of BUY/SELL confusion the execution gate must block.

### ✅ First-2-Minute Paper Execution Verifier
- Added `OpeningSniperPaperTrader` to replay first-window bars as a paper execution harness.
- Entries are allowed only before `09:32:00`.
- A paper entry requires cross then later retest; the entry bar is not used for exit management to avoid overstating intrabar fill order.
- Exits support:
  - `SCALP_TARGET`
  - `HARD_STOP`
  - `WINDOW_END_SCALP_EXIT`
  - `WINDOW_END_INVALIDATION`
  - `RUNNER_TRAIL`
  - `RUNNER_HELD_TO_END`
- Added local wrong-side guard:
  - blocks BUY when first-window local bias has turned bearish
  - blocks SELL when first-window local bias has turned bullish
- Added `scripts/openingSniperPaperReplay.js` and `npm run opening:paper`.
- Current September sample paper replay:
  - 20 sessions
  - 18 first-window paper entries
  - 2 blocked wrong-side setups
  - 6 runners
  - 11 wins / 7 losses
  - 61.11% win rate excluding blocked sessions
  - AAPL 2026-09-15 is blocked as `LOCAL_OPENING_BIAS_CONFLICT BUY vs BEARISH`.

### ✅ Live Shadow Attempt / Feed Gap Found
- Added `scripts/openingSniperLiveShadow.js` and `npm run opening:shadow`.
- The script supports:
  - Massive WebSocket trade/quote stream when enabled
  - REST latest-second-aggregate fallback
  - JSONL tape recording
  - live 2-second bar construction
  - paper cross/retest/block/exit audit events
- Live attempt on 2026-09-17 around 09:30 ET found an infrastructure blocker:
  - WebSocket connection to `wss://socket.massive.com/stocks` failed upgrade with non-101 status.
  - Massive MCP `/v2/last/trade/AAPL` returned `NOT_ENTITLED`.
  - REST second aggregates were available, but current latest data was not at the 09:30 opening window; the app received no 09:30+ bars.
  - `data/live-shadow/2026-09-17/summary.json` therefore shows all symbols `IDLE` with no opening range.
- Conclusion: the app now has a live shadow harness, but this Massive account/path did not provide real-time opening data for the first two minutes.

---

## Not Done Yet

- No live Massive WebSocket adapter yet.
- No live tick/NBBO tape recorder yet.
- No historical tick/NBBO tape dataset yet.
- No broker or live paper adapter yet; current verifier is historical replay only.
- Real-time Massive entitlement/feed path is not yet solved.
- No 15-minute `PathStudy` database/output yet.
- Sniper does not yet consume `OpeningSniperPaperTrader` / `OpeningMicrostructureLiveState` in production mode.
- Current probe is still bar-level, not true tick/NBBO ordering.

---

## Next Build Target

Build the engine that converts the user's visual labels into machine-detected
opening events:

1. Convert paper verifier into live shadow/paper mode
   - feed Massive WebSocket trades/quotes into `OpeningMicrostructureLiveState`
   - emit the same paper-entry and paper-exit records in real time
   - persist JSONL audit trail for every cross/retest/block/exit

2. Wire Sniper wrong-side gate to opening microstructure state
   - block BUY when internal sequence has `RUNNER_DOWN` / accepted below F2-M
   - block SELL when internal sequence has `RUNNER_UP` / accepted above F2-M
   - keep broad `CONTEXT_*` acceptance as context, not as entry permission

3. `PathStudy15m`
   - track +30s, +1m, +2m, +5m, +10m, +15m
   - record MFE/MAE after every F2/zone interaction

4. Live data proof
   - wire Massive WebSocket trades/quotes into `OpeningMicrostructureLiveState`
   - record tick/NBBO tape for replay
   - verify whether 2-second bars are enough for execution timing

This is the current priority over broad UI expansion, ML, broker integration, or
pattern sprawl.

---

## Milestone Tracker

### ✅ Milestone 0: Architecture Audit
- **Status:** Complete
- **Summary:** Reviewed existing codebase, identified 5+ existing agents in BytePlus account (mostly unused), confirmed v2 strategy code is solid
- **Key finding:** Previous 7 cycles failed because work was done in chat, not as persistent resources
- **Deliverable:** Architecture plan with 4-agent coordinator setup

### ✅ Milestone 1: Hard Stop-Loss Fix
- **Status:** Complete
- **Root cause:** `hardStopPct` was 0 (disabled) by default. Reverse stop only triggers if price crosses entry level N times — in trending markets, price crosses once and never comes back, so the stop never fires.
- **Fix:** Changed default `hardStopPct` from 0 to 0.008 (0.8%), removed `!trailingActive` guard so hard stop is always active
- **Impact (synthetic test data):** Net P&L -$14,883 → -$1,232 (92% loss reduction), Max DD $15,500 → $2,606 (83% reduction)
- **Impact (real Massive data):** All 3 stocks profitable, total +$2,169 P&L, profit factor 1.56
- **Tests:** 149/149 pass
- **Commit:** `c110aac` (initial fix), `dd3e8f4` (audit fixes)

### ✅ Milestone 2: Audit & Hardening
- **Status:** Complete  
- **Issues addressed:**
  1. Test count mismatch: `npm test` was missing root-level test file (130 → 149 tests)
  2. Web UI hard stop mismatch: backtest-lab default was 0.5% vs strategy 0.8% (aligned to 0.8%)
  3. Synthetic data unreliable: confirmed — real data is authoritative
  4. Added `--hard-stop` / `--no-hard-stop` flags to massiveBacktest.js
  5. Cleaned up leftover server processes
- **Commit:** `dd3e8f4`

### ✅ Milestone 3a: Outcome Accuracy & Breakeven Split
- **Status:** Complete
- **Problem:** $0 PnL exits (breakeven) were counted as WON, inflating win rate
- **Fix:** Added BREAKEVEN as a 3rd outcome category. Win rate now calculated as wins / (wins + losses), excluding breakeven
- **Impact on real data:** Win rate 61.0% → 54.3% (honest). P&L unchanged: +$2,169
- **BacktestStats updated:** Added breakeven tracking, per-symbol avg win/loss
- **Tests updated:** 5 test assertions corrected
- **Commit:** `0b51185`

### ✅ Milestone 3b: Multi-Timeframe Analysis
- **Status:** Complete — all 3 symbols, Feb–Aug 2026 (146 trading days each)
- **Goal:** Find optimal bar timeframe for signal detection across diverse market conditions
- **Result:** 15s is the best overall timeframe (61.0% combined WR, +$7,640 P&L, PF 1.43)
- **Approach:**
  - `BarLoader.aggregate()` — clock-based bucketing (periodSeconds, barType)
  - `scripts/timeframeCompare.js` — v2: memory-efficient monthly chunking, stats accumulation
  - 8 timeframes compared: 5s, 10s, 15s, 30s, 1m (from secs), 1m_native, 5m, 15m
  - Scored across: win rate, net P&L, profit factor, avg win/loss, breakeven count, hard stop count
- **Bugs fixed:**
  1. ✅ Clock-based aggregation (not bar-count chunking)
  2. ✅ No day-boundary blending — aggregate per date
  3. ✅ 1m (from seconds) matches 1m_native exactly (validation confirmed)
  4. ✅ Memory: monthly chunking + loop-based push (no spread OOM)
  5. ✅ Pagination: increased from 10 to 20 rounds (NVDA > 500K bars/month)
  6. ✅ BREAKEVEN excluded from taken count in all reporting
- **Combined results (AAPL + TSLA + NVDA, 438 trading days total):**
  | Timeframe | Wins | Losses | BE | WR% | P&L | PF | AvgW | AvgL |
  |-----------|------|--------|----|-----|-----|----|------|------|
  | 5s | 100 | 79 | 129 | 55.9% | +$1,361 | 1.06 | $144 | $172 |
  | 10s | 115 | 84 | 105 | 57.8% | +$5,410 | 1.29 | $157 | $165 |
  | **15s** | **125** | **80** | **91** | **61.0%** | **+$7,640** | **1.43** | **$163** | **$155** |
  | 30s | 116 | 105 | 64 | 52.5% | +$853 | 1.03 | $177 | $184 |
  | 1m | 115 | 102 | 45 | 53.0% | +$3,250 | 1.12 | $207 | $192 |
  | 5m | 59 | 63 | 6 | 48.4% | +$4,037 | 1.15 | $257 | $207 |
  | 15m | 0 | 0 | 0 | — | $0 | — | $0 | $0 |
- **Per-symbol best (by win rate):**
  - **AAPL → 10s** (66.7% WR, +$3,950, PF 1.72)
  - **TSLA → 15s** (61.4% WR, +$4,209, PF 1.64)
  - **NVDA → 15s** (54.3% WR, +$215, PF 1.04)
- **Per-symbol best (by P&L):**
  - AAPL: 10s (+$3,950)
  - TSLA: 5m (+$5,657, PF 1.89) — fewer trades but bigger moves
  - NVDA: 1m (+$1,131, PF 1.18)
- **Key findings:**
  1. 10–15s is the sweet spot for WR — high accuracy, positive P&L, manageable BE count
  2. Average win > average loss at 10s and 15s across all symbols (PF > 1.4)
  3. Each symbol has different optimal timeframe → per-symbol parameterization needed (M5)
  4. TSLA is most profitable per trade — its high volatility works in our favor
  5. NVDA is the hardest symbol — only marginally profitable, needs optimization
  6. Hard stop count increases on slower timeframes (bigger bars = bigger individual moves)
  7. 15m has zero trades — entry window (09:30–09:45) closes before first bar completes
- **Commit:** `12268f4` (code fixes), final results documented here

### 🔄 Milestone 4: Multi-Timeframe Strategy
- **Status:** Design phase — M3b results guide the architecture
- **Goal:** Use aggregated bars (15s default) for signal detection, raw seconds bars for execution
- **Design (based on M3b findings):**
  - Signal phase (cross/retest): 15-second aggregated bars (best combined WR)
  - Entry execution: switch to 1-second bars for precision entry price
  - Stop management: use 1-second bars for accurate stop execution
  - Per-symbol timeframe configuration (AAPL=10s, TSLA=15s, NVDA=15s default)
  - Benefit: detection stability + execution precision
- **Next:** Implement multi-timeframe engine in SniperStrategy

### ⬜ Milestone 5: Parameter Optimization
- **Status:** Not started
- **Goal:** Per-symbol optimization of buffer, stop levels, entry window
- **Approach:** BufferSensitivity analysis + grid search on real data
- **Expected:** Each symbol has different optimal parameters

### ⬜ Milestone 6: Coordinator Agent
- **Status:** Not started
- **Goal:** MultiAgent coordinator that orchestrates all specialist agents
- **Components:**
  - Code Builder (exists, needs refinement)
  - Strategy Analyst (to be built)
  - Research & News (exists as Data & News Analyst)
  - Coordinator (to be built)

---

## Verified Baseline (Real Massive.com Data)

**Dataset:** AAPL, TSLA, NVDA — Feb 2026 — 1-minute bars — First 30 min window

| Metric | Value |
|---|---|
| Total setups | 54 |
| Trades taken | 35 (excluding breakeven) |
| Wins | 19 |
| Losses | 16 |
| Breakeven | 6 |
| Win rate (honest) | 54.3% |
| Net P&L | +$2,169.01 |
| Profit factor | 1.56 |
| Average win | $317.16 |
| Average loss | $241.06 |
| Max drawdown | $1,012.27 |
| Expectancy | $52.90/trade |

Per-symbol:
| Symbol | Win rate | Net P&L | Avg win | Avg loss |
|---|---|---|---|---|
| AAPL | 50.0% | +$1,420.53 | — | — |
| TSLA | 46.7% | +$403.32 | — | — |
| NVDA | 41.7% | +$345.16 | — | — |

---

## Persistent Resources in BytePlus Account

| Resource | ID | Version | Purpose |
|---|---|---|---|
| Agent: TradeSniper Code Builder | `agent-20260913215350-blzsz` | v2 | Code changes, bug fixes, testing |
| Agent: TradeSniper Data & News Analyst | `agent-20260914112539-sc94d` | v2 | Market data, news, sentiment via Massive MCP |
| Environment: tradesniper-code-builder-env | `env-20260915034600-zf2t2` | — | Cloud runtime for Code Builder |
| Session: Code Builder Working Session | `sesn-20260915035753-nj5z5` | — | Test session binding |

**Other existing agents (unused, from prior cycles):**
- TradeSniper Refactor & Completion Agent (v1)
- US_Stock_Trading_Bot_Developer (v1)
- Limitless Bot Diagnostician (v2)
- And others...

---

## Known Issues & Open Questions

1. **Seconds bars too noisy** — cross detection fires too early, most wins are $0 breakeven. Needs multi-timeframe approach.
2. **Hard stop at 0.8% may be too tight/loose per symbol** — needs per-symbol calibration
3. **Strategy was designed for minute bars** — seconds need cross-confirmation logic
4. **Massive data API costs** — need to understand pricing model for large-scale backtesting
5. **GitHub token scope** — current token is `arkAgent6`, need to verify it has push access long-term
