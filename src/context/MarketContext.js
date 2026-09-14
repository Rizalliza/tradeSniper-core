/**
 * Market Context Module
 *
 * Provides context-aware parameter adjustments for the Sniper strategy.
 *
 * Context sources (populated by caller / web research / API):
 * - VIX level and volatility regime
 * - Earnings dates for target symbols
 * - FOMC / major economic event dates
 * - Index performance (SPY, QQQ)
 *
 * The strategy uses context to ADJUST parameters, not to generate signals.
 * Price action remains king — context tells us WHEN and HOW to trade.
 */

export const VOLATILITY_REGIMES = {
  EXTREME_LOW: { name: 'EXTREME_LOW', min: 0, max: 12, bufferMult: 0.7, reverseMult: 0.67, trailMult: 1.3 },
  LOW:         { name: 'LOW',         min: 12, max: 18, bufferMult: 0.85, reverseMult: 0.83, trailMult: 1.15 },
  NORMAL:      { name: 'NORMAL',      min: 18, max: 25, bufferMult: 1.0, reverseMult: 1.0, trailMult: 1.0 },
  HIGH:        { name: 'HIGH',        min: 25, max: 35, bufferMult: 1.5, reverseMult: 1.33, trailMult: 0.8 },
  EXTREME:     { name: 'EXTREME',     min: 35, max: 999, bufferMult: 2.0, reverseMult: 1.67, trailMult: 0.6 },
};

export class MarketContext {
  constructor(config = {}) {
    this.vix = config.vix ?? 20;
    this.earningsDates = config.earningsDates || {};  // { AAPL: '2026-02-25', ... }
    this.fomcDates = config.fomcDates || [];          // ['2026-01-28', '2026-03-18', ...]
    this.indexTrend = config.indexTrend || 'NEUTRAL'; // 'BULLISH', 'BEARISH', 'NEUTRAL'
    this.earningsSkipDays = config.earningsSkipDays ?? 2; // skip N days before earnings
  }

  /**
   * Get volatility regime based on VIX level.
   */
  getRegime() {
    for (const key of Object.keys(VOLATILITY_REGIMES)) {
      const r = VOLATILITY_REGIMES[key];
      if (this.vix >= r.min && this.vix < r.max) return r;
    }
    return VOLATILITY_REGIMES.NORMAL;
  }

  /**
   * Should we skip trading this symbol on this date?
   * Checks: earnings proximity, FOMC day
   */
  shouldSkip(symbol, date) {
    // Skip on FOMC days
    if (this.fomcDates.includes(date)) {
      return { skip: true, reason: 'FOMC_DAY' };
    }
    // Skip if earnings within N days
    const earningsDate = this.earningsDates[symbol];
    if (earningsDate) {
      const daysDiff = this._daysBetween(date, earningsDate);
      if (daysDiff >= 0 && daysDiff <= this.earningsSkipDays) {
        return { skip: true, reason: 'EARNINGS_SOON', daysUntilEarnings: daysDiff };
      }
    }
    return { skip: false, reason: null };
  }

  /**
   * Adjust strategy parameters based on current context.
   * Returns adjusted config values.
   */
  adjustParams(baseConfig = {}) {
    const regime = this.getRegime();
    const adjusted = { ...baseConfig };

    // Buffer adjustment based on VIX
    if (baseConfig.bufferPct !== undefined) {
      adjusted.bufferPct = baseConfig.bufferPct * regime.bufferMult;
    }

    // Reverse stop count adjustment
    if (baseConfig.reverseStopCount !== undefined) {
      adjusted.reverseStopCount = Math.max(
        1,
        Math.round(baseConfig.reverseStopCount * regime.reverseMult)
      );
    }

    // Trailing step adjustment
    if (baseConfig.trailingStepPct !== undefined) {
      adjusted.trailingStepPct = baseConfig.trailingStepPct * regime.trailMult;
    }

    return {
      regime: regime.name,
      vix: this.vix,
      indexTrend: this.indexTrend,
      adjusted,
    };
  }

  /**
   * Get a human-readable context summary.
   */
  summary() {
    const regime = this.getRegime();
    return {
      vix: this.vix,
      regime: regime.name,
      indexTrend: this.indexTrend,
      fomcDates: this.fomcDates.length,
      trackedEarnings: Object.keys(this.earningsDates).length,
    };
  }

  _daysBetween(dateA, dateB) {
    const a = new Date(dateA);
    const b = new Date(dateB);
    const msDiff = b.getTime() - a.getTime();
    return Math.ceil(msDiff / (1000 * 60 * 60 * 24));
  }
}
