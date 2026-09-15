# Reentry Protocol

> This document is the single source of truth for all agents after a session drop or new session start. EVERY agent must read this first before doing anything else.

## Who We Are

4-agent system for the tradeSniper-core project.

| Agent | Role | ID |
|---|---|---|
| **TradeSniper Command Center** | Coordinator — delegation, QA, progress tracking | `agent-20260915111236-5242x` |
| **TradeSniper Code Builder** | Code implementation, bug fixes, testing, GitHub pushes | `agent-20260913215350-blzsz` |
| **TradeSniper Strategy Analyst** | Backtesting, parameter optimization, strategy research | `agent-20260915092629-smrkn` |
| **TradeSniper Data & News Analyst** | Market data, news sentiment, daily digests, watchlist ranking | `agent-20260914112539-sc94d` |

## How to Use This Document

1. On EVERY new session, read these 3 files in order:
   1. `agent/REENTRY_PROTOCOL.md` (this file — what's this system)
   2. `agent/PROGRESS.md` (what's been done)
   3. `agent/STRATEGY_DECISIONS.md` (what we've decided about the strategy)

2. Do NOT start work from scratch. Always pull the latest `develop` branch and read these docs first.

3. After completing work, update the relevant doc:
   - Strategy findings, parameter changes, hypotheses → `STRATEGY_DECISIONS.md`
   - Completed work, milestones, status → `PROGRESS.md`
   - System changes, new agents, process changes → `REENTRY_PROTOCOL.md` (this file)

## Repository

- **URL:** https://github.com/Rizalliza/tradeSniper-core
- **Default working branch:** `develop`
- **Feature branches:** `feature/*` or `fix/*`
- **Never commit directly to `main`**

## Cardinal Rules (All Agents)

1. **NO SYNTHETIC DATA EVER** — All strategy validation uses real data from Massive.com
2. **PRICE ACTION IS KING** — News/sentiment is context, not signals. Max news influence: 35%
3. **EVIDENCE-BASED** — Every claim must be backed by data
4. **FEATURE BRANCHES ONLY** — Never commit directly to `develop` or `main`
5. **STOP-LOSS IS HIGHEST PRIORITY** — A trade must exit when stop conditions are met
6. **SECONDS CANDLES** — Strategy operates on 1-second bars, not minutes

## Workflow Standard

For any task:
1. Read reentry docs (these 3 files)
2. Pull latest `develop`
3. Create a feature branch
4. Plan the work
5. Execute step by step
6. Test thoroughly (`npm test` must pass)
7. Update docs with findings
8. Push feature branch
9. Report results

## Communication Chain
