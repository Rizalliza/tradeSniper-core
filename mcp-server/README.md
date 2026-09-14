# TradeSniper News MCP Server

A self-contained MCP (Model Context Protocol) server that provides market news analysis with sentiment scoring, topic clustering, and decision context generation.

## What it does

Provides 5 tools that your Agent can call:

| Tool | Purpose |
|---|---|
| `fetch_news` | Get articles for a symbol with sentiment, topics, source quality |
| `get_sentiment` | Aggregate sentiment score + label + key drivers |
| `get_daily_digest` | Full daily digest (JSON/Markdown/HTML/CSV) |
| `compare_periods` | Sentiment trend between two dates |
| `get_decision_context` | Structured output for the Sniper strategy |

## Design principle

**Price action is king.** News context maxes out at 30-35% influence and adjusts position sizing confidence only — it never generates trading signals.

## Quick start

```bash
cd mcp-server
npm install
npm start
```

Currently uses sample news data (AAPL / TSLA / NVDA).

## Connecting to the BytePlus agent

The MCP server runs on stdio (default for MCP). To connect it as an MCP server:

1. Run the server on a machine that's accessible
2. Configure your BytePlus agent's `mcp_servers` to point to this server's URL
3. Add the corresponding `mcp_toolset` entry to the agent's tools

For local testing, you can use the included sample data directly in the webapp (no MCP needed).

## Adding real news API

To connect a real news provider (NewsAPI, GNews, etc.):

1. Get an API key
2. Add it to `.env`: `NEWS_API_KEY=your_key`
3. Modify `server.js` to fetch from the API instead of sample data

The current code includes the full sentiment pipeline — you only need to swap the data source.
