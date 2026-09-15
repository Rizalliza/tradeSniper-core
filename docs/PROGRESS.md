# TradeSniper Project Progress

## Current Phase: Stage 1 — Foundation & Hardening

**Status: In progress**
**Last updated: 2026-09-15**
**Current commit: develop branch (see latest commit)**

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
