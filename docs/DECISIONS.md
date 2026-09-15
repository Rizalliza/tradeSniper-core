# TradeSniper Design Decisions

A log of all key decisions and their rationale. When in doubt, check this file.

---

## D001: Hard Stop Enabled by Default (2026-09-15)

**Decision:** Set default `hardStopPct` to 0.008 (0.8%).

**Rationale:**
- Without a hard stop, trending markets cause catastrophic losses (TSLA: 0% win rate, -$14k in test data)
- The reverse-stop approach only works in ranging/choppy markets where price oscillates around entry
- In strong trends, price crosses the entry level once and never comes back — stop never fires
- 0.8% is a reasonable default that caps losses while giving trades room to work

**Impact:**
- Synthetic test data: 92% loss reduction
- Real data: strategy remains profitable (PF 1.56)
- Win rate decreases slightly, but risk is dramatically reduced

**Reconsider if:** We find per-symbol optimal values through parameter optimization

---

## D002: Breakeven = Separate Outcome Category (2026-09-15)

**Decision:** $0 PnL trades count as BREAKEVEN, not WON.

**Rationale:**
- Counting breakeven as WON inflates win rate and gives false confidence
- A trade that nets $0 is neither a win nor a loss — it's a scratch
- Win rate should measure profitable trades / total (win + loss)
- Breakeven count is a useful metric on its own (indicates how often stop catches at entry)

**Impact:**
- Honest win rate: 61% → 54.3% (real data)
- Net P&L unchanged
- More accurate performance reporting

**Reconsider if:** Never — this is accounting correctness.

---

## D003: Real Data Only — No Synthetics (2026-09-15)

**Decision:** All validation and strategy tuning uses real Massive.com data only.

**Rationale:**
- Synthetic data uses Math.random and gives inconsistent results
- The test CSV data showed TSLA at 0% win rate; real data shows 46.7% — huge discrepancy
- Synthetic data can mislead us into optimizing for patterns that don't exist in real markets
- "Tests pass with synthetic data but fail live" is exactly the problem we've seen before

**Impact:**
- Slightly slower iteration (API calls vs instant)
- Much more reliable results
- Need to manage Massive API costs

**Reconsider if:** We add proper seeded synthetic data for unit testing only (not strategy validation)

---

## D004: Multi-Timeframe Approach for Seconds Data (2026-09-15)

**Decision:** Use aggregated bars (15s target) for signal detection, raw seconds bars for execution.

**Rationale:**
- Raw 1-second bars are too noisy — cross/retest fires too early, exits at breakeven
- Aggregating to 10-30 second bars reduces noise and gives cleaner signals
- Using raw seconds for entry/stop execution maintains precision where it matters
- This is standard practice in professional trading systems

**Status:** Hypothesis — needs validation via timeframe comparison

**Reconsider if:** Comparison shows a different timeframe is better

---

## D005: Develop Branch Workflow (2026-09-15)

**Decision:** All code changes go to `develop` branch first. Merge to `main` only after verification.

**Rationale:**
- Main should always be the known-good baseline
- Develop is the working branch for iterative improvements
- Each milestone is a PR-worthy change set
- Mirrors standard software engineering practice

**Process:**
1. Work on `develop`
2. Verify with tests + real data backtest
3. Review results
4. Merge to `main` when milestone is complete and verified

---

## D006: Pre-Push Verification Checklist (2026-09-15)

**Decision:** Every push must pass a verification checklist.

**Checklist:**
1. All 149+ tests pass (`npm test`)
2. Webapp starts and serves all assets (`npm start`)
3. Backtest runs without errors (with real data when appropriate)
4. Change scope is focused — no unrelated modifications
5. Documentation updated if behavior changed
6. This file updated if a new decision was made

---

## D007: Clock-Based Bar Aggregation (2026-09-15)

**Decision:** Use clock-aligned bucketing for bar aggregation (periodSeconds + barType).

**Rationale:**
- Bar-count chunking ("every N bars") produces different boundaries depending on data gaps
- Clock-aligned buckets (09:30:00–09:30:04 = 5s bar 0) are deterministic and reproducible
- Matches how real trading platforms display multi-timeframe data
- Per-date aggregation — never blends bars across day boundaries (overnight gap handling)

**Implementation:** `BarLoader.aggregate(bars, periodSeconds, barType)` — groups by `Math.floor(secondsSince930 / periodSeconds)`

**Validation:** 1m bars built from seconds match native 1-minute bars exactly.

---

## D008: Memory-Efficient Streaming Backtest (2026-09-15)

**Decision:** Process data in monthly chunks, accumulating stats without holding all bars in memory.

**Rationale:**
- 7 months of NVDA second bars = ~4M+ bars, too large for Node's default heap (4GB RAM machine)
- Strategy processes days independently — no need to hold all data at once
- Monthly chunks fit easily in memory (~500K bars/month = ~80MB)
- Pagination rounds increased from 10 to 20 to handle high-volume symbols like NVDA

**Implementation:** timeframeCompare.js fetches one month at a time, runs all timeframes, accumulates per-timeframe stats, then frees the bars before moving to next month.

**Impact:** Peak RAM ~700MB instead of 2.6GB+ (OOM). Can handle any date range length.

---

## D009: Per-Symbol Timeframe Optimization Required (2026-09-15)

**Status:** Preliminary finding from AAPL + TSLA data

**Observation:**
- AAPL: optimal at 10–15s (66.7% WR, PF 1.55–1.72), 1m bars lose money
- TSLA: best WR at 15s (61.4%), but best P&L at 5m (+$5,657, PF 1.89)
- Different symbols have different optimal timeframes due to volatility characteristics

**Implication:** M5 (per-symbol parameter optimization) must include timeframe selection, not just buffer/stop levels.

**Reconsider when:** Full 3-symbol results are in

