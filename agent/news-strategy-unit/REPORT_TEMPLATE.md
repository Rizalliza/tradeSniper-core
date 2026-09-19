# News + Strategy Report

Date: `YYYY-MM-DD`
Event: `CPI | FOMC | NFP | PPI | Retail Sales | Other`
Symbols: `MSFT, TSLA`
Data source: `Massive`
Run folder: `agent/news-strategy-unit/massive/YYYY-MM-DD`

## Executive Summary

One short paragraph explaining whether MSFT + TSLA adapted well to the written strategy on this event set.

## Inputs

| Item | Value |
| --- | --- |
| Bar resolution | `second / minute / both` |
| Opening window | `09:30:00-10:00:00 ET` |
| News lookback | `N days / intraday only` |
| Strategy config | `link or JSON filename` |
| Control backtest | `backtest-control.json` |
| Context overlay | `backtest-context-overlay.json` |
| UI feed | `ui-news-feed.json` |

## Candidate Ranking

| Rank | Symbol | Role | Trades | Win Rate | Net PnL | Total PnL % | Hard Stops | Runners | Verdict |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | MSFT | News-opening candidate | 0 | 0.00% | $0.00 | 0.0000% | 0 | 0 | TBD |
| 2 | TSLA | News-opening candidate | 0 | 0.00% | $0.00 | 0.0000% | 0 | 0 | TBD |

## News Context

| Symbol | Bias | Confidence | Topics | Risk Notes |
| --- | --- | ---: | --- | --- |
| MSFT | `UNKNOWN` | 0.00 |  |  |
| TSLA | `UNKNOWN` | 0.00 |  |  |

News is context only. It must not generate trades without price-action confirmation.

## Strategy Results

### Control Result

Written strategy only. No news veto, no visual override.

| Symbol | Sessions | Trades | Wins | Losses | Breakeven | No Retest | Win Rate | Net PnL | Profit Factor | Max Drawdown |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| MSFT | 0 | 0 | 0 | 0 | 0 | 0 | 0.00% | $0.00 | 0.00 | $0.00 |
| TSLA | 0 | 0 | 0 | 0 | 0 | 0 | 0.00% | $0.00 | 0.00 | $0.00 |

### Context Overlay

Same trades, annotated by news/macro bias.

| Symbol | Aligned Trades | Against-Bias Trades | Aligned Win Rate | Against-Bias Win Rate | Bias Helped? |
| --- | ---: | ---: | ---: | ---: | --- |
| MSFT | 0 | 0 | N/A | N/A | INCONCLUSIVE |
| TSLA | 0 | 0 | N/A | N/A | INCONCLUSIVE |

## Failure Diagnosis

For every loss or major missed opportunity, classify the primary reason:

- wrong direction
- weak retest
- forced retest
- late entry
- exit too early
- exit too late
- stop too wide
- stop too tight
- no clean price-action confirmation

## UI News Feed Summary

This section should match `ui-news-feed.json`.

| Symbol | UI Status | Badge | Summary | Review Priority |
| --- | --- | --- | --- | --- |
| MSFT | `WATCH` | Candidate |  | HIGH |
| TSLA | `WATCH` | Candidate |  | HIGH |

## Files Produced

- `manifest.json`
- `raw-news.json`
- `news-digest.json`
- `backtest-control.json`
- `backtest-context-overlay.json`
- `ui-news-feed.json`
- raw bar files under `raw-bars/`

## Limitations

List missing data, delayed feed issues, insufficient sample size, event-calendar uncertainty, or resolution mismatch.

## Next Actions

Specific follow-up tasks for the main TradeSniper loop.
