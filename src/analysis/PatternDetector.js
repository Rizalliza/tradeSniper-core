/**
 * PatternDetector — Technical analysis pattern recognition
 *
 * Detects classic chart patterns from price action:
 * - Swing highs/lows (pivot points)
 * - Double Top / Double Bottom
 * - Head & Shoulders (regular + inverse)
 * - Cup & Handle (teacup)
 * - Trendlines (dynamic support/resistance)
 * - Reversal candles (engulfing, pin bar, hammer/shooting star)
 *
 * All patterns return confidence score (0-1) and key levels.
 */

export class PatternDetector {
    /**
     * Find swing highs and lows (pivot points)
     * @param {Array} bars - array of {high, low, close, open}
     * @param {number} leftBars - bars to left of pivot
     * @param {number} rightBars - bars to right of pivot
     * @returns {{highs: Array, lows: Array}}
     */
    static findSwings(bars, leftBars = 5, rightBars = 3) {
        const highs = [];
        const lows = [];

        for (let i = leftBars; i < bars.length - rightBars; i++) {
            const bar = bars[i];
            const leftSlice = bars.slice(i - leftBars, i);
            const rightSlice = bars.slice(i + 1, i + 1 + rightBars);

            const isSwingHigh = leftSlice.every(b => b.high < bar.high) &&
                rightSlice.every(b => b.high < bar.high);
            const isSwingLow = leftSlice.every(b => b.low > bar.low) &&
                rightSlice.every(b => b.low > bar.low);

            if (isSwingHigh) {
                highs.push({ index: i, price: bar.high, bar });
            }
            if (isSwingLow) {
                lows.push({ index: i, price: bar.low, bar });
            }
        }

        return { highs, lows };
    }

    /**
     * Detect Double Top pattern
     * Two peaks at similar level with a valley between them
     * Bearish reversal pattern
     * @returns {{pattern: string, confidence: number, neckline: number, peaks: Array, valley: object}|null}
     */
    static detectDoubleTop(bars, options = {}) {
        const peakTolerance = options.peakTolerance ?? 0.01; // 1%
        const minRetracement = options.minRetracement ?? 0.03; // 3% min pullback between peaks
        const leftBars = options.leftBars ?? 3;
        const rightBars = options.rightBars ?? 3;

        const { highs } = this.findSwings(bars, leftBars, rightBars);
        if (highs.length < 2) return null;

        // Find two adjacent highs of similar height
        for (let i = 0; i < highs.length - 1; i++) {
            const peak1 = highs[i];
            const peak2 = highs[i + 1];
            const priceDiff = Math.abs(peak1.price - peak2.price) / peak1.price;

            if (priceDiff > peakTolerance) continue;

            // Valley between the two peaks
            const valleyLow = Math.min(
                ...bars.slice(peak1.index, peak2.index + 1).map(b => b.low)
            );
            const retracement = (peak1.price - valleyLow) / peak1.price;
            if (retracement < minRetracement) continue;

            // Confidence: closer peaks = more confident; deeper valley = more confident
            const peakConf = 1 - priceDiff / peakTolerance;
            const valleyConf = Math.min(1, retracement / (minRetracement * 2));
            const confidence = (peakConf * 0.6 + valleyConf * 0.4);

            return {
                pattern: 'double_top',
                direction: 'bearish',
                confidence: Math.min(1, confidence),
                neckline: valleyLow,
                peaks: [peak1, peak2],
                valley: { price: valleyLow },
                target: valleyLow - (peak1.price - valleyLow), // measured move
            };
        }
        return null;
    }

    /**
     * Detect Double Bottom pattern (inverse of double top)
     * Bullish reversal pattern
     */
    static detectDoubleBottom(bars, options = {}) {
        const troughTolerance = options.troughTolerance ?? 0.01;
        const minRetracement = options.minRetracement ?? 0.03;
        const leftBars = options.leftBars ?? 3;
        const rightBars = options.rightBars ?? 3;

        const { lows } = this.findSwings(bars, leftBars, rightBars);
        if (lows.length < 2) return null;

        for (let i = 0; i < lows.length - 1; i++) {
            const low1 = lows[i];
            const low2 = lows[i + 1];
            const priceDiff = Math.abs(low1.price - low2.price) / low1.price;
            if (priceDiff > troughTolerance) continue;

            const peakHigh = Math.max(
                ...bars.slice(low1.index, low2.index + 1).map(b => b.high)
            );
            const retracement = (peakHigh - low1.price) / low1.price;
            if (retracement < minRetracement) continue;

            const troughConf = 1 - priceDiff / troughTolerance;
            const peakConf = Math.min(1, retracement / (minRetracement * 2));
            const confidence = (troughConf * 0.6 + peakConf * 0.4);

            return {
                pattern: 'double_bottom',
                direction: 'bullish',
                confidence: Math.min(1, confidence),
                neckline: peakHigh,
                troughs: [low1, low2],
                peak: { price: peakHigh },
                target: peakHigh + (peakHigh - low1.price),
            };
        }
        return null;
    }

    /**
     * Detect Head & Shoulders pattern (bearish)
     * Left shoulder → Head (higher) → Right shoulder (similar to left)
     * @returns {Object|null}
     */
    static detectHeadAndShoulders(bars, options = {}) {
        const shoulderTolerance = options.shoulderTolerance ?? 0.02;
        const headMinHeight = options.headMinHeight ?? 0.02;
        const leftBars = options.leftBars ?? 3;
        const rightBars = options.rightBars ?? 3;

        const { highs } = this.findSwings(bars, leftBars, rightBars);
        if (highs.length < 3) return null;

        for (let i = 0; i < highs.length - 2; i++) {
            const leftShoulder = highs[i];
            const head = highs[i + 1];
            const rightShoulder = highs[i + 2];

            // Head must be highest
            if (head.price <= leftShoulder.price || head.price <= rightShoulder.price) continue;

            // Head must be significantly higher
            const headHeight = (head.price - leftShoulder.price) / leftShoulder.price;
            if (headHeight < headMinHeight) continue;

            // Shoulders must be similar height
            const shoulderDiff = Math.abs(leftShoulder.price - rightShoulder.price) / leftShoulder.price;
            if (shoulderDiff > shoulderTolerance) continue;

            // Neckline = lowest point between the two shoulders
            const valleyLow = Math.min(
                ...bars.slice(leftShoulder.index, rightShoulder.index + 1).map(b => b.low)
            );

            // Confidence
            const shoulderConf = 1 - shoulderDiff / shoulderTolerance;
            const headConf = Math.min(1, headHeight / (headMinHeight * 2));
            const confidence = (shoulderConf * 0.5 + headConf * 0.5);

            return {
                pattern: 'head_and_shoulders',
                direction: 'bearish',
                confidence: Math.min(1, confidence),
                neckline: valleyLow,
                leftShoulder,
                head,
                rightShoulder,
                target: valleyLow - (head.price - valleyLow), // measured move from neckline
            };
        }
        return null;
    }

    /**
     * Detect Inverse Head & Shoulders (bullish)
     */
    static detectInverseHeadAndShoulders(bars, options = {}) {
        const shoulderTolerance = options.shoulderTolerance ?? 0.02;
        const headMinDepth = options.headMinDepth ?? 0.02;
        const leftBars = options.leftBars ?? 3;
        const rightBars = options.rightBars ?? 3;

        const { lows } = this.findSwings(bars, leftBars, rightBars);
        if (lows.length < 3) return null;

        for (let i = 0; i < lows.length - 2; i++) {
            const leftShoulder = lows[i];
            const head = lows[i + 1];
            const rightShoulder = lows[i + 2];

            if (head.price >= leftShoulder.price || head.price >= rightShoulder.price) continue;

            const headDepth = (leftShoulder.price - head.price) / leftShoulder.price;
            if (headDepth < headMinDepth) continue;

            const shoulderDiff = Math.abs(leftShoulder.price - rightShoulder.price) / leftShoulder.price;
            if (shoulderDiff > shoulderTolerance) continue;

            const peakHigh = Math.max(
                ...bars.slice(leftShoulder.index, rightShoulder.index + 1).map(b => b.high)
            );

            const shoulderConf = 1 - shoulderDiff / shoulderTolerance;
            const headConf = Math.min(1, headDepth / (headMinDepth * 2));
            const confidence = (shoulderConf * 0.5 + headConf * 0.5);

            return {
                pattern: 'inverse_head_and_shoulders',
                direction: 'bullish',
                confidence: Math.min(1, confidence),
                neckline: peakHigh,
                leftShoulder,
                head,
                rightShoulder,
                target: peakHigh + (peakHigh - head.price),
            };
        }
        return null;
    }

    /**
     * Detect Cup & Handle pattern (teacup)
     * Rounded bottom (cup) followed by shallow pullback (handle)
     * Bullish continuation pattern
     */
    static detectCupAndHandle(bars, options = {}) {
        const cupDepthMin = options.cupDepthMin ?? 0.08; // min 8% cup depth
        const cupDepthMax = options.cupDepthMax ?? 0.40; // max 40%
        const handleMaxDepth = options.handleMaxDepth ?? 0.15; // handle < 15% of cup
        const minCupBars = options.minCupBars ?? 20;
        const leftBars = options.leftBars ?? 3;
        const rightBars = options.rightBars ?? 3;

        const { highs, lows } = this.findSwings(bars, leftBars, rightBars);
        if (highs.length < 2 || lows.length < 1) return null;

        // Look for two highs forming the cup rim
        for (let i = 0; i < highs.length - 1; i++) {
            const leftRim = highs[i];
            const rightRim = highs[i + 1];

            // Similar height rims
            const rimDiff = Math.abs(leftRim.price - rightRim.price) / leftRim.price;
            if (rimDiff > 0.05) continue; // 5% max rim difference

            // Enough bars between rims for a cup
            const cupWidth = rightRim.index - leftRim.index;
            if (cupWidth < minCupBars) continue;

            // Cup bottom (lowest point between rims)
            const cupBars = bars.slice(leftRim.index, rightRim.index + 1);
            const cupBottom = Math.min(...cupBars.map(b => b.low));
            const cupDepth = (leftRim.price - cupBottom) / leftRim.price;

            if (cupDepth < cupDepthMin || cupDepth > cupDepthMax) continue;

            // Handle = pullback from right rim, shallow
            // Look at bars after right rim
            const afterRim = bars.slice(rightRim.index, Math.min(bars.length, rightRim.index + 20));
            if (afterRim.length < 5) continue;

            const handleLow = Math.min(...afterRim.map(b => b.low));
            const handleDepth = (rightRim.price - handleLow) / (rightRim.price - cupBottom);
            if (handleDepth > handleMaxDepth) continue;

            const rimConf = 1 - rimDiff / 0.05;
            const cupConf = Math.min(1, (cupDepth - cupDepthMin) / (cupDepthMax - cupDepthMin));
            const handleConf = 1 - handleDepth / handleMaxDepth;
            const confidence = (rimConf * 0.3 + cupConf * 0.4 + handleConf * 0.3);

            return {
                pattern: 'cup_and_handle',
                direction: 'bullish',
                confidence: Math.min(1, confidence),
                leftRim,
                rightRim,
                cupBottom: cupBottom,
                cupDepth: cupDepth,
                handleLow: handleLow,
                handleDepth: handleDepth,
                breakoutLevel: rightRim.price,
                target: rightRim.price + cupDepth * rightRim.price, // measured move
            };
        }
        return null;
    }

    /**
     * Calculate trendline from swing points
     * Uses linear regression on recent swing highs/lows
     * @returns {{slope: number, intercept: number, rSquared: number}}
     */
    static calculateTrendline(points) {
        if (points.length < 2) return null;

        const n = points.length;
        let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;

        for (const p of points) {
            const x = p.index ?? p.x;
            const y = p.price ?? p.y;
            sumX += x;
            sumY += y;
            sumXY += x * y;
            sumX2 += x * x;
            sumY2 += y * y;
        }

        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;

        // R-squared
        const meanY = sumY / n;
        let ssTotal = 0, ssResidual = 0;
        for (const p of points) {
            const x = p.index ?? p.x;
            const y = p.price ?? p.y;
            const predicted = slope * x + intercept;
            ssResidual += (y - predicted) ** 2;
            ssTotal += (y - meanY) ** 2;
        }
        const rSquared = ssTotal > 0 ? 1 - ssResidual / ssTotal : 0;

        return { slope, intercept, rSquared, points: n };
    }

    /**
     * Detect trendline breakout
     * @param {Array} bars
     * @param {string} direction - 'resistance' (break UP) or 'support' (break DOWN)
     * @param {number} lookback - bars to look back for trendline
     * @returns {{broken: boolean, level: number, slope: number, barIndex: number}|null}
     */
    static detectTrendlineBreakout(bars, direction = 'resistance', lookback = 30) {
        const recentBars = bars.slice(-lookback);
        if (recentBars.length < 10) return null;

        // Find swing points for the trendline
        const swings = this.findSwings(recentBars, 3, 2);
        const points = direction === 'resistance' ? swings.highs : swings.lows;
        if (points.length < 3) return null;

        const trendline = this.calculateTrendline(points);
        if (!trendline || trendline.rSquared < 0.3) return null;

        // Check if last bar breaks the trendline
        const lastBar = recentBars[recentBars.length - 1];
        const currentLevel = trendline.slope * (recentBars.length - 1) + trendline.intercept;

        const broken = direction === 'resistance'
            ? lastBar.close > currentLevel
            : lastBar.close < currentLevel;

        // Confirmation: body close beyond line
        if (broken) {
            return {
                broken: true,
                direction: direction === 'resistance' ? 'bullish' : 'bearish',
                level: currentLevel,
                slope: trendline.slope,
                rSquared: trendline.rSquared,
                barIndex: bars.length - 1,
                confidence: trendline.rSquared,
            };
        }
        return null;
    }

    /**
     * Detect reversal candle patterns
     * @param {Object} bar - current bar
     * @param {Object} prevBar - previous bar
     * @returns {Array} array of detected patterns
     */
    static detectCandlePatterns(bar, prevBar) {
        const patterns = [];
        const body = Math.abs(bar.close - bar.open);
        const range = bar.high - bar.low;
        const upperWick = bar.high - Math.max(bar.open, bar.close);
        const lowerWick = Math.min(bar.open, bar.close) - bar.low;

        // Engulfing (bullish)
        if (prevBar && prevBar.close < prevBar.open &&
            bar.close > bar.open &&
            bar.open < prevBar.close &&
            bar.close > prevBar.open) {
            patterns.push({ pattern: 'bullish_engulfing', confidence: 0.7, direction: 'bullish' });
        }
        // Engulfing (bearish)
        if (prevBar && prevBar.close > prevBar.open &&
            bar.close < bar.open &&
            bar.open > prevBar.close &&
            bar.close < prevBar.open) {
            patterns.push({ pattern: 'bearish_engulfing', confidence: 0.7, direction: 'bearish' });
        }

        // Pin bar / Hammer (long lower wick, small body)
        if (body < range * 0.3 && lowerWick > body * 2 && upperWick < body * 1.5) {
            if (bar.close > bar.open) {
                patterns.push({ pattern: 'hammer', confidence: 0.6, direction: 'bullish' });
            } else {
                patterns.push({ pattern: 'hanging_man', confidence: 0.5, direction: 'bearish' });
            }
        }
        // Shooting star (long upper wick, small body, bearish)
        if (body < range * 0.3 && upperWick > body * 2 && lowerWick < body * 1.5) {
            patterns.push({ pattern: 'shooting_star', confidence: 0.65, direction: 'bearish' });
        }
        // Inverted hammer (long upper wick, bullish reversal)
        if (body < range * 0.3 && upperWick > body * 2 && lowerWick < body * 1.5 && bar.close > bar.open) {
            patterns.push({ pattern: 'inverted_hammer', confidence: 0.55, direction: 'bullish' });
        }

        // Doji (very small body)
        if (body < range * 0.1) {
            patterns.push({ pattern: 'doji', confidence: 0.5, direction: 'neutral' });
        }

        return patterns;
    }

    /**
     * Scan bars for all patterns
     * @param {Array} bars
     * @param {Object} options
     * @returns {Array} all detected patterns with confidence
     */
    static scan(bars, options = {}) {
        const results = [];

        if (bars.length < 20) return results;

        const dt = this.detectDoubleTop(bars, options);
        if (dt) results.push(dt);

        const db = this.detectDoubleBottom(bars, options);
        if (db) results.push(db);

        const hs = this.detectHeadAndShoulders(bars, options);
        if (hs) results.push(hs);

        const ihs = this.detectInverseHeadAndShoulders(bars, options);
        if (ihs) results.push(ihs);

        const ch = this.detectCupAndHandle(bars, options);
        if (ch) results.push(ch);

        const tlUp = this.detectTrendlineBreakout(bars, 'resistance', options.trendlineLookback);
        if (tlUp) results.push({ pattern: 'trendline_breakout', ...tlUp });

        const tlDown = this.detectTrendlineBreakout(bars, 'support', options.trendlineLookback);
        if (tlDown) results.push({ pattern: 'trendline_breakdown', ...tlDown });

        // Candle patterns on last bar
        if (bars.length >= 2) {
            const candlePatterns = this.detectCandlePatterns(
                bars[bars.length - 1],
                bars[bars.length - 2]
            );
            results.push(...candlePatterns);
        }

        return results.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    }
}
