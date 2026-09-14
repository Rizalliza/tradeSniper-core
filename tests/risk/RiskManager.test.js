import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RiskManager } from '../../src/risk/RiskManager.js';

test('RiskManager: calculatePositionSize scales by risk %', () => {
    const rm = new RiskManager({ accountSize: 10000, riskPerTradePct: 0.01 });
    const result = rm.calculatePositionSize(100, 98); // $2 risk per share
    assert.equal(result.shares, 50); // 1% of 10k = $100 / $2 = 50 shares
    assert.equal(result.riskAmount, 100);
    assert.equal(result.riskPct, 0.01);
});

test('RiskManager: validateSetup rejects trades 2% risk', () => {
    const rm = new RiskManager({ accountSize: 10000, riskPerTradePct: 0.02 });
    const result = rm.calculatePositionSize(200, 197); // $3 risk per share
    assert.equal(result.shares, 66); // $200 / $3 = 66.67 → 66
});

test('RiskManager: validateSetup rejects insufficient R:R', () => {
    const rm = new RiskManager({ minRiskReward: 2.0 });
    const result = rm.validateSetup(100, 99, 101); // 1:1 R:R
    assert.equal(result.valid, false);
    assert.ok(result.reason?.includes('INSUFFICIENT_RR'));
    assert.equal(result.riskReward, 1.0);
});

test('RiskManager: validateSetup accepts good R:R', () => {
    const rm = new RiskManager({ minRiskReward: 1.5 });
    const result = rm.validateSetup(100, 98, 104); // 2:1 = 2:1
    assert.equal(result.valid, true);
    assert.equal(result.riskReward, 2.0);
});

test('RiskManager: canTrade blocks after  false if zero risk', () => {
    const rm = new RiskManager();
    const result = rm.validateSetup(100, 100, 102);
    assert.equal(result.valid, false);
});

test('RiskManager: consecutive loss circuit breaker', () => {
    const rm = new RiskManager({ maxConsecutiveLosses: 3 });
    rm.recordTrade(-100);
    rm.recordTrade(-50);
    assert.equal(rm.canTrade().allowed, true);
    rm.recordTrade(-75);
    assert.equal(rm.canTrade().allowed, false);
    assert.equal(rm.canTrade().reason, 'MAX_CONSECUTIVE_LOSSES');
});

test('RiskManager: win resets consecutive loss counter', () => {
    const rm = new RiskManager({ maxConsecutiveLosses: 3 });
    rm.recordTrade(-100);
    rm.recordTrade(-50);
    rm.recordTrade(200); // win resets counter
    assert.equal(rm.getStats().consecutiveLosses, 0);
    assert.equal(rm.canTrade().allowed, true);
});

test('RiskManager: daily loss limit', () => {
    const rm = new RiskManager({ accountSize: 10000, maxDailyLossPct: 0.02 }); // 2% = $200 max
    rm.recordTrade(-100, '2025-01-01');
    assert.equal(rm.canTrade().allowed, true); // -100 > -200
    rm.recordTrade(-150, '2025-01-01');
    assert.equal(rm.canTrade().allowed, false); // -250 < -200
    assert.equal(rm.canTrade().reason, 'DAILY_LOSS_LIMIT');
});

test('RiskManager: daily reset', () => {
    const rm = new RiskManager({ accountSize: 10000, maxDailyLossPct: 0.02 });
    rm.recordTrade(-250, '2025-01-01'); // blow 2.5% > 2%
    assert.equal(rm.canTrade().allowed, false);
    rm.reset('2025-01-02'); // new day
    assert.equal(rm.canTrade().allowed, true);
    assert.equal(rm.getStats().dailyPnl, 0);
});

test('RiskManager: max trades per day', () => {
    const rm = new RiskManager({ maxTradesPerDay: 3 });
    rm.recordTrade(100, '2025-01-01');
    rm.recordTrade(50, '2025-01-01');
    assert.equal(rm.canTrade().allowed, true);
    rm.recordTrade(75, '2025-01-01');
    assert.equal(rm.canTrade().allowed, false);
    assert.equal(rm.canTrade().reason, 'MAX_TRADES_DAY');
});

test('RiskManager: calculateExpectancy', () => {
    // 60% win rate, $100 avg win, $50 avg loss
    const exp = RiskManager.calculateExpectancy(0.6, 100, 50);
    assert.equal(exp, 40); // 0.6*100 - 0.4*50 = 60 - 20 = 40
});

test('RiskManager: requiredWinRate', () => {
    // 2:1 R:R needs 33.3%
    const wr = RiskManager.requiredWinRate(2);
    assert.ok(Math.abs(wr - 1/3) < 0.001);
});

test('RiskManager: 1:1 needs 50% WR', () => {
    const wr = RiskManager.requiredWinRate(1);
    assert.equal(wr, 0.5);
});
