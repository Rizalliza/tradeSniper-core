# Handover Brief: Pattern-Led News + Strategy Research

## Role Summary

You are taking over the heavy research lane for TradeSniper's News + Strategy unit.

Your main role is to turn pattern/structure observations into archived, testable research summaries that support the written sniper strategy. The main theory document for this role is:

```text
/Users/qistina/Desktop/tradesniper01/theory/paternBasic.txt
```

Treat that file as the pattern-research foundation. Your work should convert the ideas there into structured annotations, backtest summaries, and UI-ready briefs. Do not create a separate discretionary pattern trading system.

## Current Project Phase

We are in the **foundation validation phase**.

The current priority is not aesthetics, ML, or broad symbol coverage. The priority is to prove that the engine can:

1. read opening price action correctly,
2. detect clean retest/confirmation structure,
3. separate tradeable from non-tradeable openings,
4. classify losses honestly,
5. generate repeatable evidence across archived real data.

The project is narrowing into specialized lanes:

| Lane | Current Symbol Focus | Purpose |
| --- | --- | --- |
| Service sniper | AAPL | Daily staple / stability benchmark |
| News opening | MSFT + TSLA | Candidate pair selected from backtest results |
| Wave/rider research | NVDA | Personal/research mode only |

MSFT + TSLA are the current news-opening candidates because backtest results selected them. Visual chart culture can explain behavior, but it must not override backtest ranking.

## Narrative To Preserve

TradeSniper is not trying to trade everything.

The working thesis is that a small number of symbols may be more readable than a wide basket. Concentrated attention is preferred over diluted coverage. If one or two symbols adapt best to the written strategy, those become the keeper symbols.

Pattern research supports this by answering:

- which symbols are readable,
- which sessions are no-trade,
- why the strategy won or lost,
- whether a move was sniper-like, wave-like, or untradeable,
- whether future filters should become stricter or looser.

## Required Reading

Read these files before starting:

```text
/Users/qistina/Desktop/tradesniper01/theory/paternBasic.txt
```

```text
/Users/qistina/Desktop/tradesniper01/tradeSniper-core/agent/REENTRY_PROTOCOL.md
/Users/qistina/Desktop/tradesniper01/tradeSniper-core/agent/PROGRESS.md
/Users/qistina/Desktop/tradesniper01/tradeSniper-core/agent/STRATEGY_DECISIONS.md
```

```text
/Users/qistina/Desktop/tradesniper01/tradeSniper-core/newsOpening/CANDIDATE_SELECTION.md
/Users/qistina/Desktop/tradesniper01/tradeSniper-core/newsOpening/CULTURE_NOTES.md
```

```text
/Users/qistina/Desktop/tradesniper01/tradeSniper-core/agent/news-strategy-unit/BRIEF.md
/Users/qistina/Desktop/tradesniper01/tradeSniper-core/agent/news-strategy-unit/SCRIPT_CONVENTIONS.md
/Users/qistina/Desktop/tradesniper01/tradeSniper-core/agent/news-strategy-unit/NEWS_FEED_UI_TEMPLATE.json
/Users/qistina/Desktop/tradesniper01/tradeSniper-core/agent/news-strategy-unit/REPORT_TEMPLATE.md
```

## Objectives

### Objective 1: Archive Real Data

Use real Massive data only.

For each event/date/symbol run, archive:

- raw second bars when available,
- minute bars as fallback/comparison,
- raw news articles,
- news sentiment/context,
- event metadata,
- request parameters.

Every run must include a `manifest.json`.

### Objective 2: Run Written Strategy As Control

Run the existing written strategy first with no visual override.

The control result must answer:

- what trades were taken,
- what was skipped,
- what won,
- what lost,
- what reached runner status,
- what hit hard stop,
- what remained inconclusive.

Do not let news, pattern labels, or manual opinion modify the control result.

### Objective 3: Add News Context Overlay

After the control result exists, annotate each session with news/event context:

- CPI / FOMC / NFP / PPI / retail sales / other,
- macro direction if known,
- symbol-specific news,
- sentiment label,
- confidence,
- risk notes.

News is context only. It cannot create a buy/sell signal by itself.

### Objective 4: Add Pattern / Structure Annotation

Use `/theory/paternBasic.txt` as the pattern framework.

Pattern output must be descriptive, not decisive.

Required fields to study:

- opening impulse size,
- opening wick direction,
- first pullback depth,
- first retest quality,
- higher-high / higher-low status,
- lower-high / lower-low status,
- engulfing / hammer / inverted hammer observations,
- body-to-wick ratio,
- close location within candle range,
- micro trend after entry,
- failed continuation count,
- reversal warning count.

The target output shape is:

```json
{
  "pattern_context": {
    "mode_hint": "SNIPER | WAVE | NO_TRADE",
    "structure_bias": "BULLISH | BEARISH | MIXED | NEUTRAL",
    "confidence": 0.0,
    "features": {
      "opening_impulse_pct": 0.0,
      "first_pullback_pct": 0.0,
      "higher_high_confirmed": false,
      "higher_low_confirmed": false,
      "lower_high_confirmed": false,
      "lower_low_confirmed": false,
      "retest_quality": "STRONG | ACCEPTABLE | WEAK | NONE",
      "exhaustion_warning": false
    },
    "notes": []
  }
}
```

### Objective 5: Produce Review Summaries

The output should help the main TradeSniper loop review faster.

Every report should answer:

- did MSFT or TSLA adapt better to the written strategy?
- did news context explain direction or volatility?
- did pattern/structure explain wins, losses, skips, or runners?
- was the session sniper-like, wave-like, or untradeable?
- what needs to be adjusted next?

## Phase Plan

### Phase 1: Setup And Familiarity

Read the required docs. Confirm the current repo conventions. Do not start by changing production code.

### Phase 2: Data Collection

Pull and archive Massive data for MSFT + TSLA around scheduled news events:

- CPI,
- FOMC,
- NFP / jobs report,
- PPI or retail sales if more samples are needed.

Use AAPL only as the service benchmark. Use NVDA only for wave/rider research comparison.

### Phase 3: Control Backtest

Run the written strategy exactly as-is.

Produce:

```text
backtest-control.json
```

### Phase 4: Context + Pattern Overlay

Annotate the control result without changing it.

Produce:

```text
backtest-context-overlay.json
```

This file should include both news context and pattern/structure context.

### Phase 5: UI Feed

Convert the result into:

```text
ui-news-feed.json
```

Follow:

```text
agent/news-strategy-unit/NEWS_FEED_UI_TEMPLATE.json
```

### Phase 6: Human Report

Produce:

```text
REPORT.md
```

Follow:

```text
agent/news-strategy-unit/REPORT_TEMPLATE.md
```

The report must be concise enough for fast review, but detailed enough to explain the cause of losses and missed opportunities.

## File And Folder Standard

Single event:

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

Batch:

```text
agent/news-strategy-unit/massive/batch-YYYY-MM-DD_YYYY-MM-DD/
```

Script conventions:

```text
agent/news-strategy-unit/SCRIPT_CONVENTIONS.md
```

## Success Criteria

A useful handoff run is one that lets the core team answer:

1. Is MSFT still a valid news-opening candidate?
2. Is TSLA still a valid news-opening candidate after risk is considered?
3. Did AAPL remain a better service-mode benchmark?
4. Did NVDA show wave/rider behavior worth separate study?
5. Which losses came from weak retest, wrong direction, exit timing, or stop logic?
6. Which pattern features repeatedly explain the good trades?
7. Which pattern features warn us to skip?

## Boundaries

Do not:

- create synthetic data,
- hard-code a symbol/date result,
- change production strategy logic without separate approval,
- allow news to generate trades,
- allow pattern labels to override the control backtest,
- hide missing data,
- overstate confidence from a small sample,
- optimize parameters until the data archive and control result are clean.

Do:

- preserve raw data,
- keep control and overlay separate,
- explain every loss,
- identify no-trade conditions,
- summarize clearly,
- keep outputs reproducible,
- use file names and script names that match the repo style.

## Final Handoff Format

When returning work, provide:

1. output folder path,
2. event/date range,
3. symbols tested,
4. data source/resolution,
5. control result summary,
6. news/context overlay summary,
7. pattern/structure summary,
8. candidate ranking,
9. limitations,
10. next recommended adjustment.

The main team will use your summary to decide what to fine tune next. Your job is to make the evidence clean, not to force a conclusion.
