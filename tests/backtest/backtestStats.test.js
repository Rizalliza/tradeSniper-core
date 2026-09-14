import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BacktestStats } from '../../src/backtest/BacktestStats.js';

const sampleSetups = [
    { date: '2026-02-02', symbol: 'AAPL', status: 'WON', pnl: 200, exit_reason: 'MARKER_PROFIT' },
    { date: '2026-02-03', symbol: 'AAPL', status: 'LOST', pnl: -100, exit_reason: 'REVERSE_STOP' },
    { date: '2026-02-04', symbol: 'AAPL', status: 'WON', pnl: 150, exit_reason: 'TRAILING_STOP' },
    { date: '2026-02-05', symbol: 'TSLA', status: 'WON', pnl: 300, exit_reason: 'MARKER_PROFIT' },
    { date: '2026-02-06', symbol: 'TSLA', status: 'SKIPPED', pnl: 0, exit_reason: 'NO_MARKER_CROSS' },
    { date: '2026-02-02', symbol: 'TSLA', status: 'LOST', pnl: -80, exit_reason: 'EOD_UNFAVORABLE' },
];

test('compute counts total setups', () => {
    const stats = BacktestStats.compute(sampleSetups);
    assert.equal(stats.total_setups, 6);
});

test('compute counts taken trades', () => {
    const stats = BacktestStats.compute(sampleSetups);
    assert.equal(stats.taken, 5);
});

test('compute counts wins and losses', () => {
    const stats = BacktestStats.compute(sampleSetups);
    assert.equal(stats.wins, 3);
    assert.equal(stats.losses, 2);
});

test('compute calculates win rate', () => {
    const stats = BacktestStats.compute(sampleSetups);
    // 3 wins / 5 taken = 60%
    assert.equal(stats.win_rate, 60);
});

test('compute calculates net PnL', () => {
    const stats = BacktestStats.compute(sampleSetups);
    // 200 - 100 + 150 + 300 - 80 = 470
    assert.equal(stats.net_pnl, 470);
});

test('compute calculates profit factor', () => {
    const stats = BacktestStats.compute(sampleSetups);
    // gross profit = 650, gross loss = 180
    assert.equal(stats.gross_profit, 650);
    assert.equal(stats.gross_loss, 180);
    assert.ok(Math.abs(stats.profit_factor - 650/180) < 0.01);
});

test('compute calculates max drawdown', () => {
    const stats = BacktestStats.compute(sampleSetups);
    assert.ok(stats.max_drawdown >= 0);
});

test('compute returns equity curve', () => {
    const stats = BacktestStats.compute(sampleSetups);
    assert.ok(Array.isArray(stats.equity));
    assert.equal(stats.equity.length, 5); // 5 taken trades
    assert.equal(stats.equity[stats.equity.length - 1].cum, 470);
});

test('compute returns per-symbol breakdown', () => {
    const stats = BacktestStats.compute(sampleSetups);
    assert.ok(Array.isArray(stats.perSymbol));
    const aapl = stats.perSymbol.find(s => s.symbol === 'AAPL');
    assert.ok(aapl);
    assert.equal(aapl.wins, 2);
    assert.equal(aapl.taken, 3);
});

test('compute handles empty setups', () => {
    const stats = BacktestStats.compute([]);
    assert.equal(stats.total_setups, 0);
    assert.equal(stats.win_rate, 0);
    assert.equal(stats.net_pnl, 0);
    assert.deepEqual(stats.equity, []);
});

test('compute calculates average win and loss', () => {
    const stats = BacktestStats.compute(sampleSetups);
    assert.equal(stats.avg_win, 650/3);
    assert.equal(stats.avg_loss, 180/2);
});

test('compute calculates expectancy', () => {
    const stats = BacktestStats.compute(sampleSetups);
    // expectancy = net_pnl / taken = 470/5 = 94
    assert.equal(stats.expectancy, 94);
});

test('profit factor is Infinity with no losses', () => {
    const allWins = [
        { date: '2026-02-02', symbol: 'AAPL', status: 'WON', pnl: 100 },
        { date: '2026-02-03', symbol: 'AAPL', status: 'WON', pnl: 200 },
    ];
    const stats = BacktestStats.compute(allWins);
    assert.equal(stats.profit_factor, Infinity);
});
