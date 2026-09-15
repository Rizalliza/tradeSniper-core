# Strategy Decisions

> Record of all strategy findings, parameter choices, and design decisions. Every hypothesis validated (or rejected) goes here. Updated by Strategy Analyst and Code Builder.

## Core Strategy Design

### Sniper Strategy (Primary)
- **Pattern:** 3-phase marker-retest (Cross → Retest → Entry)
- **Markers:** 8 levels (monthly/weekly/daily high/low, prior close/open)
- **Buffer default:** 0.15% (configurable per symbol)
- **Entry window:** 09:30–09:45 ET (first 15 minutes)
- **Data granularity:** 1-second bars

### Exit Logic
- **Profit target:** next adjacent marker in trade direction
- **Reverse stop:** N reverse crossings of entry marker (default 3 for low risk)
- **Hard stop:** 0.8% default — NON-NEGOTIABLE (reverse stop alone fails in trends)
- **Breakeven stop:** Optional, moves stop to entry after configurable profit threshold
- **Trailing stop:** Activates when reverseStopCount reached but trade is profitable, tightens as forward markers are hit
- **EOD handling:** Profitable open trades → RUNNER, losing → EOD_UNFAVORABLE

## Key Findings

### Timeframe Optimization
- **1-second bars are too noisy** for opening signal detection
- **AAPL optimal:** 10s aggregation for signal detection
- **TSLA optimal:** 15s aggregation for signal detection
- **Each symbol needs different parameters** — one-size-fits-all doesn't work

### Risk & Position Sizing
- **Position size:** 1% of account per trade (default)
- **Max daily loss:** 3% of account
- **Max daily trades:** 5
- **Loss streak reduction:** halve position after 2+ consecutive losses
- **Win streak increase:** +20% after 3+ consecutive wins (capped at 2x)

### Market Context Adaptation (VIX Regime)
| VIX Level | Regime | Buffer Multiplier | Reverse Stop Multiplier |
|---|---|---|---|
| < 12 | EXTREME_LOW | 0.7x | 0.67x |
| 12-18 | LOW | 0.85x | 0.83x |
| 18-25 | NORMAL | 1.0x | 1.0x |
| 25-35 | HIGH | 1.5x | 1.33x |
| > 35 | EXTREME | 2.0x | 1.67x |

### Skip Rules
- **FOMC days:** skip all trades
- **Earnings within 2 days:** skip that symbol
- **Configurable per symbol:** yes

### News & Sentiment
- **News NEVER generates signals** — only adjusts risk parameters
- **Maximum news influence:** 35% (position sizing multiplier only)
- **Confidence multiplier range:** 0.7 – 1.3
- **Price action is always first**

## Per-Symbol Parameter Table (WIP)

| Symbol | Optimal Buffer | Optimal Aggregation | Reverse Stops | Notes |
|---|---|---|---|---|
| AAPL | TBD | 10s | TBD | — |
| TSLA | TBD | 15s | TBD | — |
| NVDA | TBD | TBD | TBD | Needs analysis |

## Open Hypotheses

1. Does the pattern detector improve signal quality when combined with marker-retest?
2. Does order flow analysis add alpha or just confirm what's already visible?
3. Are Breakout and MeanReversion strategies complementary to Sniper, or redundant?
4. Can sentiment data improve risk-adjusted returns when used only for position sizing?

## Rejected Ideas

_(none recorded yet — add negative results here)_

## Testing Standards

- **Unit tests:** Every strategy state transition must have unit tests
- **Integration tests:** Full backtest pipeline must pass
- **Edge cases:** Buffer boundaries, reverse crossings, trailing stops
- **Real data validation:** Strategy changes must be validated with real data backtests before merging
