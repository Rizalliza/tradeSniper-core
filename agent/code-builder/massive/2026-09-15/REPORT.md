# Code Builder Massive Handoff

Date: 2026-09-15
Symbols: AAPL, TSLA, NVDA
Data source: REAL_MASSIVE_REST

Purpose:
- Use these files as stable fixtures for wiring the webapp and agent handoffs.
- Do not use synthetic candles for user-visible validation.
- Do not commit API keys or OAuth material.

Validated endpoints:
- daily aggregates AAPL: OK
- second aggregates AAPL: OK
- minute aggregates AAPL: OK
- daily aggregates TSLA: OK
- second aggregates TSLA: OK
- minute aggregates TSLA: OK
- daily aggregates NVDA: OK
- second aggregates NVDA: OK
- minute aggregates NVDA: OK
- news AAPL: OK
- news TSLA: OK
- news NVDA: OK

Known caveats:
- Codex MCP is configured in ~/.codex/config.toml, but CLI listing reports auth as Unsupported here.
- REST via repo .env was used for this export.
- Sep 16, 2026 U.S. regular session had not opened at export time; latest completed session is 2026-09-15.
- Strategy handoff is opening-period scoped. Full-day backtests should use scripts/massiveBacktest.js.
