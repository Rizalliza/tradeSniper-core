# Candidate Selection

## Rule

Symbol candidates must be selected from written-strategy backtest results first.
Visual readability and culture notes can explain what to study next, but they do not choose capital allocation by themselves.

This keeps the work concentrated. A $10,000 service account does not need equal exposure across every watched symbol. If one symbol is the cleanest fit for the written strategy, the correct next study can be one-symbol concentration. If two symbols prove durable, allocation can become a two-symbol split.

## Current Evidence

### First-Friday / News-Opening Confirmed-Stop Run

Source: `data/first-friday-minute-confirmed-stop-2026-01-01_2026-09-19.json`

This is the cleanest current evidence for the news-opening basket because all four symbols are tested with the same written strategy.

| Symbol | Taken | Wins | Losses | Breakeven | Win Rate | PnL |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| MSFT | 3 | 3 | 0 | 2 | 100.00% | +$1,422.50 |
| TSLA | 5 | 3 | 2 | 0 | 60.00% | +$725.82 |
| NVDA | 5 | 3 | 2 | 1 | 60.00% | +$198.94 |
| AAPL | 4 | 3 | 1 | 1 | 75.00% | -$53.50 |

Current first-Friday candidate pair: **MSFT + TSLA**.

Reason: They are the top two by net PnL under the same written strategy. MSFT has the cleanest win/loss profile in this sample. TSLA has drawdown risk, but the written strategy still produced the second-best net result.

### September Opening Immediate Study

Source: `data/opening-wait-confirmed-exit-study-2026-09-01_2026-09-15.json`

This is not news-only, but it checks whether the same symbols remain readable in the shorter opening research set.

| Symbol | Filled | Wins | Losses | No Retest | Win Rate | Total PnL % | Runners |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TSLA | 9 | 9 | 0 | 1 | 100.00% | +2.0976% | 5 |
| MSFT | 10 | 7 | 3 | 0 | 70.00% | +1.2459% | 3 |
| AAPL | 9 | 8 | 1 | 1 | 88.89% | +0.7124% | 1 |
| NVDA | 10 | 7 | 3 | 0 | 70.00% | +0.5547% | 1 |

This supports keeping **TSLA + MSFT** as the immediate news/opening candidate pair.

### Marker-Validated September Study

Source: `data/opening-wait-marker-validated-study-2026-09-01_2026-09-15.json`

This stricter run reduces forced retests. It produces fewer trades, so it should not be treated as final ranking yet, but it helps measure quality when we demand cleaner marker validation.

| Symbol | Filled | Wins | Losses | No Retest | Win Rate | Total PnL % | Runners |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TSLA | 3 | 3 | 0 | 7 | 100.00% | +0.8012% | 2 |
| AAPL | 3 | 3 | 0 | 7 | 100.00% | +0.7051% | 1 |
| NVDA | 1 | 1 | 0 | 9 | 100.00% | +0.2014% | 1 |
| MSFT | 1 | 1 | 0 | 9 | 100.00% | +0.1000% | 0 |

This says the stricter filter is promising, but sample size is too small for final ranking. It does not override the first-Friday candidate pair.

### Broader April Confirmed-Stop Run

Source: `data/latest-massive-backtest.json`

This file is currently untracked, so use it as supporting evidence only until it is promoted into the committed research set.

| Symbol | Taken | Wins | Losses | Breakeven | Win Rate | PnL |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| AAPL | 9 | 7 | 2 | 2 | 77.78% | +$463.93 |
| NVDA | 5 | 2 | 3 | 8 | 40.00% | +$37.52 |
| MSFT | 9 | 5 | 4 | 2 | 55.56% | -$248.00 |

This keeps **AAPL** as the main service-stability reserve. It does not displace the first-Friday candidate pair because TSLA is absent from this file and MSFT behaves differently outside the news/opening set.

## Decision

For the current news/opening study, concentrate on:

1. **MSFT**
2. **TSLA**

For service-mode stability review, keep:

1. **AAPL** as reserve / challenger

For personal wave/rider research, keep:

1. **NVDA** as a research candidate only until the written strategy proves it with stronger backtest results.

## Guardrail

Candidate does not mean deployable.

The next valid step is to run the exact same written strategy across a larger date set and compare:

- net PnL
- win rate
- average win vs average loss
- hard-stop frequency
- runner frequency
- no-retest frequency
- drawdown

Only after that should allocation become concentrated into one or two symbols.
