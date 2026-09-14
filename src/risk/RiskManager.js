/**
 * Risk Management Module
 *
 * Capital preservation is the #1 priority.
 *
 * Features:
 * - Position sizing based on risk per trade
 * - Max daily loss limit
 * - Max daily trades limit
 * - Concentration limits per symbol
 * - Win-streak / loss-streak position adjustment
 */

export class RiskManager {
  constructor(config = {}) {
    this.accountSize = config.accountSize ?? 25000;
    this.riskPerTradePct = config.riskPerTradePct ?? 0.01;    // 1% per trade
    this.maxDailyLossPct = config.maxDailyLossPct ?? 0.03;     // 3% max daily loss
    this.maxDailyTrades = config.maxDailyTrades ?? 5;          // max 5 trades per day
    this.maxPositionPct = config.maxPositionPct ?? 0.25;       // 25% of account per position
    this.lossStreakReduction = config.lossStreakReduction ?? 0.5; // halve size after 2+ losses
    this.winStreakIncrease = config.winStreakIncrease ?? 0.2;  // +20% after 3+ wins (capped at 2x)

    this._dailyPnL = 0;
    this._dailyTradeCount = 0;
    this._consecutiveWins = 0;
    this._consecutiveLosses = 0;
    this._positions = {}; // { symbol: shares }
  }

  resetDaily() {
    this._dailyPnL = 0;
    this._dailyTradeCount = 0;
    this._consecutiveWins = 0;
    this._consecutiveLosses = 0;
    this._positions = {};
  }

  /**
   * Can we take this trade? Checks all risk limits.
   * @param {Object} trade - { symbol, entryPrice, stopPrice, direction }
   * @returns {Object} { canTrade: boolean, reason: string, shares: number }
   */
  canTrade(trade) {
    // Check daily loss limit
    if (this._dailyPnL <= -this.maxDailyLossPct * this.accountSize) {
      return { canTrade: false, reason: 'DAILY_LOSS_LIMIT', shares: 0 };
    }

    // Check daily trade count
    if (this._dailyTradeCount >= this.maxDailyTrades) {
      return { canTrade: false, reason: 'MAX_DAILY_TRADES', shares: 0 };
    }

    // Calculate position size
    const positionSize = this.calculatePositionSize(trade);
    if (positionSize.shares <= 0) {
      return { canTrade: false, reason: 'POSITION_TOO_SMALL', shares: 0 };
    }

    // Check concentration
    const positionValue = positionSize.shares * trade.entryPrice;
    if (positionValue > this.maxPositionPct * this.accountSize) {
      return {
        canTrade: false,
        reason: 'POSITION_TOO_LARGE',
        shares: Math.floor((this.maxPositionPct * this.accountSize) / trade.entryPrice),
      };
    }

    return { canTrade: true, reason: null, shares: positionSize.shares };
  }

  /**
   * Calculate position size based on risk per trade.
   * Risk = (entryPrice - stopPrice) * shares = riskPerTradePct * accountSize
   */
  calculatePositionSize(trade) {
    const riskPerShare = Math.abs(trade.entryPrice - trade.stopPrice);
    if (riskPerShare < 0.01) {
      return { shares: 0, riskPerShare: 0 };
    }

    let riskAmount = this.riskPerTradePct * this.accountSize;

    // Adjust for streak
    if (this._consecutiveLosses >= 2) {
      riskAmount *= this.lossStreakReduction;
    }
    if (this._consecutiveWins >= 3) {
      riskAmount = Math.min(riskAmount * (1 + this.winStreakIncrease), riskAmount * 2);
    }

    const shares = Math.floor(riskAmount / riskPerShare);
    return { shares, riskPerShare, riskAmount };
  }

  /**
   * Record a completed trade result.
   */
  recordTrade(symbol, pnl) {
    this._dailyPnL += pnl;
    this._dailyTradeCount++;

    if (pnl >= 0) {
      this._consecutiveWins++;
      this._consecutiveLosses = 0;
    } else {
      this._consecutiveLosses++;
      this._consecutiveWins = 0;
    }
  }

  /**
   * Get current risk state.
   */
  getState() {
    return {
      dailyPnL: this._dailyPnL,
      dailyTradeCount: this._dailyTradeCount,
      dailyLossLimit: this.maxDailyLossPct * this.accountSize,
      dailyLossRemaining: (this.maxDailyLossPct * this.accountSize) + this._dailyPnL,
      consecutiveWins: this._consecutiveWins,
      consecutiveLosses: this._consecutiveLosses,
      accountSize: this.accountSize,
      riskPerTrade: this.riskPerTradePct * this.accountSize,
    };
  }
}
