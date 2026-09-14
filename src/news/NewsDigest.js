/**
 * News Digest — generates daily market news digest with sentiment, trends, and decision context.
 *
 * PRICE ACTION FIRST: This digest NEVER calls for trades.
 * It provides CONTEXT that the Sniper strategy uses to adjust risk.
 */

import { NewsAnalyzer } from './NewsAnalyzer.js';

export class NewsDigest {
  constructor(config = {}) {
    this.analyzer = new NewsAnalyzer(config);
    this.digests = {}; // date string -> digest object
  }

  addArticle(article) {
    return this.analyzer.addArticle(article);
  }

  addArticles(articles) {
    return this.analyzer.addArticles(articles);
  }

  /**
   * Generate a daily digest for a specific date.
   */
  generateDailyDigest(dateStr, filter = {}) {
    const dayArticles = this.analyzer.articles.filter(a => {
      const pubDate = new Date(a.publishedAt).toISOString().slice(0, 10);
      return pubDate === dateStr && (!filter.symbol || a.symbol === filter.symbol);
    });

    const sentiment = this.analyzer.getSentiment({ ...filter, since: new Date(dateStr + 'T00:00:00'), until: new Date(dateStr + 'T23:59:59') });
    const clusters = this.analyzer.getClusters({ ...filter, since: new Date(dateStr + 'T00:00:00'), until: new Date(dateStr + 'T23:59:59') });
    const trend = this.analyzer.getSentimentTrend({ ...filter, since: new Date(dateStr + 'T00:00:00'), until: new Date(dateStr + 'T23:59:59') }, 0.5);
    const decisionCtx = this.analyzer.getDecisionContext({ ...filter, since: new Date(dateStr + 'T00:00:00'), until: new Date(dateStr + 'T23:59:59') });

    // Top articles by impact
    const topArticles = [...dayArticles]
      .sort((a, b) => Math.abs(b.sentiment) - Math.abs(a.sentiment))
      .slice(0, 10);

    // Topic breakdown
    const topicBreakdown = [];
    for (const [topic, articles] of Object.entries(clusters)) {
      if (articles.length === 0) continue;
      const avgSent = articles.reduce((s, a) => s + a.sentiment, 0) / articles.length;
      topicBreakdown.push({
        topic,
        count: articles.length,
        avg_sentiment: avgSent,
        direction: avgSent > 0.05 ? 'bullish' : avgSent < -0.05 ? 'bearish' : 'neutral',
      });
    }
    topicBreakdown.sort((a, b) => b.count - a.count);

    // Market movers — symbols with strongest sentiment
    const symbols = [...new Set(dayArticles.map(a => a.symbol).filter(Boolean))];
    const symbolSentiments = symbols.map(sym => {
      const symArticles = dayArticles.filter(a => a.symbol === sym);
      const avg = symArticles.reduce((s, a) => s + a.sentiment * a.sourceWeight, 0) /
                  symArticles.reduce((s, a) => s + a.sourceWeight, 0);
      return { symbol: sym, sentiment: avg, article_count: symArticles.length };
    });
    symbolSentiments.sort((a, b) => b.sentiment - a.sentiment);

    const digest = {
      date: dateStr,
      article_count: dayArticles.length,
      overall_sentiment: {
        score: sentiment.score,
        label: sentiment.label,
        dispersion: sentiment.dispersion,
        trend: trend.trend,
        trend_slope: trend.slope,
      },
      top_topics: topicBreakdown.slice(0, 5),
      top_articles: topArticles,
      market_movers: {
        bullish: symbolSentiments.filter(s => s.sentiment > 0.05).slice(0, 5),
        bearish: symbolSentiments.filter(s => s.sentiment < -0.05).slice(-5).reverse(),
        neutral: symbolSentiments.filter(s => Math.abs(s.sentiment) <= 0.05),
      },
      decision_context: decisionCtx,
      key_drivers: sentiment.keyDrivers,
      risk_notes: this._generateRiskNotes(sentiment, trend, topicBreakdown),
    };

    this.digests[dateStr] = digest;
    return digest;
  }

  /**
   * Compare two digests (today vs yesterday, or any two dates).
   */
  compareDigests(dateA, dateB, symbol = null) {
    const dA = this.digests[dateA] || this.generateDailyDigest(dateA, symbol ? { symbol } : {});
    const dB = this.digests[dateB] || this.generateDailyDigest(dateB, symbol ? { symbol } : {});

    const scoreChange = dA.overall_sentiment.score - dB.overall_sentiment.score;
    const articleChange = dA.article_count - dB.article_count;

    // Topic-level changes
    const topicChanges = {};
    const allTopics = new Set([
      ...dA.top_topics.map(t => t.topic),
      ...dB.top_topics.map(t => t.topic),
    ]);
    for (const topic of allTopics) {
      const a = dA.top_topics.find(t => t.topic === topic);
      const b = dB.top_topics.find(t => t.topic === topic);
      topicChanges[topic] = {
        count_change: (a?.count || 0) - (b?.count || 0),
        sentiment_change: (a?.avg_sentiment || 0) - (b?.avg_sentiment || 0),
        new_in_a: !!a && !b,
        dropped_from_a: !a && !!b,
      };
    }

    // Decision context evolution
    const confidenceChange = dA.decision_context.confidenceMult - dB.decision_context.confidenceMult;

    return {
      earlier: dateB,
      later: dateA,
      score_change: scoreChange,
      score_change_pct: dB.overall_sentiment.score !== 0 ? (scoreChange / Math.abs(dB.overall_sentiment.score)) * 100 : null,
      article_count_change: articleChange,
      topic_changes: topicChanges,
      confidence_change: confidenceChange,
      trend_acceleration: this._classifyChange(scoreChange),
      price_action_first: true,
      interpretation: this._interpretComparison(dA, dB, scoreChange),
    };
  }

  /**
   * Export a digest to multiple formats.
   */
  exportDigest(dateStr, format = 'json', options = {}) {
    const digest = this.digests[dateStr] || this.generateDailyDigest(dateStr, options.filter || {});

    switch (format.toLowerCase()) {
      case 'json':
        return JSON.stringify(digest, null, 2);

      case 'csv':
        return this._toCSV(digest);

      case 'html':
        return this._toHTML(digest);

      case 'markdown':
        return this._toMarkdown(digest);

      default:
        throw new Error(`Unknown format: ${format}. Use json, csv, html, or markdown.`);
    }
  }

  /**
   * Get all articles (for detailed views).
   */
  getArticles(filter = {}) {
    return this.analyzer._filterArticles(filter);
  }

  _generateRiskNotes(sentiment, trend, topics) {
    const notes = [];

    // High dispersion = mixed signals = higher uncertainty
    if (sentiment.dispersion > 0.3) {
      notes.push({ level: 'caution', text: 'High sentiment dispersion — mixed signals, reduce position size.' });
    }

    // Strong trend in either direction
    if (trend.trend === 'RISING') {
      notes.push({ level: 'info', text: 'Sentiment trending bullish — confirmation of long setups.' });
    } else if (trend.trend === 'FALLING') {
      notes.push({ level: 'info', text: 'Sentiment trending bearish — confirmation of short setups.' });
    }

    // Earnings topic dominance
    const earningsTopic = topics.find(t => t.topic === 'EARNINGS');
    if (earningsTopic && earningsTopic.count > 3) {
      notes.push({ level: 'warning', text: 'Earnings news dominant — expect elevated volatility, wider buffers.' });
    }

    // Regulatory concerns
    const regTopic = topics.find(t => t.topic === 'REGULATORY');
    if (regTopic && regTopic.avg_sentiment < -0.1) {
      notes.push({ level: 'warning', text: 'Negative regulatory news — consider skipping or reducing size.' });
    }

    // Low article count = low confidence
    if (sentiment.articleCount < 3) {
      notes.push({ level: 'info', text: 'Limited news coverage — rely primarily on price action.' });
    }

    if (notes.length === 0) {
      notes.push({ level: 'info', text: 'No significant risk flags. Follow price action signals normally.' });
    }

    return notes;
  }

  _classifyChange(scoreChange) {
    if (scoreChange > 0.15) return 'BULLISH_ACCELERATION';
    if (scoreChange > 0.05) return 'MILD_BULLISH';
    if (scoreChange > -0.05) return 'STABLE';
    if (scoreChange > -0.15) return 'MILD_BEARISH';
    return 'BEARISH_ACCELERATION';
  }

  _interpretComparison(dA, dB, scoreChange) {
    if (Math.abs(scoreChange) < 0.05) {
      return 'Sentiment unchanged — consistent with prior session context.';
    }
    const direction = scoreChange > 0 ? 'improved' : 'deteriorated';
    const magnitude = Math.abs(scoreChange) > 0.15 ? 'significantly' : 'moderately';
    return `Market sentiment ${direction} ${magnitude} compared to prior period. ${scoreChange > 0 ? 'Bullish' : 'Bearish'} bias strengthening — use as CONFIRMATION for price action setups.`;
  }

  _toCSV(digest) {
    const lines = [
      'field,value',
      `date,${digest.date}`,
      `article_count,${digest.article_count}`,
      `sentiment_score,${digest.overall_sentiment.score.toFixed(4)}`,
      `sentiment_label,${digest.overall_sentiment.label}`,
      `sentiment_trend,${digest.overall_sentiment.trend}`,
      `confidence_multiplier,${digest.decision_context.confidenceMult.toFixed(4)}`,
      '',
      'topic,count,avg_sentiment,direction',
    ];
    for (const t of digest.top_topics) {
      lines.push(`${t.topic},${t.count},${t.avg_sentiment.toFixed(4)},${t.direction}`);
    }
    lines.push('');
    lines.push('symbol,sentiment,article_count');
    const allSymbols = [...digest.market_movers.bullish, ...digest.market_movers.neutral, ...digest.market_movers.bearish];
    for (const s of allSymbols) {
      lines.push(`${s.symbol},${s.sentiment.toFixed(4)},${s.article_count}`);
    }
    return lines.join('\n');
  }

  _toHTML(digest) {
    const topicsHTML = digest.top_topics.map(t => `
      <div class="topic-card" style="padding:12px;border-radius:4px;background:#1a1a28;margin:8px 0;">
        <div style="font-weight:bold;color:#fff;">${t.topic} <span style="color:#888;font-size:12px;">(${t.count} articles)</span></div>
        <div style="color:${t.direction === 'bullish' ? '#00ff88' : t.direction === 'bearish' ? '#ff3355' : '#888'}">
          ${t.direction.toUpperCase()} · ${t.avg_sentiment.toFixed(3)}
        </div>
      </div>
    `).join('');

    const articlesHTML = digest.top_articles.slice(0, 5).map(a => `
      <div class="article" style="padding:8px;border-bottom:1px solid #222;">
        <div style="font-size:13px;color:#eee;">${a.title}</div>
        <div style="font-size:11px;color:#666;">${a.source} · ${a.topics.join(', ')}</div>
      </div>
    `).join('');

    return `<!DOCTYPE html>
<html><head><title>News Digest — ${digest.date}</title>
<style>body{font-family:monospace;background:#0a0a12;color:#eee;padding:20px;max-width:800px;margin:0 auto;}
h1{color:#00ff88;}.metric{display:inline-block;padding:8px 16px;background:#1a1a28;border-radius:4px;margin:4px;}</style>
</head><body>
<h1>📰 Market News Digest — ${digest.date}</h1>
<div style="margin:16px 0;">
  <div class="metric">Sentiment: <strong style="color:${digest.overall_sentiment.label.includes('BULL') ? '#00ff88' : '#ff3355'}">${digest.overall_sentiment.label}</strong></div>
  <div class="metric">Score: ${digest.overall_sentiment.score.toFixed(3)}</div>
  <div class="metric">Trend: ${digest.overall_sentiment.trend}</div>
  <div class="metric">Articles: ${digest.article_count}</div>
</div>
<h2 style="color:#ffcc00;">Top Topics</h2>${topicsHTML}
<h2 style="color:#ffcc00;">Key Articles</h2>${articlesHTML}
<h2 style="color:#ffcc00;">Risk Notes</h2>
<ul>${digest.risk_notes.map(n => `<li style="color:${n.level === 'warning' ? '#ff3355' : n.level === 'caution' ? '#ffaa00' : '#00aaff'}">${n.text}</li>`).join('')}</ul>
<p style="color:#666;font-size:12px;">⚠️ PRICE ACTION FIRST — News is context only, never a trading signal.</p>
</body></html>`;
  }

  _toMarkdown(digest) {
    const lines = [
      `# 📰 Market News Digest — ${digest.date}`,
      '',
      `**Sentiment:** ${digest.overall_sentiment.label} (${digest.overall_sentiment.score.toFixed(3)})`,
      `**Trend:** ${digest.overall_sentiment.trend}`,
      `**Articles:** ${digest.article_count}`,
      `**Confidence Multiplier:** ${digest.decision_context.confidenceMult.toFixed(2)}x`,
      '',
      '## Top Topics',
      '',
    ];
    for (const t of digest.top_topics) {
      lines.push(`- **${t.topic}** (${t.count} articles): ${t.direction} (${t.avg_sentiment.toFixed(3)})`);
    }
    lines.push('', '## Key Articles', '');
    for (const a of digest.top_articles.slice(0, 5)) {
      lines.push(`- [${a.sentiment > 0 ? '📈' : a.sentiment < 0 ? '📉' : '➡️'}] ${a.title} — *${a.source}*`);
    }
    lines.push('', '## Risk Notes', '');
    for (const n of digest.risk_notes) {
      const icon = n.level === 'warning' ? '⚠️' : n.level === 'caution' ? '⚡' : 'ℹ️';
      lines.push(`- ${icon} ${n.text}`);
    }
    lines.push('', '---');
    lines.push('> ⚠️ **PRICE ACTION FIRST** — News is context only, never a trading signal.');
    return lines.join('\n');
  }
}
