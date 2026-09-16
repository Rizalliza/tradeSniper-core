# Strategy Analyst Massive Handoff

Date: 2026-09-15
Symbols: AAPL, TSLA, NVDA
Data source: REAL_MASSIVE_REST
Signal bars: 15s aggregated from Massive second bars
Execution status: dry-run/backtest only
Evaluation scope: opening-period handoff, first 30 minutes of bars

| Symbol | Direction | Marker | Outcome | P&L | Exit |
|---|---|---|---|---:|---|
| AAPL | BUY | daily_low | LOST | $-63.00 | EOD_UNFAVORABLE |
| TSLA | BUY | prior_day_open | LOST | $-287.82 | HARD_STOP |
| NVDA | SELL | daily_high | LOST | $-49.00 | EOD_UNFAVORABLE |

Notes:
- News is context only. Price action remains primary.
- Raw 1s and 15s results are both in strategy-market.json.
- Opening bars are limited to the first 30 minutes for handoff size.
- If an exit reason says EOD_UNFAVORABLE/RUNNER here, read it as end-of-export-window, not full market close.
