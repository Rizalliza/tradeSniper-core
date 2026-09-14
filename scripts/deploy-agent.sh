#!/usr/bin/env bash
# Deploy TradeSniper News Agent to BytePlus Managed Agents
# Usage: ./scripts/deploy-agent.sh

set -e

echo "🚀 Deploying TradeSniper News Agent..."
echo ""

# Create the agent
# Use the stable subcommand path: arkcli agent agent create
# (some CLI versions use arkcli agent create, but agent agent create is the stable path)
echo "📝 Creating agent from config..."
RESULT=$(arkcli agent agent create --file agent/tradesniper-news-agent.yaml --format json 2>&1) || \
RESULT=$(arkcli agent create agent/tradesniper-news-agent.yaml --format json 2>&1)
echo "$RESULT"
echo ""

AGENT_ID=$(echo "$RESULT" | grep -Eo '"Id"[[:space:]]*:[[:space:]]*"[^"]+"' | head -1 | cut -d'"' -f4)

if [ -n "$AGENT_ID" ]; then
    echo "✅ Agent created: $AGENT_ID"
    echo ""
    echo "📋 Next steps:"
    echo "   1. Authorize the Massive MCP server (OAuth) via BytePlus console"
    echo "   2. Create an Environment for the agent"
    echo "   3. Create a Session to test"
    echo ""
    echo "🔧 To test the agent:"
    echo "   arkcli +new session $AGENT_ID --environment-id <env-id> --message \"Give me a news digest for AAPL, TSLA, NVDA\""
else
    echo "⚠️  Could not parse agent ID from output"
    echo "Check the output above for details"
fi
