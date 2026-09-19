# News + Strategy Unit Brief

## Purpose

This unit combines news context and strategy backtesting into one handoff stream.

The goal is to offload heavy data work from the main development loop:

- pull real Massive data
- archive raw inputs
- run repeatable backtests
- summarize the result for review
- generate a UI-ready news feed object

The unit does not tune production code directly. It produces evidence and clean summaries so the core TradeSniper work can focus on fine tuning.

## Current Focus

Primary news-opening candidates:

1. MSFT
2. TSLA

Supporting roles:

- AAPL: daily service-mode staple / stability challenger
- NVDA: wave/rider research candidate only

Candidate selection source:

- `newsOpening/CANDIDATE_SELECTION.md`
- `newsOpening/CULTURE_NOTES.md`

## Event Calendar Scope

Prioritize scheduled macro/news events that traders commonly watch:

- CPI
- FOMC statement / FOMC press conference days
- Jobs report / NFP, usually first Friday
- PPI or retail sales when CPI/FOMC/NFP coverage is thin

Do not assume every first Friday is equivalent to NFP unless the event calendar confirms it.

## Data Requirements

Use real Massive data only.

For each event date and symbol:

- archive raw second bars when available
- archive minute bars as fallback and comparison
- archive news articles and sentiment metadata
- archive market status and ticker metadata when relevant
- preserve request parameters in `manifest.json`

Recommended opening windows:

- `09:28:00-09:30:00 ET`: pre-open context if available
- `09:30:00-09:35:00 ET`: news/opening impulse study
- `09:30:00-10:00:00 ET`: sniper and early continuation study

## Backtest Structure

Run the written strategy without visual overrides.

Minimum comparison set:

- MSFT only
- TSLA only
- MSFT + TSLA combined
- AAPL as service reserve benchmark
- NVDA only when testing wave/rider behavior

Required metrics:

- sessions tested
- trades taken
- skipped / no-retest count
- wins
- losses
- breakeven
- win rate
- net PnL
- total PnL %
- average PnL %
- average win
- average loss
- profit factor
- max drawdown
- hard-stop count
- runner count
- exit reason distribution
- best and worst session

Required interpretation:

- Was the trade aligned with the news/context bias?
- Did the symbol obey the written strategy?
- Did it require looser or stricter confirmation?
- Was the move sniper-like, wave-like, or untradeable?
- Did the loss come from wrong direction, weak retest, poor exit, or oversized stop?

## Bias Handling

News/context is allowed to describe bias, but not create a trade signal.

For research, produce two views:

1. **Control:** written strategy only.
2. **Context overlay:** same trades annotated by macro/news bias.

The overlay can answer:

- did context improve direction selection?
- did context identify no-trade days?
- did context justify looser/tighter confirmation?

The overlay must not erase the control result.

## Output Folder Standard

Use this structure:

```text
agent/news-strategy-unit/massive/YYYY-MM-DD/
  manifest.json
  raw-news.json
  news-digest.json
  raw-bars/
    MSFT-second.json
    MSFT-minute.json
    TSLA-second.json
    TSLA-minute.json
  backtest-control.json
  backtest-context-overlay.json
  ui-news-feed.json
  REPORT.md
```

If the run covers multiple event dates, use:

```text
agent/news-strategy-unit/massive/batch-YYYY-MM-DD_YYYY-MM-DD/
```

## Report Standard

Every report must include:

- event name and date
- symbols tested
- data source and bar resolution
- backtest config
- summary table
- per-symbol findings
- candidate ranking
- failure diagnosis
- UI feed summary
- raw file references
- limitations

## Script Standard

Use the repo's existing Node script pattern and naming conventions.

Reference:

- `agent/news-strategy-unit/SCRIPT_CONVENTIONS.md`

Do not add scripts with vague or date-specific names. Dates, symbols, and event types belong in CLI flags and output folders.

## Hard Rules

- No synthetic data.
- No symbol/date hard-coding.
- No visual override in the backtest result.
- No "buy/sell" recommendation from news alone.
- Preserve raw data before derived summaries.
- Clearly separate control results from context-overlay results.
- Mark insufficient sample size instead of overstating confidence.
