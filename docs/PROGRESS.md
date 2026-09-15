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

### 🔄 Milestone 3b: Multi-Timeframe Analysis
- **Status:** In progress — script rewritten, ready for full run
- **Goal:** Find optimal bar timeframe for signal detection
- **Hypothesis:** 1-second bars are too noisy; 15-second aggregation is the sweet spot
- **Approach:**
  - `BarLoader.aggregate()` — rewritten with clock-based bucketing
  - `scripts/timeframeCompare.js` — rewritten with proper per-date aggregation
  - Compare: 5s, 10s, 15s, 30s, 1m (from secs), 1m_native, 5m, 15m
  - Score across: win rate, net P&L, profit factor, avg win/loss, breakeven count, hard stop count, trailing stop count
- **Bugs fixed before full run:**
  1. ✅ Clock-based aggregation (not bar-count chunking)
  2. ✅ No day-boundary blending — aggregate per date
  3. ✅ 5min/15min properly aggregated from minute bars
  4. ✅ 1min built from seconds AND native minute bars as baseline
  5. ✅ BREAKEVEN excluded from taken count in all reporting
  6. ✅ Label typos fixed
- **Current status:** Script validated with 2-day smoke test. Ready for full month run
- **Next:** Run full comparison for all 3 symbols, entire month of Feb 2026

### ⬜ Milestone 4: Multi-Timeframe Strategy
- **Status:** Not started
- **Goal:** Use aggregated bars for signal detection, raw seconds bars for execution
- **Design:**
  - Signal phase (cross/retest): 15-second aggregated bars
  - Entry execution: switch to 1-second bars for precision entry
  - Stop management: use 1-second bars for accurate stop execution
  - This gives "detection stability + execution precision"

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
