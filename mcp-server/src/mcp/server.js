/**
 * News MCP Server
 *
 * An MCP (Model Context Protocol) server that provides market news
 * with sentiment analysis, topic clustering, and daily digest generation.
 *
 * PRICE ACTION FIRST: This server provides context only.
 *
 * Usage:
 *   npm install
 *   npm start
 *
 * Environment variables:
 *   NEWS_API_KEY - API key for news provider (optional, uses sample data if not set)
 *   MCP_PORT     - Port to listen on (default: 3001)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { NewsDigest } from '../../src/news/NewsDigest.js';
import { SAMPLE_NEWS } from '../../src/data/sampleNews.js';

const server = new Server(
  {
    name: 'tradesniper-news-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const digest = new NewsDigest();
digest.addArticles(SAMPLE_NEWS);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'fetch_news',
        description: 'Fetch news articles for one or more stock symbols. Returns articles with sentiment scores, topics, and source quality.',
        inputSchema: {
          type: 'object',
          properties: {
            symbols: {
              type: 'array',
              items: { type: 'string' },
              description: 'Stock symbols to fetch news for (e.g. ["AAPL", "TSLA", "NVDA"])',
            },
            since: {
              type: 'string',
              description: 'Start date for news (YYYY-MM-DD). Default: 7 days ago.',
            },
            until: {
              type: 'string',
              description: 'End date for news (YYYY-MM-DD). Default: today.',
            },
            limit: {
              type: 'number',
              description: 'Max articles per symbol. Default: 20.',
            },
          },
          required: ['symbols'],
        },
      },
      {
        name: 'get_sentiment',
        description: 'Get aggregate sentiment score for a symbol or set of symbols with label, dispersion, and key drivers.',
        inputSchema: {
          type: 'object',
          properties: {
            symbols: {
              type: 'array',
              items: { type: 'string' },
              description: 'Stock symbols to analyze',
            },
            since: {
              type: 'string',
              description: 'Start date (YYYY-MM-DD)',
            },
            topic: {
              type: 'string',
              description: 'Filter by topic (EARNINGS, MACRO, PRODUCT, REGULATORY, TECH, EVENTS)',
            },
          },
          required: ['symbols'],
        },
      },
      {
        name: 'get_daily_digest',
        description: 'Generate a full daily news digest with sentiment, topics, market movers, risk notes, and decision context.',
        inputSchema: {
          type: 'object',
          properties: {
            date: {
              type: 'string',
              description: 'Date for digest (YYYY-MM-DD). Default: latest available.',
            },
            symbol: {
              type: 'string',
              description: 'Optional: filter to a single symbol',
            },
            format: {
              type: 'string',
              enum: ['json', 'markdown', 'html', 'csv'],
              description: 'Output format. Default: json',
            },
          },
          required: [],
        },
      },
      {
        name: 'compare_periods',
        description: 'Compare news sentiment between two time periods to detect acceleration or trend changes.',
        inputSchema: {
          type: 'object',
          properties: {
            date_a: {
              type: 'string',
              description: 'First date (YYYY-MM-DD) — the later period',
            },
            date_b: {
              type: 'string',
              description: 'Second date (YYYY-MM-DD) — the earlier period',
            },
            symbol: {
              type: 'string',
              description: 'Optional: filter to a single symbol',
            },
          },
          required: ['date_a', 'date_b'],
        },
      },
      {
        name: 'get_decision_context',
        description: 'Get structured decision context for the Sniper strategy: confidence multiplier, news weight, risk notes. ALWAYS returns price_action_first=true.',
        inputSchema: {
          type: 'object',
          properties: {
            symbols: {
              type: 'array',
              items: { type: 'string' },
              description: 'Symbols to include in context',
            },
            since: {
              type: 'string',
              description: 'Start date for news window (YYYY-MM-DD)',
            },
          },
          required: ['symbols'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'fetch_news': {
        const { symbols, since, until, limit = 20 } = args || {};
        const results = [];
        for (const sym of symbols || []) {
          const filter = { symbol: sym };
          if (since) filter.since = new Date(since).toISOString();
          if (until) filter.until = new Date(until).toISOString();
          const articles = digest.getArticles(filter).slice(0, limit);
          results.push({ symbol: sym, articles });
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
        };
      }

      case 'get_sentiment': {
        const { symbols, since, topic } = args || {};
        const results = {};
        for (const sym of symbols || []) {
          const filter = { symbol: sym };
          if (since) filter.since = new Date(since).toISOString();
          if (topic) filter.topic = topic;
          results[sym] = digest.analyzer.getSentiment(filter);
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
        };
      }

      case 'get_daily_digest': {
        const { date, symbol, format = 'json' } = args || {};
        const latestDate = date || [...new Set(SAMPLE_NEWS.map(a => a.publishedAt.slice(0, 10)))].sort().pop();
        const output = digest.exportDigest(latestDate, format, symbol ? { filter: { symbol } } : {});
        return {
          content: [{ type: 'text', text: output }],
        };
      }

      case 'compare_periods': {
        const { date_a, date_b, symbol } = args || {};
        const comparison = digest.compareDigests(date_a, date_b, symbol);
        return {
          content: [{ type: 'text', text: JSON.stringify(comparison, null, 2) }],
        };
      }

      case 'get_decision_context': {
        const { symbols, since } = args || {};
        const results = {};
        for (const sym of symbols || []) {
          const filter = { symbol: sym };
          if (since) filter.since = new Date(since).toISOString();
          results[sym] = digest.analyzer.getDecisionContext(filter);
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('TradeSniper News MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
