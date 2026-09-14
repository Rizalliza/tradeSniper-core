/**
 * News Analyzer — sentiment scoring, topic clustering, and bias detection.
 *
 * IMPORTANT DESIGN CONSTRAINT:
 * News is CONTEXT, not a signal. Price action remains primary.
 * Sentiment only ADJUSTS risk parameters, never generates trades.
 */

// Lexicon-based sentiment (fast, runs in browser/node, no API needed)
const POSITIVE_WORDS = new Set([
  'surge', 'rally', 'beat', 'beats', 'beat expectations', 'upgrade', 'growth', 'profit',
  'record', 'soar', 'surpass', 'exceed', 'strong', 'bullish', 'outperform', 'raise',
  'higher', 'gain', 'gains', 'jump', 'climb', 'advance', 'boost', 'breakout', 'positive',
  'revenue growth', 'earnings beat', 'guidance raised', 'upside', 'outpace', 'win',
  'innovation', 'partnership', 'launch', 'success', 'approval', 'favorable', 'robust',
  'rebound', 'recovery', 'momentum', 'accelerate', 'deliver', 'exceed estimates',
  'buy rating', 'overweight', 'top pick', 'double-digit', 'thrive', 'record high',
]);

const NEGATIVE_WORDS = new Set([
  'plunge', 'tumble', 'miss', 'misses', 'miss expectations', 'downgrade', 'decline',
  'loss', 'drop', 'fall', 'crash', 'weak', 'bearish', 'underperform', 'lower',
  'cut', 'warn', 'warning', 'slump', 'selloff', 'sell-off', 'negative', 'shortfall',
  'guidance cut', 'downside', 'struggle', 'lose', 'loses', 'lawsuit', 'investigation',
  'recall', 'delayed', 'disappointing', 'below estimates', 'reduce', 'shrink',
  'sell rating', 'underweight', 'underperform', 'high risk', 'concern', 'fears',
  'volatility', 'tumble', 'plummet', 'dive', 'shed', 'erode', 'headwind',
  'miss estimates', 'revenue miss', 'earnings miss', 'cut forecast',
]);

const TOPIC_KEYWORDS = {
  EARNINGS: ['earnings', 'revenue', 'profit', 'quarterly', 'q1', 'q2', 'q3', 'q4',
    'guidance', 'forecast', 'beat', 'miss', 'eps', 'net income', 'margin'],
  PRODUCT: ['product', 'launch', 'update', 'release', 'new model', 'feature',
    'partnership', 'deal', 'collaboration', 'acquisition', 'buy'],
  REGULATORY: ['regulation', 'regulatory', 'antitrust', 'investigation', 'lawsuit',
    'approval', 'fda', 'sec', 'compliance', 'fine', 'settlement'],
  MACRO: ['fed', 'interest rate', 'inflation', 'recession', 'gdp', 'fomc',
    'economic', 'market', 'treasury', 'yield', 'cpi', 'jobs', 'unemployment'],
  TECH: ['ai', 'artificial intelligence', 'chip', 'semiconductor', 'gpu', 'software',
    'cloud', 'data center', 'automation', 'robotics', 'saas'],
  EVENTS: ['earnings call', 'analyst day', 'presentation', 'conference', 'summit',
    'keynote', 'event'],
};

const SOURCE_QUALITY = {
  high: ['bloomberg', 'reuters', 'wall street journal', 'wsj', 'financial times',
    'ft', 'cnbc', 'barron\'s', 'seeking alpha pro', 'institutional investor'],
  medium: ['yahoo finance', 'marketwatch', 'investopedia', 'the motley fool',
    'zacks', 'nasdaq.com', 'benzinga', 'investor\'s business daily'],
  low: ['reddit', 'twitter', 'x.com', 'facebook', 'tiktok', 'blog', 'opinion',
    'editorial', 'commentary'],
};

export class NewsAnalyzer {
  constructor(config = {}) {
    this.articles = [];
    this.posNegBalance = config.posNegBalance ?? 1.0; // weight multiplier for negatives
  }

  /**
   * Add an article for analysis.
   * Article: { title, summary, source, url, publishedAt, symbol }
   */
  addArticle(article) {
    const analyzed = this._analyzeArticle(article);
    this.articles.push(analyzed);
    return analyzed;
  }

  addArticles(articles) {
    return articles.map(a => this.addArticle(a));
  }

  /**
   * Get aggregate sentiment for a symbol or all articles.
   */
  getSentiment(filter = {}) {
    const filtered = this._filterArticles(filter);
    if (!filtered.length) {
      return { score: 0, label: 'NEUTRAL', articleCount: 0, byTopic: {} };
    }

    // Weighted by source quality
    const totalWeight = filtered.reduce((sum, a) => sum + a.sourceWeight, 0);
    const weightedScore = filtered.reduce((sum, a) => sum + a.sentiment * a.sourceWeight, 0) / totalWeight;

    // Label
    let label = 'NEUTRAL';
    if (weightedScore > 0.15) label = 'BULLISH';
    else if (weightedScore > 0.05) label = 'MILDLY_BULLISH';
    else if (weightedScore < -0.15) label = 'BEARISH';
    else if (weightedScore < -0.05) label = 'MILDLY_BEARISH';

    // By topic
    const byTopic = {};
    for (const topic of Object.keys(TOPIC_KEYWORDS)) {
      const topicArticles = filtered.filter(a => a.topics.includes(topic));
      if (topicArticles.length) {
        const tw = topicArticles.reduce((s, a) => s + a.sentiment * a.sourceWeight, 0);
        const tw2 = topicArticles.reduce((s, a) => s + a.sourceWeight, 0);
        byTopic[topic] = {
          count: topicArticles.length,
          score: tw / tw2,
        };
      }
    }

    // Key drivers (top 3 phrases from strongest articles)
    const sorted = [...filtered].sort((a, b) => Math.abs(b.sentiment) - Math.abs(a.sentiment));
    const keyDrivers = sorted.slice(0, 3).map(a => ({
      title: a.title,
      sentiment: a.sentiment,
      topics: a.topics,
      source: a.source,
    }));

    return {
      score: weightedScore,
      label,
      articleCount: filtered.length,
      byTopic,
      keyDrivers,
      avgSentimentAbs: filtered.reduce((s, a) => s + Math.abs(a.sentiment), 0) / filtered.length,
      dispersion: this._dispersion(filtered),
    };
  }

  /**
   * Cluster articles by topic and similarity.
   */
  getClusters(filter = {}) {
    const filtered = this._filterArticles(filter);
    const clusters = {};

    for (const topic of Object.keys(TOPIC_KEYWORDS)) {
      clusters[topic] = filtered.filter(a => a.topics.includes(topic));
    }

    // "OTHER" cluster for articles with no matching topic
    clusters.OTHER = filtered.filter(a => a.topics.length === 0);

    return clusters;
  }

  /**
   * Detect trend direction in sentiment over time.
   * Returns: { trend: 'RISING'/'FALLING'/'STABLE', slope, recent_avg, older_avg }
   */
  getSentimentTrend(filter = {}, splitRatio = 0.5) {
    const filtered = this._filterArticles(filter);
    if (filtered.length < 3) return { trend: 'INSUFFICIENT_DATA', slope: 0, recent_avg: 0, older_avg: 0 };

    const sorted = [...filtered].sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt));
    const splitIdx = Math.floor(sorted.length * splitRatio);
    const older = sorted.slice(0, splitIdx);
    const recent = sorted.slice(splitIdx);

    const olderAvg = older.reduce((s, a) => s + a.sentiment, 0) / older.length;
    const recentAvg = recent.reduce((s, a) => s + a.sentiment, 0) / recent.length;
    const slope = recentAvg - olderAvg;

    let trend = 'STABLE';
    if (slope > 0.08) trend = 'RISING';
    else if (slope > 0.03) trend = 'MILDLY_RISING';
    else if (slope < -0.08) trend = 'FALLING';
    else if (slope < -0.03) trend = 'MILDLY_FALLING';

    return { trend, slope, recent_avg: recentAvg, older_avg: olderAvg, articleCount: filtered.length };
  }

  /**
   * Build a context object for the decision engine.
   * PRICE ACTION IS KING — this only adjusts confidence and risk.
   */
  getDecisionContext(filter = {}) {
    const sentiment = this.getSentiment(filter);
    const trend = this.getSentimentTrend(filter);

    // Context weight: how much should sentiment influence?
    // Low weight (0-0.3): sentiment is a CONFIRMATION, not a driver
    const baseWeight = 0.2;
    const qualityBoost = sentiment.articleCount >= 5 ? 0.05 : 0;
    const trendBoost = ['RISING', 'FALLING'].includes(trend.trend) ? 0.05 : 0;
    const weight = Math.min(baseWeight + qualityBoost + trendBoost, 0.35);

    // Confidence adjustment (multiplier for position sizing)
    // Only adjusts within a reasonable band — never takes over
    let confidenceMult = 1.0;
    if (sentiment.articleCount >= 3) {
      confidenceMult = 1.0 + (sentiment.score * weight * 0.5);
      confidenceMult = Math.max(0.7, Math.min(1.3, confidenceMult));
    }

    return {
      sentiment_score: sentiment.score,
      sentiment_label: sentiment.label,
      sentiment_trend: trend.trend,
      sentiment_slope: trend.slope,
      article_count: sentiment.articleCount,
      top_topics: Object.entries(sentiment.byTopic)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 3)
        .map(([topic, data]) => ({ topic, count: data.count, score: data.score })),
      weight,            // max influence of news on decision
      confidenceMult,    // position size multiplier (0.7 - 1.3)
      priceActionFirst: true,
    };
  }

  _analyzeArticle(article) {
    const text = `${article.title} ${article.summary || ''}`.toLowerCase();
    const titleLower = (article.title || '').toLowerCase();
    const words = text.split(/[^a-z0-9\s'-]/).filter(Boolean);

    // Sentiment scoring
    let posCount = 0;
    let negCount = 0;

    for (const word of words) {
      if (POSITIVE_WORDS.has(word)) posCount++;
      if (NEGATIVE_WORDS.has(word)) negCount++;
    }

    // Phrase-level matching (2-3 word phrases)
    for (const phrase of POSITIVE_WORDS) {
      if (phrase.includes(' ') && text.includes(phrase)) posCount += 2;
    }
    for (const phrase of NEGATIVE_WORDS) {
      if (phrase.includes(' ') && text.includes(phrase)) negCount += 2;
    }

    // Title has higher weight
    let titlePos = 0, titleNeg = 0;
    const titleWords = titleLower.split(/[^a-z0-9\s'-]/).filter(Boolean);
    for (const w of titleWords) {
      if (POSITIVE_WORDS.has(w)) titlePos++;
      if (NEGATIVE_WORDS.has(w)) titleNeg++;
    }
    posCount += titlePos * 2;
    negCount += titleNeg * 2;

    // Normalize to -1..1
    const total = posCount + negCount;
    let sentiment = 0;
    if (total > 0) {
      sentiment = ((posCount - negCount * this.posNegBalance) / total) * Math.min(1, total / 4);
    }

    // Topics
    const topics = [];
    for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
      for (const kw of keywords) {
        if (text.includes(kw)) {
          topics.push(topic);
          break;
        }
      }
    }

    // Source quality weight
    const sourceLower = (article.source || '').toLowerCase();
    let sourceQuality = 'medium';
    let sourceWeight = 1.0;
    for (const level of Object.keys(SOURCE_QUALITY)) {
      if (SOURCE_QUALITY[level].some(s => sourceLower.includes(s))) {
        sourceQuality = level;
        sourceWeight = level === 'high' ? 1.5 : level === 'low' ? 0.5 : 1.0;
        break;
      }
    }

    return {
      ...article,
      sentiment,
      topics,
      sourceQuality,
      sourceWeight,
      posCount,
      negCount,
    };
  }

  _filterArticles(filter) {
    let filtered = this.articles;
    if (filter.symbol) filtered = filtered.filter(a => a.symbol === filter.symbol);
    if (filter.since) {
      const since = new Date(filter.since);
      filtered = filtered.filter(a => new Date(a.publishedAt) >= since);
    }
    if (filter.until) {
      const until = new Date(filter.until);
      filtered = filtered.filter(a => new Date(a.publishedAt) <= until);
    }
    if (filter.topic) filtered = filtered.filter(a => a.topics.includes(filter.topic));
    return filtered;
  }

  _dispersion(articles) {
    if (articles.length < 2) return 0;
    const mean = articles.reduce((s, a) => s + a.sentiment, 0) / articles.length;
    const variance = articles.reduce((s, a) => s + (a.sentiment - mean) ** 2, 0) / articles.length;
    return Math.sqrt(variance);
  }
}
