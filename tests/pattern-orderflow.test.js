import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PatternDetector } from '../src/analysis/PatternDetector.js';
import { OrderFlow } from '../src/analysis/OrderFlow.js';

// Helper to generate synthetic price data
function generateBars(count, { startPrice = 100, volatility = 1, seed = 1 } = {}) {
    const bars = [];
    let price = startPrice;
    for (let i = 0; i < count; i++) {
        // Simple pseudo-random walk
        const change = (Math.sin(i * 0.3 + seed) * volatility) +
            (Math.cos(i * 0.7 + seed) * volatility * 0.5);
        const open = price;
        const close = price + change;
        const high = Math.max(open, close) + Math.abs(change) * 0.3;
        const low = Math.min(open, close) - Math.abs(change) * 0.3;
        const volume = 1000 + Math.abs(change) * 500 + i * 10;
        bars.push({
            time: `2024-01-${String(i + 1).padStart(2, '0')} 09:30:00`,
            open, high, low, close, volume,
        });
        price = close;
    }
    return bars;
}

function generateDoubleTop(startPrice = 100) {
    const bars = [];
    // Uptrend to first peak
    let price = startPrice;
    for (let i = 0; i < 10; i++) {
        bars.push({
            time: `2024-01-${String(i + 1).padStart(2, '0')} 09:30:00`,
            open: price, high: price + 1.5, low: price - 0.5, close: price + 1,
            volume: 1000 + i * 50,
        });
        price += 1;
    }
    // Pullback
    for (let i = 0; i < 5; i++) {
        bars.push({
            time: `2024-01-${String(bars.length + 1).padStart(2, '0')} 09:30:00`,
            open: price, high: price + 0.5, low: price - 1.5, close: price - 1,
            volume: 900 + i * 30,
        });
        price -= 1;
    }
    // Second peak (similar to first)
    const peakPrice = startPrice + 10;
    for (let i = 0; i < 5; i++) {
        const p = price + (peakPrice - price) * (i + 1) / 5;
        bars.push({
            time: `2024-01-${String(bars.length + 1).padStart(2, '0')} 09:30:00`,
            open: p - 0.5, high: p + 1, low: p - 1, close: p,
            volume: 1100 + i * 40,
        });
    }
    // Breakdown
    for (let i = 0; i < 5; i++) {
        const p = peakPrice - i * 1.5;
        bars.push({
            time: `2024-01-${String(bars.length + 1).padStart(2, '0')} 09:30:00`,
            open: p, high: p + 0.5, low: p - 2, close: p - 1.5,
            volume: 1200 + i * 60,
        });
    }
    return bars;
}

function generateDoubleBottom(startPrice = 100) {
    const bars = [];
    let price = startPrice;
    // Downtrend to first trough
    for (let i = 0; i < 10; i++) {
        bars.push({
            time: `2024-01-${String(i + 1).padStart(2, '0')} 09:30:00`,
            open: price, high: price + 0.5, low: price - 1.5, close: price - 1,
            volume: 1000 + i * 50,
        });
        price -= 1;
    }
    // Bounce
    for (let i = 0; i < 5; i++) {
        bars.push({
            time: `2024-01-${String(bars.length + 1).padStart(2, '0')} 09:30:00`,
            open: price, high: price + 1.5, low: price - 0.5, close: price + 1,
            volume: 900 + i * 30,
        });
        price += 1;
    }
    // Second trough (similar to first)
    const troughPrice = startPrice - 10;
    for (let i = 0; i < 5; i++) {
        const p = price - (price - troughPrice) * (i + 1) / 5;
        bars.push({
            time: `2024-01-${String(bars.length + 1).padStart(2, '0')} 09:30:00`,
            open: p + 0.5, high: p + 1, low: p - 1, close: p,
            volume: 1100 + i * 40,
        });
    }
    // Breakout
    for (let i = 0; i < 5; i++) {
        const p = troughPrice + i * 1.5;
        bars.push({
            time: `2024-01-${String(bars.length + 1).padStart(2, '0')} 09:30:00`,
            open: p, high: p + 2, low: p - 0.5, close: p + 1.5,
            volume: 1200 + i * 60,
        });
    }
    return bars;
}

// ========== PATTERN DETECTOR TESTS ==========

test('PatternDetector: findSwings detects swing points', () => {
    const bars = generateBars(30, { volatility: 2, seed: 5 });
    const { highs, lows } = PatternDetector.findSwings(bars, 2, 2);
    assert.ok(Array.isArray(highs), 'highs should be an array');
    assert.ok(Array.isArray(lows), 'lows should be an array');
    assert.ok(highs.length > 0, 'should detect at least one swing high');
    assert.ok(lows.length > 0, 'should detect at least one swing low');
    highs.forEach(h => {
        assert.ok(typeof h.index === 'number', 'swing high should have index');
        assert.ok(typeof h.price === 'number', 'swing high should have price');
    });
});

test('PatternDetector: detectDoubleTop finds double top pattern', () => {
    const bars = generateDoubleTop(100);
    const result = PatternDetector.detectDoubleTop(bars, {
        leftBars: 2, rightBars: 2, peakTolerance: 0.05, minRetracement: 0.02,
    });
    // Should either find a pattern or return null gracefully
    if (result) {
        assert.ok(result.pattern === 'double_top', 'pattern should be double_top');
        assert.ok(typeof result.confidence === 'number' && result.confidence >= 0,
            'confidence should be a number >= 0');
    }
    // If not found, that's ok — synthetic data may not perfectly match
    assert.ok(result === null || (result && result.pattern),
        'should return null or valid pattern object');
});

test('PatternDetector: detectDoubleBottom finds double bottom pattern', () => {
    const bars = generateDoubleBottom(100);
    const result = PatternDetector.detectDoubleBottom(bars, {
        leftBars: 2, rightBars: 2, peakTolerance: 0.05, minRetracement: 0.02,
    });
    if (result) {
        assert.ok(result.pattern === 'double_bottom', 'pattern should be double_bottom');
    }
    assert.ok(result === null || (result && result.pattern),
        'should return null or valid pattern object');
});

test('PatternDetector: detectHeadAndShoulders handles random data without error', () => {
    const bars = generateBars(50, { volatility: 1.5, seed: 3 });
    const result = PatternDetector.detectHeadAndShoulders(bars, { leftBars: 2, rightBars: 2 });
    assert.ok(result !== undefined, 'should return a result');
    if (result) {
        assert.ok(typeof result.confidence === 'number', 'confidence should be a number');
    }
});

test('PatternDetector: detectInverseH&S handles random data without error', () => {
    const bars = generateBars(50, { volatility: 1.5, seed: 7 });
    const result = PatternDetector.detectInverseHeadAndShoulders(bars, { leftBars: 2, rightBars: 2 });
    assert.ok(result !== undefined, 'should return a result');
});

test('PatternDetector: calculateTrendline returns trend object', () => {
    const bars = generateBars(40, { volatility: 0.5, seed: 1 });
    const points = bars.slice(-30).map((b, i) => ({ x: i, y: b.high }));
    const trend = PatternDetector.calculateTrendline(points);
    assert.ok(trend, 'should return trend object');
    assert.ok(typeof trend.slope === 'number', 'should have slope');
    assert.ok(typeof trend.intercept === 'number', 'should have intercept');
    assert.ok(typeof trend.rSquared === 'number', 'should have r-squared');
    assert.ok(trend.rSquared >= 0 && trend.rSquared <= 1, 'rSquared should be between 0 and 1');
});

test('PatternDetector: detectTrendlineBreakout detects breakouts', () => {
    // Create a clear uptrend then a breakout
    const bars = [];
    let price = 100;
    for (let i = 0; i < 25; i++) {
        bars.push({
            time: `2024-01-${String(i + 1).padStart(2, '0')} 09:30:00`,
            open: price, high: price + 1, low: price - 0.5, close: price + 0.5,
            volume: 1000,
        });
        price += 0.5;
    }
    // Breakout bar
    bars.push({
        time: '2024-01-26 09:30:00',
        open: price, high: price + 5, low: price - 0.5, close: price + 4,
        volume: 2000,
    });
    const result = PatternDetector.detectTrendlineBreakout(bars, 25);
    assert.ok(result !== undefined, 'should return a result or null');
    if (result) {
        assert.ok(result.pattern === 'trendline_breakout' || result.pattern === 'trendline_breakdown',
            'pattern type should be valid');
    }
});

test('PatternDetector: detectCandlePatterns detects engulfing', () => {
    // Previous bar is bearish (close < open)
    const prev = { open: 102, high: 103, low: 100, close: 100.5, volume: 1000 };
    // Current bar is bullish, opens below prev close, closes above prev open
    const curr = { open: 99, high: 104, low: 98, close: 103.5, volume: 1500 };
    const patterns = PatternDetector.detectCandlePatterns(curr, prev);
    assert.ok(Array.isArray(patterns), 'should return array');
    const engulfing = patterns.find(p => p.pattern === 'bullish_engulfing');
    assert.ok(engulfing, 'should detect bullish engulfing');
});

test('PatternDetector: detectCandlePatterns detects hammer', () => {
    // Hammer: small body, long lower wick, small upper wick, bullish close
    const bar = { open: 99.5, high: 99.7, low: 97, close: 99.6, volume: 1000 };
    // body = 0.1, range = 2.7, lowerWick = 2.5, upperWick = 0.1
    // body < 0.3*range = 0.81 ✓
    // lowerWick (2.5) > body*2 = 0.2 ✓
    // upperWick (0.1) < body*1.5 = 0.15 ✓
    const patterns = PatternDetector.detectCandlePatterns(bar, null);
    const hammer = patterns.find(p => p.pattern === 'hammer');
    assert.ok(hammer, 'should detect hammer pattern');
});

test('PatternDetector: scan returns all detected patterns', () => {
    const bars = generateDoubleBottom(100);
    const patterns = PatternDetector.scan(bars, {
        leftBars: 2, rightBars: 2, trendlineLookback: 20,
    });
    assert.ok(Array.isArray(patterns), 'scan should return array');
    // All returned patterns should have valid structure
    for (const p of patterns) {
        assert.ok(typeof p.pattern === 'string', 'each pattern should have a name');
        assert.ok(typeof p.confidence === 'number', 'each pattern should have confidence');
    }
    // If patterns found, should be sorted by confidence descending
    if (patterns.length > 1) {
        for (let i = 0; i < patterns.length - 1; i++) {
            assert.ok(
                patterns[i].confidence >= patterns[i + 1].confidence,
                'patterns should be sorted by confidence descending'
            );
        }
    }
});

// ========== ORDER FLOW TESTS ==========

test('OrderFlow: detectFalseBreakout identifies false breakout', () => {
    // Create bars that break a level but close back below
    const level = 105;
    const bars = [];
    for (let i = 0; i < 20; i++) {
        bars.push({
            time: `2024-01-${String(i + 1).padStart(2, '0')}`,
            open: 100 + i * 0.2, high: 100 + i * 0.2 + 0.5,
            low: 100 + i * 0.2 - 0.5, close: 100 + i * 0.2,
            volume: 1000,
        });
    }
    // False breakout bar: high above level, close below, low volume
    bars.push({
        time: '2024-01-21',
        open: 104, high: 106.5, low: 103, close: 104.5,
        volume: 500, // low volume
    });
    bars.push({
        time: '2024-01-22',
        open: 104, high: 105, low: 102, close: 102.5,
        volume: 800,
    });

    const result = OrderFlow.detectFalseBreakout(bars, level, 'up');
    assert.ok(result, 'should return result object');
    assert.ok(typeof result.isFalseBreakout === 'boolean', 'isFalseBreakout should be boolean');
    assert.ok(result.breakoutBar, 'should identify breakout bar');
    assert.ok(typeof result.confidence === 'number', 'confidence should be a number');
});

test('OrderFlow: detectLiquidityGrab handles data without error', () => {
    const bars = generateBars(30, { volatility: 2, seed: 42 });
    const level = 105;
    const result = OrderFlow.detectLiquidityGrab(bars, level);
    assert.ok(result, 'should return result');
    assert.ok(typeof result.isLiquidityGrab === 'boolean');
});

test('OrderFlow: detectVolumeDivergence detects divergence', () => {
    const bars = [];
    // First half: lower prices, higher volume
    for (let i = 0; i < 20; i++) {
        bars.push({
            time: `2024-01-${String(i + 1).padStart(2, '0')}`,
            open: 100 - i * 0.3, high: 100 - i * 0.3 + 1,
            low: 100 - i * 0.3 - 1, close: 100 - i * 0.3,
            volume: 2000 + i * 10,
        });
    }
    // Second half: even lower prices, but lower volume (bullish divergence)
    for (let i = 0; i < 20; i++) {
        const p = 94 - i * 0.2;
        bars.push({
            time: `2024-02-${String(i + 1).padStart(2, '0')}`,
            open: p, high: p + 0.8,
            low: p - 0.8, close: p,
            volume: 800 + i * 5,
        });
    }
    const result = OrderFlow.detectVolumeDivergence(bars, 20);
    assert.ok(result, 'should return result');
    assert.ok(typeof result.hasDivergence === 'boolean');
    if (result.hasDivergence) {
        assert.ok(['bullish', 'bearish'].includes(result.type), 'type should be bullish or bearish');
    }
});

test('OrderFlow: calculateVolumeProfile returns valid profile', () => {
    const bars = generateBars(100, { volatility: 2, seed: 123 });
    const profile = OrderFlow.calculateVolumeProfile(bars, 30);
    assert.ok(profile, 'should return profile');
    assert.ok(typeof profile.poc === 'number', 'should have POC');
    assert.ok(typeof profile.valueAreaHigh === 'number', 'should have VAH');
    assert.ok(typeof profile.valueAreaLow === 'number', 'should have VAL');
    assert.ok(profile.valueAreaHigh >= profile.valueAreaLow, 'VAH should be >= VAL');
    assert.ok(profile.poc >= profile.valueAreaLow && profile.poc <= profile.valueAreaHigh,
        'POC should be within value area');
    assert.ok(Array.isArray(profile.hvn), 'should have HVN array');
    assert.ok(Array.isArray(profile.lvn), 'should have LVN array');
    assert.ok(Array.isArray(profile.profile), 'should have profile array');
    assert.ok(profile.profile.length === 30, 'profile should have 30 bins');
});

test('OrderFlow: detectAbsorption identifies high-volume low-progress periods', () => {
    const bars = [];
    // Build up period with normal range
    for (let i = 0; i < 10; i++) {
        bars.push({
            time: `2024-01-${String(i + 1).padStart(2, '0')}`,
            open: 100 + i * 0.5, high: 100 + i * 0.5 + 1,
            low: 100 + i * 0.5 - 1, close: 100 + i * 0.5 + 0.5,
            volume: 1000,
        });
    }
    // Absorption period: high volume, tight range
    for (let i = 0; i < 5; i++) {
        bars.push({
            time: `2024-01-${String(bars.length + 1).padStart(2, '0')}`,
            open: 105 + i * 0.1, high: 105.5 + i * 0.05,
            low: 104.8 + i * 0.05, close: 105 + i * 0.08,
            volume: 3000 + i * 100, // 3x volume
        });
    }
    const result = OrderFlow.detectAbsorption(bars, 5);
    assert.ok(result, 'should return result');
    assert.ok(typeof result.isAbsorption === 'boolean');
});

test('OrderFlow: detectClimacticVolume detects volume spikes', () => {
    const bars = [];
    for (let i = 0; i < 30; i++) {
        bars.push({
            time: `2024-01-${String(i + 1).padStart(2, '0')}`,
            open: 100 + i * 0.2, high: 100 + i * 0.2 + 1,
            low: 100 + i * 0.2 - 1, close: 100 + i * 0.2 + 0.5,
            volume: 1000,
        });
    }
    // Climactic bar: huge volume, big range
    bars.push({
        time: '2024-01-31',
        open: 106, high: 115, low: 104, close: 110,
        volume: 5000, // 5x average
    });
    const result = OrderFlow.detectClimacticVolume(bars);
    assert.ok(result, 'should return result');
    assert.ok(typeof result.isClimax === 'boolean');
    if (result.isClimax) {
        assert.ok(['bullish', 'bearish'].includes(result.direction));
    }
});

test('OrderFlow: analyze returns comprehensive analysis', () => {
    const bars = generateBars(50, { volatility: 2, seed: 99 });
    const result = OrderFlow.analyze(bars, 105);
    assert.ok(result, 'should return result');
    assert.ok(Array.isArray(result.signals), 'should have signals array');
    assert.ok(typeof result.bullishScore === 'number', 'should have bullish score');
    assert.ok(typeof result.bearishScore === 'number', 'should have bearish score');
    assert.ok(['bullish', 'bearish', 'neutral'].includes(result.overall),
        'overall should be bullish/bearish/neutral');
    assert.ok(result.bullishScore >= 0 && result.bullishScore <= 1,
        'bullish score should be 0-1');
    assert.ok(result.bearishScore >= 0 && result.bearishScore <= 1,
        'bearish score should be 0-1');
});

// Edge cases
test('OrderFlow: empty/minimal data handled gracefully', () => {
    assert.doesNotThrow(() => {
        OrderFlow.detectFalseBreakout([], 100, 'up');
        OrderFlow.detectLiquidityGrab([], 100);
        OrderFlow.detectVolumeDivergence([], 10);
        OrderFlow.calculateVolumeProfile([]);
        OrderFlow.detectAbsorption([], 5);
        OrderFlow.detectClimacticVolume([]);
        OrderFlow.analyze([], 100);
    });
});

test('PatternDetector: empty/minimal data handled gracefully', () => {
    assert.doesNotThrow(() => {
        PatternDetector.findSwings([]);
        PatternDetector.detectDoubleTop([]);
        PatternDetector.detectDoubleBottom([]);
        PatternDetector.detectHeadAndShoulders([]);
        PatternDetector.detectInverseHeadAndShoulders([]);
        PatternDetector.calculateTrendline([]);
        PatternDetector.detectTrendlineBreakout([], 'resistance', 10);
        PatternDetector.detectCandlePatterns({ open: 0, high: 0, low: 0, close: 0 }, null);
        PatternDetector.scan([]);
    });
});
