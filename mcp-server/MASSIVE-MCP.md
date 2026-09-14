# Massive.com MCP — Primary Data Source

**This is now the recommended approach.** The self-hosted MCP server in `mcp-server/` is for when you want full control or to use custom data. For production, use Massive's official hosted MCP.

## What you get (all in one connection)

| Data | Details |
|---|---|
| **News** | Articles with AI-generated sentiment, ticker insights, keywords |
| **Second bars** | 1-second resolution intraday data (your subscription tier) |
| **Minute bars** | 1-minute resolution data |
| **Daily bars** | For marker computation and historical context |
| **Ticker details** | Company info, market cap, description, branding |
| **Market status** | Is the market open? After hours? |
| **All REST endpoints** | Dynamic discovery via natural language search |

## Setup

The Massive MCP server is hosted — nothing to install.

### In BytePlus / Ark CLI:

Add this to your agent's MCP servers:

```yaml
mcp_servers:
  - name: massive-data
    url: https://mcp.massive.com/
    auth_type: oauth
```

And add the corresponding toolset:

```yaml
tools:
  - type: mcp_toolset
    mcp_server_name: massive-data
    default_config:
      enabled: true
      permission_policy:
        type: always_allow
```

### How it works

Instead of exposing dozens of endpoints as separate tools, the Massive MCP provides a small set of composable tools:

1. **Discover** — search docs in natural language
2. **Get docs** — retrieve parameter details on demand
3. **Execute** — call any REST API endpoint

This keeps your agent's context window clean while still giving it access to everything.

## Subscription

Access mirrors your Massive plan. If you have Stocks + Second Bars, you get all of those through the MCP.

---

# Self-Hosted MCP Server (fallback / custom)

If you need full control, custom data, or want to run everything locally, use the self-hosted server in `mcp-server/`.

Currently uses sample news data but can be connected to any news API.
