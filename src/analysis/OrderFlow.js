/**
 * OrderFlow — Volume analysis, false breakout detection, liquidity patterns
 *
 * Analyzes volume-price relationship to detect:
 * - False breakouts (breaks level but closes back inside, low volume)
 * - Liquidity grabs (stop runs - quick spike then reversal)
 * - Volume divergence (price makes new high/low but volume doesn't confirm)
 * - Volume profile analysis (POC, value area, high/low volume nodes)
 * - Absorption (high volume but no price progress)
 * - Climactic volume (exhaustion)
 */

export class OrderFlow {
    /**
     * Detect false breakout
     * Price breaks a key level but closes back inside it, often on lower volume
     *
     * @param {Array} bars - price bars
     * @param {number} level - key level (support/resistance)
     * @param {string} direction - 'up' (break resistance) or 'down' (break support)
     * @returns {{isFalseBreakout: boolean, confidence: number, reason: string}}
     */
    static detectFalseBreakout(bars, level, direction = 'up') {
        if (bars.length < 5) return { isFalseBreakout: false, confidence: 0, reason: 'not enough data' };

        const recent = bars.slice(-5);
        const breakoutBar = recent.find(b =>
            direction === 'up' ? b.high > level : b.low < level
        );
        if (!breakoutBar) return { isFalseBreakout: false, confidence: 0, reason: 'no breakout' };

        const closeBeyond = direction === 'up'
            ? breakoutBar.close > level
            : breakoutBar.close < level;

        // Calculate average volume for comparison
        const avgVolume = bars.slice(-20).reduce((s, b) => s + (b.volume || 0), 0) / 20;
        const breakoutVolume = breakoutBar.volume || 0;
        const volumeRatio = avgVolume > 0 ? breakoutVolume / avgVolume : 1;

        // Scoring
        let score = 0;
        let reasons = [];

        // Close back inside level = strong false breakout signal
        if (!closeBeyond) {
            score += 40;
            reasons.push('closes back inside level');
        }

        // Low volume on breakout = weak conviction
        if (volumeRatio < 0.8) {
            score += 30;
            reasons.push(`low volume (${volumeRatio.toFixed(2)}x avg)`);
        } else if (volumeRatio < 1.2) {
            score += 15;
            reasons.push(`average volume (${volumeRatio.toFixed(2)}x avg)`);
        }

        // Small body = indecision
        const bodyRatio = Math.abs(breakoutBar.close - breakoutBar.open) / (breakoutBar.high - breakoutBar.low);
        if (bodyRatio < 0.3) {
            score += 20;
            reasons.push('small body (indecision)');
        }

        // Long wick beyond level = rejection
        const wickBeyond = direction === 'up'
            ? (breakoutBar.high - level) / level
            : (level - breakoutBar.low) / level;
        if (wickBeyond > 0.002 && !closeBeyond) {
            score += 10;
            reasons.push('long wick beyond level (rejection)');
        }

        // Next bar confirms reversal
        const bi = bars.indexOf(breakoutBar);
        if (bi >= 0 && bi < bars.length - 1) {
            const nextBar = bars[bi + 1];
            const reversal = direction === 'up'
                ? nextBar.close < breakoutBar.close
                : nextBar.close > breakoutBar.close;
            if (reversal) {
                score += 20;
                reasons.push('next bar confirms reversal');
            }
        }

        return {
            isFalseBreakout: score >= 50,
            confidence: Math.min(1, score / 100),
            score,
            reasons,
            breakoutBar,
            volumeRatio,
        };
    }

    /**
     * Detect liquidity grab / stop hunt
     * Quick spike beyond a key level then immediate reversal, usually on high volume
     * Often happens at obvious support/resistance where stops cluster
     *
     * @param {Array} bars
     * @param {number} level
     * @returns {{isLiquidityGrab: boolean, confidence: number, direction: string, reason: string}}
     */
    static detectLiquidityGrab(bars, level) {
        if (bars.length < 10) return { isLiquidityGrab: false, confidence: 0 };

        const avgVolume = bars.slice(-20).reduce((s, b) => s + (b.volume || 0), 0) / 20;

        // Look for bars that briefly exceed the level then reverse
        for (let i = Math.max(0, bars.length - 10); i < bars.length - 2; i++) {
            const bar = bars[i];

            // Check both directions
            for (const direction of ['up', 'down']) {
                const breached = direction === 'up' ? bar.high > level : bar.low < level;
                if (!breached) continue;

                const closeInside = direction === 'up' ? bar.close < level : bar.close > level;
                if (!closeInside) continue;

                const volumeRatio = avgVolume > 0 ? (bar.volume || 0) / avgVolume : 1;

                // Check next bars confirm reversal (continue opposite direction)
                const nextBars = bars.slice(i + 1, Math.min(i + 4, bars.length));
                if (nextBars.length < 2) continue;

                let reversalConfirmed = true;
                for (const nb of nextBars) {
                    const stillReversing = direction === 'up'
                        ? nb.close < level
                        : nb.close > level;
                    if (!stillReversing) {
                        reversalConfirmed = false;
                        break;
                    }
                }

                let score = 0;
                const reasons = [];

                if (closeInside) {
                    score += 30;
                    reasons.push('wick through level, closes inside');
                }
                if (volumeRatio >= 1.3) {
                    score += 25;
                    reasons.push(`high volume (${volumeRatio.toFixed(2)}x avg)`);
                }
                if (reversalConfirmed) {
                    score += 25;
                    reasons.push('reversal continues 3+ bars');
                }

                // Long wick relative to body
                const body = Math.abs(bar.close - bar.open);
                const totalRange = bar.high - bar.low;
                if (totalRange > 0 && body / totalRange < 0.25) {
                    score += 20;
                    reasons.push('long wick, small body (rejection candle)');
                }

                if (score >= 60) {
                    return {
                        isLiquidityGrab: true,
                        confidence: Math.min(1, score / 100),
                        direction: direction === 'up' ? 'bearish' : 'bullish',
                        score,
                        reasons,
                        level,
                        barIndex: i,
                        volumeRatio,
                    };
                }
            }
        }

        return { isLiquidityGrab: false, confidence: 0 };
    }

    /**
     * Detect volume divergence
     * Price makes new high/low but volume doesn't confirm = potential reversal
     *
     * @param {Array} bars
     * @param {number} lookback - bars to look back
     * @returns {{hasDivergence: boolean, type: string|null, confidence: number}}
     */
    static detectVolumeDivergence(bars, lookback = 20) {
        if (bars.length < lookback * 2) return { hasDivergence: false, type: null, confidence: 0 };

        const recent = bars.slice(-lookback);
        const prior = bars.slice(-lookback * 2, -lookback);

        const recentHigh = Math.max(...recent.map(b => b.high));
        const recentLow = Math.min(...recent.map(b => b.low));
        const priorHigh = Math.max(...prior.map(b => b.high));
        const priorLow = Math.min(...prior.map(b => b.low));

        const recentAvgVol = recent.reduce((s, b) => s + (b.volume || 0), 0) / recent.length;
        const priorAvgVol = prior.reduce((s, b) => s + (b.volume || 0), 0) / prior.length;

        const volRatio = priorAvgVol > 0 ? recentAvgVol / priorAvgVol : 1;

        // Bearish divergence: new high on lower volume
        if (recentHigh > priorHigh && volRatio < 0.8) {
            return {
                hasDivergence: true,
                type: 'bearish',
                confidence: Math.min(1, (1 - volRatio / 0.8)),
                details: {
                    recentHigh, priorHigh, volRatio,
                    highDiff: (recentHigh - priorHigh) / priorHigh,
                },
            };
        }

        // Bullish divergence: new low on lower volume
        if (recentLow < priorLow && volRatio < 0.8) {
            return {
                hasDivergence: true,
                type: 'bullish',
                confidence: Math.min(1, (1 - volRatio / 0.8)),
                details: {
                    recentLow, priorLow, volRatio,
                    lowDiff: (priorLow - recentLow) / priorLow,
                },
            };
        }

        return { hasDivergence: false, type: null, confidence: 0 };
    }

    /**
     * Calculate volume profile for a set of bars
     * POC (Point of Control), value area, HVN/LVN
     *
     * @param {Array} bars
     * @param {number} bins - number of price bins
     * @returns {{poc: number, valueAreaHigh: number, valueAreaLow: number, hvn: Array, lvn: Array, profile: Array}}
     */
    static calculateVolumeProfile(bars, bins = 50) {
        if (!bars.length) return null;

        let high = -Infinity, low = Infinity, totalVol = 0;
        for (const b of bars) {
            high = Math.max(high, b.high);
            low = Math.min(low, b.low);
            totalVol += b.volume || 0;
        }

        const binSize = (high - low) / bins;
        const profile = new Array(bins).fill(0);

        for (const bar of bars) {
            const vol = bar.volume || 0;
            const barRange = bar.high - bar.low;
            if (barRange === 0 || vol === 0) continue;

            // Distribute volume across the bar's range
            const startBin = Math.max(0, Math.floor((bar.low - low) / binSize));
            const endBin = Math.min(bins - 1, Math.floor((bar.high - low) / binSize));
            const volPerBin = vol / (endBin - startBin + 1);

            for (let i = startBin; i <= endBin; i++) {
                profile[i] += volPerBin;
            }
        }

        // POC = max volume bin
        let pocIndex = 0, pocVol = 0;
        for (let i = 0; i < bins; i++) {
            if (profile[i] > pocVol) {
                pocVol = profile[i];
                pocIndex = i;
            }
        }

        // Value area (70% of volume around POC)
        const targetVol = totalVol * 0.7;
        let vaHigh = pocIndex, vaLow = pocIndex;
        let vaVol = pocVol;
        let upperIdx = pocIndex + 1, lowerIdx = pocIndex - 1;

        while (vaVol < targetVol && (upperIdx < bins || lowerIdx >= 0)) {
            const upperVol = upperIdx < bins ? profile[upperIdx] : -1;
            const lowerVol = lowerIdx >= 0 ? profile[lowerIdx] : -1;

            if (upperVol >= lowerVol && upperIdx < bins) {
                vaVol += upperVol;
                vaHigh = upperIdx;
                upperIdx++;
            } else if (lowerIdx >= 0) {
                vaVol += lowerVol;
                vaLow = lowerIdx;
                lowerIdx--;
            } else break;
        }

        const pocPrice = low + pocIndex * binSize + binSize / 2;
        const vahPrice = low + vaHigh * binSize + binSize;
        const valPrice = low + vaLow * binSize;

        // Find HVN and LVN
        const avgVol = totalVol / bins;
        const hvn = [], lvn = [];
        for (let i = 0; i < bins; i++) {
            const price = low + i * binSize + binSize / 2;
            if (profile[i] > avgVol * 1.3) {
                hvn.push({ price, volume: profile[i], bin: i });
            } else if (profile[i] < avgVol * 0.5) {
                lvn.push({ price, volume: profile[i], bin: i });
            }
        }

        return {
            poc: pocPrice,
            valueAreaHigh: vahPrice,
            valueAreaLow: valPrice,
            hvn,
            lvn,
            profile: profile.map((v, i) => ({
                price: low + i * binSize + binSize / 2,
                volume: v,
            })),
            high,
            low,
            binSize,
            totalVolume: totalVol,
        };
    }

    /**
     * Detect absorption (high volume but no price progress)
     * Big effort, no result = potential reversal
     *
     * @param {Array} bars
     * @param {number} lookback
     * @returns {{isAbsorption: boolean, direction: string|null, confidence: number}}
     */
    static detectAbsorption(bars, lookback = 5) {
        if (bars.length < lookback + 5) return { isAbsorption: false, direction: null, confidence: 0 };

        const recent = bars.slice(-lookback);
        const prior = bars.slice(-lookback - 10, -lookback);

        const recentVol = recent.reduce((s, b) => s + (b.volume || 0), 0) / lookback;
        const priorVol = prior.reduce((s, b) => s + (b.volume || 0), 0) / prior.length;

        const volRatio = priorVol > 0 ? recentVol / priorVol : 1;
        const recentRange = recent[recent.length - 1].high - recent[0].low;
        const priorRange = prior[prior.length - 1].high - prior[0].low;
        const rangeRatio = priorRange > 0 ? recentRange / priorRange : 1;

        // High volume but small range = absorption
        if (volRatio > 1.5 && rangeRatio < 0.5) {
            const direction = recent[recent.length - 1].close < recent[0].open
                ? 'bearish' : 'bullish';
            const confidence = Math.min(1, (volRatio - 1) / 2 * (1 - rangeRatio / 0.5));

            return {
                isAbsorption: true,
                direction, // direction of effort that's being absorbed
                confidence,
                volRatio,
                rangeRatio,
            };
        }

        return { isAbsorption: false, direction: null, confidence: 0 };
    }

    /**
     * Detect climactic volume (blowoff top/bottom)
     * Extreme volume on a big range bar = potential exhaustion
     *
     * @param {Array} bars
     * @returns {{isClimax: boolean, direction: string|null, confidence: number}}
     */
    static detectClimacticVolume(bars) {
        if (bars.length < 10) return { isClimax: false, direction: null, confidence: 0 };

        const recent = bars.slice(-10);
        const avgVol = bars.slice(-30).reduce((s, b) => s + (b.volume || 0), 0) / 30;

        let maxVol = 0, maxVolBar = null;
        for (const b of recent) {
            if ((b.volume || 0) > maxVol) {
                maxVol = b.volume || 0;
                maxVolBar = b;
            }
        }

        if (!maxVolBar || avgVol === 0) return { isClimax: false, direction: null, confidence: 0 };

        const volRatio = maxVol / avgVol;
        const rangePct = (maxVolBar.high - maxVolBar.low) / maxVolBar.close;

        if (volRatio > 3 && rangePct > 0.03) {
            const direction = maxVolBar.close < maxVolBar.open ? 'bearish' : 'bullish';
            const confidence = Math.min(1, (volRatio - 2) / 3);

            return {
                isClimax: true,
                direction,
                confidence,
                volRatio,
                rangePct,
                bar: maxVolBar,
            };
        }

        return { isClimax: false, direction: null, confidence: 0 };
    }

    /**
     * Full order flow analysis
     * @param {Array} bars
     * @param {number} keyLevel - important support/resistance to watch
     * @returns {Object} analysis result
     */
    static analyze(bars, keyLevel = null) {
        const result = {
            signals: [],
            overall: 'neutral',
            bullishScore: 0,
            bearishScore: 0,
        };

        if (keyLevel) {
            const fb = this.detectFalseBreakout(bars, keyLevel, 'up');
            if (fb.isFalseBreakout) {
                result.signals.push({ type: 'false_breakout', ...fb });
                result.bearishScore += fb.confidence;
            }
            const fbDown = this.detectFalseBreakout(bars, keyLevel, 'down');
            if (fbDown.isFalseBreakout) {
                result.signals.push({ type: 'false_breakdown', ...fbDown });
                result.bullishScore += fbDown.confidence;
            }

            const lg = this.detectLiquidityGrab(bars, keyLevel);
            if (lg.isLiquidityGrab) {
                result.signals.push({ type: 'liquidity_grab', ...lg });
                if (lg.direction === 'bullish') result.bullishScore += lg.confidence;
                else result.bearishScore += lg.confidence;
            }
        }

        const div = this.detectVolumeDivergence(bars);
        if (div.hasDivergence) {
            result.signals.push({ type: 'volume_divergence', ...div });
            if (div.type === 'bullish') result.bullishScore += div.confidence * 0.6;
            else result.bearishScore += div.confidence * 0.6;
        }

        const absorption = this.detectAbsorption(bars);
        if (absorption.isAbsorption) {
            result.signals.push({ type: 'absorption', ...absorption });
            if (absorption.direction === 'bullish') result.bearishScore += absorption.confidence;
            else result.bullishScore += absorption.confidence;
        }

        const climax = this.detectClimacticVolume(bars);
        if (climax.isClimax) {
            result.signals.push({ type: 'climax', ...climax });
            if (climax.direction === 'bullish') result.bearishScore += climax.confidence * 0.8;
            else result.bullishScore += climax.confidence * 0.8;
        }

        result.overall = result.bullishScore > result.bearishScore + 0.3 ? 'bullish'
            : result.bearishScore > result.bullishScore + 0.3 ? 'bearish'
            : 'neutral';

        result.bullishScore = Math.min(1, result.bullishScore);
        result.bearishScore = Math.min(1, result.bearishScore);

        return result;
    }
}
