/**
 * RiskManager — Enforces risk discipline across all strategies
 *
 * Core problem: 83% win rate but still losing money happens because
 * average loss > average win. This module ensures every trade has a
 * defined risk:reward ratio and consistent position sizing.
 *
 * Rules:
 * 1. Every trade must have a stop loss (no undefined risk)
 * 2. Every trade must have a target that gives positive expectancy
 * 3. Risk equal dollar amount per trade (% of account)
 * 4. Max drawdown circuit breaker
 * 5. Consecutive loss circuit breaker
 */

export class RiskManager {
    constructor(config = {}) {
        this.riskPerTradePct = config.riskPerTradePct ?? 0.01;       // 1% risk per trade
        this.minRiskReward = config.minRiskReward ?? 1.5;           // min 1.5:1 R:R to take a trade
        this.accountSize = config.accountSize ?? 10000;             // base account
        this.maxDailyLossPct = config.maxDailyLossPct ?? 0.03;      // 3% max daily loss
        this.maxConsecutiveLosses = config.maxConsecutiveLosses ?? 4; // 4 losses in a row = pause
        this.maxTradesPerDay = config.maxTradesPerDay ?? 5;         // max 5 trades per day
        
        this._dailyPnl = 0;
        this._consecutiveLosses = 0;
        this._tradesToday = 0;
        this._currentDay = null;
        this._blocked = false;
        this._blockReason = null;
    }

    reset(day = null) {
        if (day !== this._currentDay) {
            this._dailyPnl = 0;
            this._tradesToday = 0;
            this._currentDay = day;
            if (this._blocked && (this._blockReason === 'DAILY_LIMIT' || this._blockReason === 'DAILY_LOSS_LIMIT' || this._blockReason === 'MAX_TRADES_DAY')) {
                this._blocked = false;
                this._blockReason = null;
            }
        }
    }

    /**
     * Check if trading is currently allowed
     * @returns {Object} { allowed: boolean, reason: string|null }
     */
    canTrade() {
        if (this._blocked) {
            return { allowed: false, reason: this._blockReason };
        }
        if (this._tradesToday >= this.maxTradesPerDay) {
            return { allowed: false, reason: 'MAX_TRADES_DAY' };
        }
        if (this._consecutiveLosses >= this.maxConsecutiveLosses) {
            return { allowed: false, reason: 'MAX_CONSECUTIVE_LOSSES' };
        }
        if (this._dailyPnl <= -this.accountSize * this.maxDailyLossPct) {
            return { allowed: false, reason: 'DAILY_LOSS_LIMIT' };
        }
        return { allowed: true, reason: null };
    }

    /**
     * Calculate position size based on risk per trade
     * @param {number} entryPrice
     * @param {number} stopPrice
     * @returns {Object} { shares, riskAmount, riskPct }
     */
    calculatePositionSize(entryPrice, stopPrice) {
        const riskAmount = this.accountSize * this.riskPerTradePct;
        const priceRisk = Math.abs(entryPrice - stopPrice);
        if (priceRisk <= 0) return { shares: 0, riskAmount: 0, riskPct: 0 };
        
        const shares = Math.floor(riskAmount / priceRisk);
        const actualRisk = shares * priceRisk;
        const actualRiskPct = actualRisk / this.accountSize;
        
        return {
            shares: Math.max(0, shares),
            riskAmount: actualRisk,
            riskPct: actualRiskPct,
        };
    }

    /**
     * Validate a trade setup — does it meet minimum R:R?
     * @param {number} entryPrice
     * @param {number} stopPrice
     * @param {number} targetPrice
     * @returns {Object} { valid: boolean, riskReward: number, reason: string|null }
     */
    validateSetup(entryPrice, stopPrice, targetPrice) {
        const risk = Math.abs(entryPrice - stopPrice);
        const reward = Math.abs(targetPrice - entryPrice);
        
        if (risk <= 0) {
            return { valid: false, riskReward: 0, reason: 'NO_STOP_DISTANCE' };
        }
        if (reward <= 0) {
            return { valid: false, riskReward: 0, reason: 'NO_TARGET_DISTANCE' };
        }
        
        const rr = reward / risk;
        if (rr < this.minRiskReward) {
            return { 
                valid: false, 
                riskReward: rr, 
                reason: `INSUFFICIENT_RR (${rr.toFixed(2)} < ${this.minRiskReward})` 
            };
        }
        
        return { valid: true, riskReward: rr, reason: null };
    }

    /**
     * Record a completed trade for tracking
     * @param {number} pnl - profit/loss in dollars
     * @param {string} day - date string
     */
    recordTrade(pnl, day = null) {
        if (day && day !== this._currentDay) {
            this.reset(day);
        }
        
        this._tradesToday++;
        this._dailyPnl += pnl;
        
        if (pnl < 0) {
            this._consecutiveLosses++;
            if (this._consecutiveLosses >= this.maxConsecutiveLosses) {
                this._blocked = true;
                this._blockReason = 'MAX_CONSECUTIVE_LOSSES';
            }
        } else {
            this._consecutiveLosses = 0;
        }
        
        if (this._dailyPnl <= -this.accountSize * this.maxDailyLossPct) {
            this._blocked = true;
            this._blockReason = 'DAILY_LOSS_LIMIT';
        }
    }

    /**
     * Calculate the expectancy of a trade setup
     * @param {number} winRate - decimal (e.g. 0.6 for 60%)
     * @param {number} avgWin
     * @param {number} avgLoss - positive number (loss amount)
     * @returns {number} expectancy per trade
     */
    static calculateExpectancy(winRate, avgWin, avgLoss) {
        return (winRate * avgWin) - ((1 - winRate) * avgLoss);
    }

    /**
     * Calculate required win rate for profitability
     * @param {number} riskReward - e.g. 2 for 2:1
     * @returns {number} required win rate (decimal)
     */
    static requiredWinRate(riskReward) {
        return 1 / (riskReward + 1);
    }

    getStats() {
        return {
            dailyPnl: this._dailyPnl,
            tradesToday: this._tradesToday,
            consecutiveLosses: this._consecutiveLosses,
            blocked: this._blocked,
            blockReason: this._blockReason,
            riskPerTradePct: this.riskPerTradePct,
            minRiskReward: this.minRiskReward,
        };
    }
}
