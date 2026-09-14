#!/usr/bin/env bash
# Deploy TradeSniper News Agent to BytePlus Managed Agents
# Usage: ./scripts/deploy-agent.sh

set -e

echo "🚀 Deploying TradeSniper News Agent..."
echo ""

# Create the agent
echo "📝 Creating agent from config..."
RESULT=$(arkcli agent create agent/tradesniper-news-agent.yaml)
echo "$RESULT"
echo ""

AGENT_ID=$(echo "$RESULT" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -n "$AGENT_ID" ]; then
    echo "✅ Agent created: $AGENT_ID"
    echo ""
    echo "📋 Next steps:"
    echo "   1. Configure MCP API key in the BytePlus console"
    echo "   2. Create an Environment for the agent"
    echo "   3. Create a Session to test"
    echo ""
    echo "🔧 To test the agent:"
    echo "   arkcli agent chat $AGENT_ID --message \"Give me a news digest for AAPL, TSLA, NVDA\""
else
    echo "⚠️  Could not parse agent ID from output"
    echo "Check the output above for details"
fi
