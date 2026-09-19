# News + Strategy Script Conventions

## Repo Style

Use the existing `tradeSniper-core` script style:

- JavaScript ES modules only.
- File extension: `.js`.
- Runtime: Node 18+.
- CLI entry files live in `scripts/`.
- Reusable logic lives in `src/`.
- Generated research outputs go under `agent/news-strategy-unit/massive/...`, `data/...`, or `newsOpening/...`.
- Do not create one-off notebooks or hidden scratch formats.

## Script Naming

Use `camelCase.js`, matching the current repo:

- `massiveBacktest.js`
- `newsOpeningPilot.js`
- `openingWaitConfirmationStudy.js`
- `openingWaitReviewDeck.js`

For this unit, use these names:

| Purpose | Script Filename | Package Command |
| --- | --- | --- |
| Pull/archive Massive news + bars | `scripts/newsStrategyArchive.js` | `news:strategy:archive` |
| Run MSFT + TSLA control backtest | `scripts/newsStrategyBacktest.js` | `news:strategy:backtest` |
| Add news/context overlay to control result | `scripts/newsStrategyOverlay.js` | `news:strategy:overlay` |
| Build UI-ready news feed JSON | `scripts/newsStrategyFeed.js` | `news:strategy:feed` |
| Produce markdown report from archived run | `scripts/newsStrategyReport.js` | `news:strategy:report` |
| One-command batch runner | `scripts/newsStrategyBatch.js` | `news:strategy:batch` |

Avoid vague names:

- `test.js`
- `run.js`
- `news.js`
- `agent.js`
- `finalBacktest.js`

Avoid date-specific script names:

- `msftSep15.js`
- `fomcRun.js`
- `tslaNewsTest.js`

Dates and symbols belong in CLI flags and output folders, not filenames.

## CLI Format

Use long flags. Keep defaults conservative.

Example:

```bash
node -r dotenv/config scripts/newsStrategyBatch.js \
  --symbols MSFT,TSLA \
  --from 2026-01-01 \
  --to 2026-09-19 \
  --events CPI,FOMC,NFP \
  --timespan second \
  --fallback-timespan minute \
  --window 30 \
  --out-dir agent/news-strategy-unit/massive/batch-2026-01-01_2026-09-19
```

Required common flags:

- `--symbols MSFT,TSLA`
- `--from YYYY-MM-DD`
- `--to YYYY-MM-DD`
- `--events CPI,FOMC,NFP`
- `--timespan second|minute`
- `--window 30`
- `--out-dir path`

Optional flags:

- `--include-benchmark AAPL`
- `--include-research NVDA`
- `--news-lookback-days 3`
- `--start-time 09:30:00`
- `--end-time 10:00:00`
- `--dry-run`
- `--force-refresh`

## Output Naming

For one event date:

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

For batches:

```text
agent/news-strategy-unit/massive/batch-YYYY-MM-DD_YYYY-MM-DD/
```

Do not overwrite old runs unless `--force-refresh` is explicitly passed.

## Script Structure

Use this shape for CLI scripts:

```js
#!/usr/bin/env node
/**
 * One-line purpose.
 *
 * Usage:
 *   node -r dotenv/config scripts/newsStrategyBatch.js --symbols MSFT,TSLA --from 2026-01-01 --to 2026-09-19
 *
 * Environment:
 *   MASSIVE_API_KEY - Massive API key
 */

import fs from 'node:fs/promises';
import path from 'node:path';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    symbols: ['MSFT', 'TSLA'],
    from: null,
    to: null,
    events: ['CPI', 'FOMC', 'NFP'],
    timespan: 'second',
    fallbackTimespan: 'minute',
    windowMinutes: 30,
    outDir: null,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--symbols':
        opts.symbols = args[++i].split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
        break;
      case '--from':
        opts.from = args[++i];
        break;
      case '--to':
        opts.to = args[++i];
        break;
      case '--events':
        opts.events = args[++i].split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
        break;
      case '--timespan':
        opts.timespan = args[++i];
        break;
      case '--fallback-timespan':
        opts.fallbackTimespan = args[++i];
        break;
      case '--window':
        opts.windowMinutes = Number(args[++i]);
        break;
      case '--out-dir':
        opts.outDir = args[++i];
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      default:
        throw new Error(`Unknown argument: ${args[i]}`);
    }
  }

  if (!opts.from) throw new Error('Missing --from YYYY-MM-DD');
  if (!opts.to) throw new Error('Missing --to YYYY-MM-DD');
  if (!opts.outDir) {
    opts.outDir = `agent/news-strategy-unit/massive/batch-${opts.from}_${opts.to}`;
  }
  return opts;
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

async function main() {
  const opts = parseArgs();

  const manifest = {
    generated_at: new Date().toISOString(),
    source: 'Massive',
    symbols: opts.symbols,
    period: { from: opts.from, to: opts.to },
    config: opts,
  };

  await writeJson(path.join(opts.outDir, 'manifest.json'), manifest);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
```

## Coding Rules

- Keep scripts deterministic and rerunnable.
- Keep network fetch, backtest, overlay, and reporting as separate steps unless using the batch wrapper.
- Preserve raw fetched data before creating summaries.
- Do not silently swallow missing data.
- Write a `manifest.json` for every run.
- Include `generated_at`, input paths, output paths, symbols, date range, strategy config, and data source.
- Store control and overlay separately.
- Do not let news/context mutate the control backtest.
- Do not hard-code MSFT/TSLA behavior into strategy logic; they are defaults only.

## Package Script Naming

Use colon-separated npm commands:

```json
{
  "news:strategy:archive": "node -r dotenv/config scripts/newsStrategyArchive.js",
  "news:strategy:backtest": "node -r dotenv/config scripts/newsStrategyBacktest.js",
  "news:strategy:overlay": "node -r dotenv/config scripts/newsStrategyOverlay.js",
  "news:strategy:feed": "node scripts/newsStrategyFeed.js",
  "news:strategy:report": "node scripts/newsStrategyReport.js",
  "news:strategy:batch": "node -r dotenv/config scripts/newsStrategyBatch.js"
}
```

Only add commands to `package.json` when the script exists and has been smoke-tested.
