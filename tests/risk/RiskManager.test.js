import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RiskManager } from '../../src/risk/RiskManager.js';

test('RiskManager initializes with defaults', () => {
    const rm = new RiskManager();
    assert.equal(rm.accountSize, 25000);
    assert.equal(rm.riskPerTradePct, 0.01);
    assert.equal(rm.maxDailyLossPct, 0.03);
    assert.equal(rm.maxDailyTrades, 5);
    assert.equal(rm.maxPositionPct, 0.25);
});

test('RiskManager accepts custom config', () => {
    const rm = new RiskManager({
        accountSize: 50000,
        riskPerTradePct: 0.02,
        maxDailyLossPct: 0.05,
        maxDailyTrades: 10,
    });
    assert.equal(rm.accountSize, 50000);
    assert.equal(rm.riskPerTradePct, 0.02);
    assert.equal(rm.maxDailyLossPct, 0.05);
    assert.equal(rm.maxDailyTrades, 10);
});

test('calculatePositionSize computes shares based on risk', () => {
    const rm = new RiskManager({ accountSize: 25000, riskPerTradePct: 0.01 });
    const result = rm.calculatePositionSize({
        entryPrice: 100,
        stopPrice: 98,
        direction: 'BUY',
    });
    // Risk per share = $2, risk amount = $250 → 125 shares
    assert.equal(result.shares, 125);
    assert.equal(result.riskPerShare, 2);
});

test('calculatePositionSize returns 0 for tiny risk', () => {
    const rm = new RiskManager({ accountSize: 25000 });
    const result = rm.calculatePositionSize({
        entryPrice: 100,
        stopPrice: 99.995, // 0.5 cent risk
        direction: 'BUY',
    });
    assert.equal(result.shares, 0);
});

test('canTrade returns canTrade=true for valid trade', () => {
    const rm = new RiskManager({ accountSize: 25000, riskPerTradePct: 0.005 });
    // risk = 0.5% of 25000 = 125, risk/share = $3 → 41 shares
    // position value = 41 * 150 = 6150, which is < 25% of 25000 = 6250
    const result = rm.canTrade({
        symbol: 'AAPL',
        entryPrice: 150,
        stopPrice: 147,
        direction: 'BUY',
    });
    assert.equal(result.canTrade, true);
    assert.ok(result.shares > 0);
});

test('canTrade blocks after max daily trades', () => {
    const rm = new RiskManager({ maxDailyTrades: 2 });
    rm._dailyTradeCount = 2;
    const result = rm.canTrade({
        symbol: 'AAPL',
        entryPrice: 150,
        stopPrice: 147,
        direction: 'BUY',
    });
    assert.equal(result.canTrade, false);
    assert.equal(result.reason, 'MAX_DAILY_TRADES');
});

test('canTrade blocks when daily loss limit reached', () => {
    const rm = new RiskManager({ accountSize: 25000, maxDailyLossPct: 0.03 });
    rm._dailyPnL = -800; // more than 3% of 25000 = -750
    const result = rm.canTrade({
        symbol: 'AAPL',
        entryPrice: 150,
        stopPrice: 147,
        direction: 'BUY',
    });
    assert.equal(result.canTrade, false);
    assert.equal(result.reason, 'DAILY_LOSS_LIMIT');
});

test('canTrade blocks oversized positions', () => {
    const rm = new RiskManager({ accountSize: 25000, maxPositionPct: 0.05 });
    // 25000 * 0.05 = $1250 max position
    // entry $100, stop $95 → risk $5, risk amount $250 → 50 shares = $5000 position
    const result = rm.canTrade({
        symbol: 'AAPL',
        entryPrice: 100,
        stopPrice: 95,
        direction: 'BUY',
    });
    assert.equal(result.canTrade, false);
    assert.equal(result.reason, 'POSITION_TOO_LARGE');
    // Suggested shares should be capped at maxPositionPct
    assert.equal(result.shares, 12); // 1250 / 100 = 12.5 → floor = 12
});

test('recordTrade updates daily PnL and streak counters', () => {
    const rm = new RiskManager();
    rm.recordTrade('AAPL', 100);
    assert.equal(rm._dailyPnL, 100);
    assert.equal(rm._dailyTradeCount, 1);
    assert.equal(rm._consecutiveWins, 1);
    assert.equal(rm._consecutiveLosses, 0);
});

test('recordTrade increments loss streak', () => {
    const rm = new RiskManager();
    rm.recordTrade('AAPL', -50);
    rm.recordTrade('AAPL', -30);
    assert.equal(rm._consecutiveLosses, 2);
    assert.equal(rm._consecutiveWins, 0);
});

test('loss streak reduces position size', () => {
    const rm = new RiskManager({ accountSize: 25000, riskPerTradePct: 0.01, lossStreakReduction: 0.5 });
    // No losses: risk = $250, risk/share = $2 → 125 shares
    const normal = rm.calculatePositionSize({ entryPrice: 100, stopPrice: 98, direction: 'BUY' });
    assert.equal(normal.shares, 125);

    // After 2 losses: risk halved = $125 → 62 shares
    rm._consecutiveLosses = 2;
    const reduced = rm.calculatePositionSize({ entryPrice: 100, stopPrice: 98, direction: 'BUY' });
    assert.equal(reduced.shares, 62);
});

test('win streak increases position size (capped at 2x)', () => {
    const rm = new RiskManager({ accountSize: 25000, riskPerTradePct: 0.01, winStreakIncrease: 0.5 });
    // Normal: 125 shares
    rm._consecutiveWins = 3;
    const increased = rm.calculatePositionSize({ entryPrice: 100, stopPrice: 98, direction: 'BUY' });
    // 250 * 1.5 = 375, / 2 = 187.5 → 187
    assert.equal(increased.shares, 187);
});

test('resetDaily clears daily state', () => {
    const rm = new RiskManager();
    rm._dailyPnL = 500;
    rm._dailyTradeCount = 3;
    rm._consecutiveWins = 3;
    rm.resetDaily();
    assert.equal(rm._dailyPnL, 0);
    assert.equal(rm._dailyTradeCount, 0);
    assert.equal(rm._consecutiveWins, 0);
});

test('getState returns current risk state', () => {
    const rm = new RiskManager({ accountSize: 25000 });
    const state = rm.getState();
    assert.equal(state.accountSize, 25000);
    assert.equal(state.dailyPnL, 0);
    assert.equal(state.dailyTradeCount, 0);
    assert.equal(state.dailyLossLimit, 750);
    assert.equal(state.dailyLossRemaining, 750);
    assert.equal(state.riskPerTrade, 250);
});
