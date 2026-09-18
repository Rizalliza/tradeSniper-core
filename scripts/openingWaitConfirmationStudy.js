#!/usr/bin/env node
/**
 * Research harness for WAIT_CONFIRMATION before opening sniper entry.
 *
 * The study finds the same cross/retest candidates as the paper trader, then
 * compares immediate entry with delayed confirmation rules. It does not change
 * live or paper execution defaults.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {
        input: 'data/pressure-pilot-2026-09-09_2026-09-15.json',
        out: 'data/opening-wait-confirmation-study-2026-09-09_2026-09-15.json',
        zonePct: 0.0015,
        retestZonePct: 0.00025,
        retestCloseZoneMultiplier: 2,
        scalpTargetPct: 0.001,
        hardStopPct: 0.001,
        runnerTriggerPct: 0.0015,
        runnerTrailPct: 0.001,
        reclaimFlipBars: 2,
        limitExpirySeconds: 60,
        exitConfirmMode: 'touch',
        exitConfirmBars: 1,
        exitConfirmPenetrationPct: 0,
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--input': opts.input = args[++i]; break;
            case '--out': opts.out = args[++i]; break;
            case '--zone-pct': opts.zonePct = Number(args[++i]); break;
            case '--retest-zone-pct': opts.retestZonePct = Number(args[++i]); break;
            case '--retest-close-zone-multiplier': opts.retestCloseZoneMultiplier = Number(args[++i]); break;
            case '--scalp-target-pct': opts.scalpTargetPct = Number(args[++i]); break;
            case '--hard-stop-pct': opts.hardStopPct = Number(args[++i]); break;
            case '--runner-trigger-pct': opts.runnerTriggerPct = Number(args[++i]); break;
            case '--runner-trail-pct': opts.runnerTrailPct = Number(args[++i]); break;
            case '--reclaim-flip-bars': opts.reclaimFlipBars = Number(args[++i]); break;
            case '--limit-expiry-seconds': opts.limitExpirySeconds = Number(args[++i]); break;
            case '--exit-confirm-mode': opts.exitConfirmMode = args[++i]; break;
            case '--exit-confirm-bars': opts.exitConfirmBars = Number(args[++i]); break;
            case '--exit-confirm-penetration-pct': opts.exitConfirmPenetrationPct = Number(args[++i]); break;
        }
    }
    return opts;
}

function normalizeBars(bars = []) {
    return bars
        .filter(b => b.time && finite(b.open) && finite(b.high) && finite(b.low) && finite(b.close))
        .map(b => ({
            symbol: b.symbol,
            date: b.date,
            time: b.time,
            open: Number(b.open),
            high: Number(b.high),
            low: Number(b.low),
            close: Number(b.close),
            volume: Number(b.volume) || 0,
        }))
        .sort((a, b) => a.time.localeCompare(b.time));
}

function findCandidate({ symbol, date, first2Bars, config }) {
    let high = null;
    let low = null;
    let prevBar = null;
    let pending = null;
    let localBias = 'NEUTRAL';
    let upPressureRun = 0;
    let downPressureRun = 0;
    const events = [];

    for (let index = 0; index < first2Bars.length; index++) {
        const bar = { ...first2Bars[index], index };
        if (index === 0) {
            high = bar.high;
            low = bar.low;
            prevBar = bar;
            continue;
        }

        const priorHigh = high;
        const priorLow = low;
        const priorMid = (priorHigh + priorLow) / 2;
        const upsidePressure = bar.high > priorHigh && bar.close > priorMid;
        const downsidePressure = bar.low < priorLow && bar.close < priorMid;
        upPressureRun = upsidePressure ? upPressureRun + 1 : 0;
        downPressureRun = downsidePressure ? downPressureRun + 1 : 0;
        if (upPressureRun >= 2) localBias = 'BULLISH';
        if (downPressureRun >= 2) localBias = 'BEARISH';

        if (!pending) {
            pending = detectCross({ prevBar, bar, high, low, index, config });
            if (pending) events.push({ type: pending.eventType, direction: pending.direction, level: pending.level, levelValue: pending.levelValue, time: bar.time });
        } else if (index !== pending.crossIndex) {
            const flip = maybeFlipReclaim(pending, bar, index, config);
            if (flip) {
                events.push(flip);
            } else {
                const retest = detectRetest(pending, bar, config);
                if (retest) {
                    return {
                        symbol,
                        date,
                        direction: pending.direction,
                        level: pending.level,
                        levelValue: pending.levelValue,
                        crossTime: pending.crossTime,
                        crossIndex: pending.crossIndex,
                        entryCandidateTime: bar.time,
                        entryCandidateIndex: index,
                        entryCandidateHigh: bar.high,
                        entryCandidateLow: bar.low,
                        entryCandidateClose: bar.close,
                        fromReclaim: pending.fromReclaim,
                        localBias,
                        dataQuality: {
                            source: 'BAR',
                            resolutionMs: 2000,
                            hasTrades: false,
                            hasQuotes: false,
                            executionCertainty: 'BAR_RESOLVED',
                        },
                        events: [...events, { type: 'RETEST_CANDIDATE', direction: pending.direction, time: bar.time, close: bar.close }],
                    };
                }
            }
        }

        high = Math.max(high, bar.high);
        low = Math.min(low, bar.low);
        prevBar = bar;
    }
    return { symbol, date, phase: pending ? 'NO_RETEST' : 'NO_CROSS', events };
}

function detectCross({ prevBar, bar, high, low, index, config }) {
    const levels = [
        { level: 'F2-H', levelValue: high },
        { level: 'F2-M', levelValue: (high + low) / 2 },
        { level: 'F2-L', levelValue: low },
    ].filter(level => finite(level.levelValue));

    for (const level of levels) {
        const zone = level.levelValue * config.zonePct;
        const crossedUp = prevBar.close <= level.levelValue + zone && bar.high > level.levelValue + zone;
        const crossedDown = prevBar.close >= level.levelValue - zone && bar.low < level.levelValue - zone;
        if (crossedUp) return {
            ...level,
            direction: 'BUY',
            eventType: 'CROSS_UP',
            crossTime: bar.time,
            crossIndex: index,
            reclaimCount: 0,
            fromReclaim: false,
        };
        if (crossedDown) return {
            ...level,
            direction: 'SELL',
            eventType: 'CROSS_DOWN',
            crossTime: bar.time,
            crossIndex: index,
            reclaimCount: 0,
            fromReclaim: false,
        };
    }
    return null;
}

function maybeFlipReclaim(pending, bar, index, config) {
    const reclaimed =
        (pending.direction === 'SELL' && bar.close > pending.levelValue) ||
        (pending.direction === 'BUY' && bar.close < pending.levelValue);
    if (!reclaimed) {
        pending.reclaimCount = 0;
        return null;
    }
    pending.reclaimCount += 1;
    if (pending.reclaimCount < config.reclaimFlipBars) return { type: 'RECLAIM_WAIT', direction: pending.direction, time: bar.time };

    const oldDirection = pending.direction;
    pending.direction = oldDirection === 'SELL' ? 'BUY' : 'SELL';
    pending.level = pending.direction === 'BUY' ? 'RECLAIM-H' : 'RECLAIM-L';
    pending.levelValue = pending.direction === 'BUY' ? bar.high : bar.low;
    pending.crossTime = bar.time;
    pending.crossIndex = index;
    pending.reclaimCount = 0;
    pending.fromReclaim = true;
    return { type: 'RECLAIM_FLIP', from: oldDirection, direction: pending.direction, level: pending.level, levelValue: round(pending.levelValue), time: bar.time };
}

function detectRetest(pending, bar, config) {
    const zone = pending.levelValue * config.retestZonePct;
    const closeZone = zone * config.retestCloseZoneMultiplier;
    if (pending.direction === 'BUY') {
        return bar.low <= pending.levelValue + zone &&
            bar.close > pending.levelValue &&
            (!pending.fromReclaim || bar.close <= pending.levelValue + closeZone);
    }
    return bar.high >= pending.levelValue - zone &&
        bar.close < pending.levelValue &&
        (!pending.fromReclaim || bar.close >= pending.levelValue - closeZone);
}

function simulatePolicy({ candidate, first2Bars, validationBars, policy, fillModel, config }) {
    if (!candidate.direction) {
        return {
            symbol: candidate.symbol,
            date: candidate.date,
            phase: candidate.phase,
            confirmation: null,
            order: null,
            fill: null,
            trade: null,
            events: candidate.events || [],
            dataQuality: candidate.dataQuality || null,
        };
    }
    const allBars = [...first2Bars, ...validationBars].map((bar, index) => ({ ...bar, index }));
    const confirmationIndex = resolveConfirmationIndex(candidate, allBars, policy);
    if (confirmationIndex == null) {
        return {
            symbol: candidate.symbol,
            date: candidate.date,
            phase: 'WAIT_CANCELLED',
            confirmation: {
                policy: policy.name,
                status: 'REJECTED',
                candidateTime: candidate.entryCandidateTime,
                reason: 'NO_CONFIRMATION_OR_LEVEL_VIOLATION',
            },
            order: null,
            fill: null,
            trade: null,
            events: [...candidate.events, { type: 'WAIT_CANCELLED', policy: policy.name }],
            dataQuality: candidate.dataQuality,
            opportunityCost: measureOpportunity({ candidate, allBars, config, startIndex: candidate.entryCandidateIndex + 1 }),
        };
    }

    const confirmationBar = allBars[confirmationIndex];
    const confirmation = {
        policy: policy.name,
        status: 'CONFIRMED',
        confirmationTime: confirmationBar.time,
        confirmationIndex,
        confirmationPrice: round(confirmationPrice(candidate, confirmationBar, policy)),
        barsWaited: confirmationIndex - candidate.entryCandidateIndex,
        levelAtConfirmation: round(candidate.levelValue),
        reason: policy.confirmBars === 0 ? 'IMMEDIATE_RETEST' : policy.type,
    };
    const order = createOrder({ candidate, confirmation, fillModel, config });
    const fill = simulateFill({ candidate, order, allBars, confirmationIndex, fillModel, config });
    if (fill.status !== 'FILLED') {
        return {
            symbol: candidate.symbol,
            date: candidate.date,
            phase: fill.status,
            confirmation,
            order,
            fill,
            trade: null,
            events: [...candidate.events, { type: fill.status, policy: policy.name, fillModel: fillModel.name, time: fill.statusTime }],
            dataQuality: candidate.dataQuality,
            opportunityCost: measureOpportunity({ candidate, allBars, config, startIndex: confirmationIndex + 1 }),
        };
    }

    const entryBar = allBars[fill.fillIndex];
    const trade = {
        symbol: candidate.symbol,
        date: candidate.date,
        direction: candidate.direction,
        entryPrice: round(fill.fillPrice),
        entryTime: entryBar.time,
        entryIndex: fill.fillIndex,
        entryReason: `${policy.name}_${fillModel.name}`,
        crossTime: candidate.crossTime,
        crossLevel: candidate.level,
        runner: false,
        bestPrice: candidate.direction === 'BUY' ? entryBar.high : entryBar.low,
        trailingStop: null,
        pendingExit: null,
        exitPrice: null,
        exitTime: null,
        exitReason: null,
        pnlPct: null,
        outcome: null,
    };

    for (let i = fill.fillIndex + 1; i < allBars.length; i++) {
        manageTrade(trade, allBars[i], config, i >= first2Bars.length);
        if (trade.exitReason) break;
    }

    if (!trade.exitReason) {
        const last = allBars.at(-1) || entryBar;
        closeTrade(trade, last.close, trade.runner ? 'RUNNER_HELD_TO_END' : 'UNRESOLVED_WINDOW_END', last.time);
    }
    trade.excursion = measureOpportunity({ candidate, allBars, config, startIndex: fill.fillIndex, referencePrice: fill.fillPrice });
    return {
        symbol: candidate.symbol,
        date: candidate.date,
        phase: 'CLOSED',
        confirmation,
        order,
        fill,
        trade,
        events: candidate.events,
        dataQuality: candidate.dataQuality,
    };
}

function resolveConfirmationIndex(candidate, bars, policy) {
    if (policy.confirmBars === 0) return candidate.entryCandidateIndex;
    const start = candidate.entryCandidateIndex;
    const max = Math.min(bars.length - 1, start + policy.confirmBars);
    for (let i = start + 1; i <= max; i++) {
        const bar = bars[i];
        if (violated(candidate, bar)) return null;
        if (confirmed(candidate, bar, policy)) return i;
    }
    return null;
}

function createOrder({ candidate, confirmation, fillModel, config }) {
    const orderCreatedIndex = confirmation.confirmationIndex;
    const requestedPrice = fillModel.name === 'WAIT_MARKET'
        ? confirmation.confirmationPrice
        : fillModel.name === 'WAIT_STOP_CONFIRM'
            ? (candidate.direction === 'BUY' ? candidate.entryCandidateHigh : candidate.entryCandidateLow)
            : candidate.levelValue;
    return {
        orderId: `${candidate.symbol}-${candidate.date}-${confirmation.policy}-${fillModel.name}`,
        confirmationPolicy: confirmation.policy,
        fillModel: fillModel.name,
        symbol: candidate.symbol,
        direction: candidate.direction,
        signalTime: candidate.entryCandidateTime,
        confirmationTime: confirmation.confirmationTime,
        orderCreatedTime: confirmation.confirmationTime,
        orderCreatedIndex,
        requestedPrice: round(requestedPrice),
        expirySeconds: fillModel.expirySeconds ?? null,
        status: 'PENDING',
    };
}

function simulateFill({ candidate, order, allBars, confirmationIndex, fillModel, config }) {
    if (fillModel.name === 'IMMEDIATE') {
        return fillAt({
            status: 'FILLED',
            fillIndex: candidate.entryCandidateIndex,
            fillPrice: candidate.levelValue,
            reason: 'IMMEDIATE_RETEST_LEVEL',
            certainty: 'BAR_RESOLVED',
            allBars,
        });
    }

    if (fillModel.name === 'WAIT_MARKET') {
        const bar = allBars[confirmationIndex];
        return fillAt({
            status: 'FILLED',
            fillIndex: confirmationIndex,
            fillPrice: confirmationPrice(candidate, bar, { type: 'market' }),
            reason: 'CONFIRMATION_MARKET_ESTIMATE',
            certainty: bar.time >= '09:32:00' ? 'AMBIGUOUS' : 'BAR_RESOLVED',
            allBars,
        });
    }

    const expirySeconds = fillModel.expirySeconds ?? null;
    const expiryTime = Number.isFinite(expirySeconds)
        ? addSeconds(allBars[confirmationIndex].time, expirySeconds)
        : null;
    const startIndex = confirmationIndex + 1;
    for (let i = startIndex; i < allBars.length; i++) {
        const bar = allBars[i];
        if (expiryTime && bar.time > expiryTime) break;
        if (fillModel.name === 'WAIT_LIMIT_RETEST' || fillModel.name === 'WAIT_LIMIT_RETEST_WITH_EXPIRY') {
            const touched = candidate.direction === 'BUY'
                ? bar.low <= order.requestedPrice
                : bar.high >= order.requestedPrice;
            if (touched) {
                return fillAt({
                    status: 'FILLED',
                    fillIndex: i,
                    fillPrice: order.requestedPrice,
                    reason: 'POST_CONFIRMATION_LIMIT_RETEST',
                    certainty: bar.time >= '09:32:00' ? 'AMBIGUOUS' : 'BAR_RESOLVED',
                    allBars,
                });
            }
        }
        if (fillModel.name === 'WAIT_STOP_CONFIRM') {
            const triggered = candidate.direction === 'BUY'
                ? bar.high >= order.requestedPrice
                : bar.low <= order.requestedPrice;
            if (triggered) {
                return fillAt({
                    status: 'FILLED',
                    fillIndex: i,
                    fillPrice: order.requestedPrice,
                    reason: 'POST_CONFIRMATION_STOP_TRIGGER',
                    certainty: bar.time >= '09:32:00' ? 'AMBIGUOUS' : 'BAR_RESOLVED',
                    allBars,
                });
            }
        }
    }

    return {
        status: expiryTime ? 'EXPIRED' : 'NO_FILL',
        statusTime: expiryTime || allBars.at(-1)?.time || order.orderCreatedTime,
        fillIndex: null,
        fillTime: null,
        fillPrice: null,
        reason: expiryTime ? 'ORDER_EXPIRED_BEFORE_PRICE_AVAILABLE' : 'POST_CONFIRMATION_PRICE_NOT_AVAILABLE',
        executionCertainty: 'BAR_RESOLVED',
    };
}

function measureOpportunity({ candidate, allBars, config, startIndex, referencePrice = candidate.levelValue }) {
    if (!candidate?.direction || !Number.isFinite(Number(referencePrice))) return null;
    let bestMove = 0;
    let worstMove = 0;
    for (let i = Math.max(0, startIndex); i < allBars.length; i++) {
        const bar = allBars[i];
        const favorablePrice = candidate.direction === 'BUY' ? bar.high : bar.low;
        const adversePrice = candidate.direction === 'BUY' ? bar.low : bar.high;
        bestMove = Math.max(bestMove, directionalPct(candidate.direction, referencePrice, favorablePrice));
        worstMove = Math.min(worstMove, directionalPct(candidate.direction, referencePrice, adversePrice));
    }
    return {
        referencePrice: round(referencePrice),
        fromIndex: startIndex,
        mfePct: round(bestMove, 6),
        maePct: round(worstMove, 6),
        wouldHaveScalped: bestMove >= config.scalpTargetPct,
        wouldHaveRunner: bestMove >= config.runnerTriggerPct,
        wouldHaveHardStopped: Math.abs(worstMove) >= config.hardStopPct,
    };
}

function directionalPct(direction, entryPrice, price) {
    const dir = direction === 'BUY' ? 1 : -1;
    return ((price - entryPrice) / entryPrice) * dir;
}

function fillAt({ status, fillIndex, fillPrice, reason, certainty, allBars }) {
    const bar = allBars[fillIndex];
    return {
        status,
        fillIndex,
        fillTime: bar.time,
        fillPrice: round(fillPrice),
        reason,
        executionCertainty: certainty,
        barResolutionMs: bar.time >= '09:32:00' ? 60000 : 2000,
    };
}

function confirmationPrice(candidate, bar, policy) {
    if (policy.type === 'close-through' || policy.type === 'hold-level' || policy.type === 'market') return bar.close;
    return candidate.levelValue;
}

function confirmed(candidate, bar, policy) {
    if (policy.type === 'close-through') {
        return candidate.direction === 'BUY'
            ? bar.close > candidate.entryCandidateHigh
            : bar.close < candidate.entryCandidateLow;
    }
    return candidate.direction === 'BUY'
        ? bar.close > candidate.levelValue && bar.low >= candidate.levelValue
        : bar.close < candidate.levelValue && bar.high <= candidate.levelValue;
}

function violated(candidate, bar) {
    return candidate.direction === 'BUY'
        ? bar.close < candidate.levelValue
        : bar.close > candidate.levelValue;
}

function manageTrade(trade, bar, config, allowRunner) {
    if (trade.pendingExit && updatePendingExit(trade, bar, config)) return;

    const stopPrice = trade.direction === 'BUY'
        ? trade.entryPrice * (1 - config.hardStopPct)
        : trade.entryPrice * (1 + config.hardStopPct);
    const stopHit = trade.direction === 'BUY' ? bar.low <= stopPrice : bar.high >= stopPrice;
    if (stopHit) {
        handleExitTouch(trade, stopPrice, trade.runner ? 'RUNNER_HARD_STOP' : 'HARD_STOP', bar, config);
        return;
    }

    updateBestPrice(trade, bar);
    if (trade.runner) {
        updateTrail(trade, config);
        const trailHit = trade.direction === 'BUY'
            ? bar.low <= trade.trailingStop
            : bar.high >= trade.trailingStop;
        if (trailHit) handleExitTouch(trade, trade.trailingStop, 'RUNNER_TRAIL', bar, config);
        return;
    }

    const targetPrice = trade.direction === 'BUY'
        ? trade.entryPrice * (1 + config.scalpTargetPct)
        : trade.entryPrice * (1 - config.scalpTargetPct);
    const targetHit = trade.direction === 'BUY' ? bar.high >= targetPrice : bar.low <= targetPrice;
    if (!targetHit) return;

    const favorablePct = pnlPct(trade, bar.close);
    if (allowRunner || favorablePct >= config.runnerTriggerPct) {
        trade.runner = true;
        updateTrail(trade, config);
        return;
    }
    closeTrade(trade, targetPrice, 'SCALP_TARGET', bar.time);
}

function updateBestPrice(trade, bar) {
    const candidate = trade.direction === 'BUY' ? bar.high : bar.low;
    const better = trade.direction === 'BUY' ? candidate > trade.bestPrice : candidate < trade.bestPrice;
    if (better) trade.bestPrice = candidate;
}

function updateTrail(trade, config) {
    trade.trailingStop = trade.direction === 'BUY'
        ? trade.bestPrice * (1 - config.runnerTrailPct)
        : trade.bestPrice * (1 + config.runnerTrailPct);
}

function closeTrade(trade, price, reason, time) {
    trade.exitPrice = round(price);
    trade.exitTime = time;
    trade.exitReason = reason;
    trade.pnlPct = round(pnlPct(trade, price), 6);
    trade.outcome = trade.pnlPct > 0 ? 'WON' : trade.pnlPct < 0 ? 'LOST' : 'BREAKEVEN';
    trade.pendingExit = null;
}

function handleExitTouch(trade, price, reason, bar, config) {
    if (config.exitConfirmMode === 'touch') {
        closeTrade(trade, price, reason, bar.time);
        return;
    }

    const touch = exitTouchState(trade, price, bar, config);
    if (exitConfirmed(touch, 1, config)) {
        closeTrade(trade, price, `${reason}_CONFIRMED`, bar.time);
        trade.exitConfirmation = {
            mode: config.exitConfirmMode,
            touchTime: bar.time,
            confirmTime: bar.time,
            penetrated: touch.penetrated,
            adverseClose: touch.adverseClose,
            touchCount: 1,
        };
        return;
    }

    trade.pendingExit = {
        reason,
        price: round(price),
        firstTouchTime: bar.time,
        lastTouchTime: bar.time,
        touchCount: 1,
        mode: config.exitConfirmMode,
    };
}

function updatePendingExit(trade, bar, config) {
    const touch = exitTouchState(trade, trade.pendingExit.price, bar, config);
    if (touch.touched) {
        trade.pendingExit.touchCount += 1;
        trade.pendingExit.lastTouchTime = bar.time;
        if (exitConfirmed(touch, trade.pendingExit.touchCount, config)) {
            const pending = trade.pendingExit;
            closeTrade(trade, pending.price, `${pending.reason}_CONFIRMED`, bar.time);
            trade.exitConfirmation = {
                mode: pending.mode,
                touchTime: pending.firstTouchTime,
                confirmTime: bar.time,
                penetrated: touch.penetrated,
                adverseClose: touch.adverseClose,
                touchCount: pending.touchCount,
            };
        }
        return true;
    }
    if (touch.recovered) {
        trade.pendingExit = null;
        return false;
    }
    return true;
}

function exitConfirmed(touch, touchCount, config) {
    if (config.exitConfirmPenetrationPct > 0 && touch.penetrated) return true;
    if (config.exitConfirmMode === 'close-through') return touch.adverseClose && touchCount >= config.exitConfirmBars;
    if (config.exitConfirmMode === 'penetration') return false;
    return touch.adverseClose && touchCount >= config.exitConfirmBars;
}

function exitTouchState(trade, price, bar, config) {
    const penetration = price * config.exitConfirmPenetrationPct;
    if (trade.direction === 'BUY') {
        return {
            touched: bar.low <= price,
            penetrated: bar.low <= price - penetration,
            adverseClose: bar.close <= price,
            recovered: bar.close > price,
        };
    }
    return {
        touched: bar.high >= price,
        penetrated: bar.high >= price + penetration,
        adverseClose: bar.close >= price,
        recovered: bar.close < price,
    };
}

function pnlPct(trade, price) {
    return directionalPct(trade.direction, trade.entryPrice, price);
}

function summarize(results) {
    const trades = results.filter(row => row.trade);
    const noTradeWithOpportunity = results.filter(row => !row.trade && row.opportunityCost);
    const wins = trades.filter(row => row.trade.outcome === 'WON').length;
    const losses = trades.filter(row => row.trade.outcome === 'LOST').length;
    const totalPnlPct = trades.reduce((sum, row) => sum + (row.trade.pnlPct || 0), 0);
    const avgNoTradeMfePct = average(noTradeWithOpportunity, row => row.opportunityCost.mfePct);
    const avgNoTradeMaePct = average(noTradeWithOpportunity, row => row.opportunityCost.maePct);
    const confirmed = results.filter(row => row.confirmation?.status === 'CONFIRMED').length;
    const filled = results.filter(row => row.fill?.status === 'FILLED').length;
    return {
        sessions: results.length,
        candidates: results.filter(row => row.phase !== 'NO_CROSS' && row.phase !== 'NO_RETEST').length,
        confirmed,
        filled,
        entries: trades.length,
        cancelled: results.filter(row => row.phase === 'WAIT_CANCELLED').length,
        noFill: results.filter(row => row.phase === 'NO_FILL').length,
        expired: results.filter(row => row.phase === 'EXPIRED').length,
        wins,
        losses,
        winRate: wins + losses ? wins / (wins + losses) : null,
        fillRate: confirmed ? filled / confirmed : null,
        avgPnlPct: trades.length ? totalPnlPct / trades.length : 0,
        avgPnlPctPerCandidate: results.length ? totalPnlPct / results.length : 0,
        totalPnlPct,
        hardStops: trades.filter(row => row.trade.exitReason?.startsWith('HARD_STOP')).length,
        runners: trades.filter(row => row.trade.runner).length,
        missedRunners: noTradeWithOpportunity.filter(row => row.opportunityCost.wouldHaveRunner).length,
        missedScalps: noTradeWithOpportunity.filter(row => row.opportunityCost.wouldHaveScalped).length,
        avgNoTradeMfePct,
        avgNoTradeMaePct,
        avgTradeMfePct: average(trades, row => row.trade.excursion?.mfePct),
        avgTradeMaePct: average(trades, row => row.trade.excursion?.maePct),
        exitReasons: countBy(trades, row => row.trade.exitReason),
        fillStatuses: countBy(results, row => row.fill?.status || row.phase),
        executionCertainty: countBy(results, row => row.fill?.executionCertainty || row.dataQuality?.executionCertainty || 'UNKNOWN'),
    };
}

function average(rows, fn) {
    const values = rows.map(fn).filter(value => Number.isFinite(Number(value)));
    return values.length ? values.reduce((sum, value) => sum + Number(value), 0) / values.length : null;
}

function countBy(rows, fn) {
    return rows.reduce((acc, row) => {
        const key = fn(row) || 'UNKNOWN';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});
}

function pct(value) {
    return value == null ? '-' : `${(value * 100).toFixed(2)}%`;
}

function finite(value) {
    return Number.isFinite(Number(value));
}

function round(value, digits = 6) {
    return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function addSeconds(time, seconds) {
    const [hh = 0, mm = 0, ss = 0] = String(time).split(':').map(Number);
    const total = hh * 3600 + mm * 60 + ss + seconds;
    const h = String(Math.floor(total / 3600)).padStart(2, '0');
    const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
    const s = String(total % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
}

async function main() {
    const opts = parseArgs();
    const config = {
        zonePct: opts.zonePct,
        retestZonePct: opts.retestZonePct,
        retestCloseZoneMultiplier: opts.retestCloseZoneMultiplier,
        scalpTargetPct: opts.scalpTargetPct,
        hardStopPct: opts.hardStopPct,
        runnerTriggerPct: opts.runnerTriggerPct,
        runnerTrailPct: opts.runnerTrailPct,
        reclaimFlipBars: opts.reclaimFlipBars,
        limitExpirySeconds: opts.limitExpirySeconds,
        exitConfirmMode: opts.exitConfirmMode,
        exitConfirmBars: opts.exitConfirmBars,
        exitConfirmPenetrationPct: opts.exitConfirmPenetrationPct,
    };
    const policies = [
        { name: 'IMMEDIATE', confirmBars: 0, type: 'immediate' },
        { name: 'WAIT_1_CLOSE_THROUGH', confirmBars: 1, type: 'close-through' },
        { name: 'WAIT_2_CLOSE_THROUGH', confirmBars: 2, type: 'close-through' },
        { name: 'WAIT_1_HOLD_LEVEL', confirmBars: 1, type: 'hold-level' },
        { name: 'WAIT_2_HOLD_LEVEL', confirmBars: 2, type: 'hold-level' },
    ];
    const fillModels = [
        { name: 'IMMEDIATE', appliesTo: policy => policy.name === 'IMMEDIATE' },
        { name: 'WAIT_MARKET', appliesTo: policy => policy.name !== 'IMMEDIATE' },
        { name: 'WAIT_LIMIT_RETEST', appliesTo: policy => policy.name !== 'IMMEDIATE' },
        { name: 'WAIT_LIMIT_RETEST_WITH_EXPIRY', expirySeconds: opts.limitExpirySeconds, appliesTo: policy => policy.name !== 'IMMEDIATE' },
        { name: 'WAIT_STOP_CONFIRM', expirySeconds: opts.limitExpirySeconds, appliesTo: policy => policy.name !== 'IMMEDIATE' },
    ];

    const payload = JSON.parse(await fs.readFile(opts.input, 'utf8'));
    const packs = [];
    for (const symbolPack of payload.results || []) {
        for (const pack of symbolPack.packs || []) {
            const first2Bars = normalizeBars(pack.bars?.open_first_2_min_aggregated_seconds || []);
            const validationBars = normalizeBars(pack.bars?.open_aggregated_seconds || []);
            packs.push({
                symbol: pack.symbol,
                date: pack.date,
                first2Bars,
                validationBars,
                candidate: findCandidate({ symbol: pack.symbol, date: pack.date, first2Bars, config }),
            });
        }
    }

    const scenarios = [];
    for (const policy of policies) {
        for (const fillModel of fillModels.filter(model => model.appliesTo(policy))) {
            const results = packs.map(pack => simulatePolicy({ ...pack, policy, fillModel, config }));
            scenarios.push({
                policy: policy.name,
                fillModel: fillModel.name,
                scenario: `${policy.name}:${fillModel.name}`,
                summary: summarize(results),
                results,
            });
        }
    }

    const output = {
        generated_at: new Date().toISOString(),
        input: opts.input,
        note: 'Research-only WAIT confirmation and fill-model comparison. No local bias guard is applied here. Confirmation, order, fill, and position are separate; NO_FILL/EXPIRED are not losses.',
        config,
        scenarios,
    };

    await fs.mkdir(path.dirname(opts.out), { recursive: true });
    await fs.writeFile(opts.out, JSON.stringify(output, null, 2) + '\n');

    console.log(`Wait confirmation study: ${opts.input}`);
    for (const scenario of scenarios) {
        const s = scenario.summary;
        console.log(`${scenario.scenario.padEnd(54)} confirmed=${String(s.confirmed).padStart(2)} filled=${String(s.filled).padStart(2)} noFill=${String(s.noFill).padStart(2)} expired=${String(s.expired).padStart(2)} cancelled=${String(s.cancelled).padStart(2)} W/L=${s.wins}/${s.losses} WR=${pct(s.winRate)} fill=${pct(s.fillRate)} avgFill=${pct(s.avgPnlPct)} avgCand=${pct(s.avgPnlPctPerCandidate)} missedRun=${s.missedRunners} total=${pct(s.totalPnlPct)} stops=${s.hardStops}`);
    }
    console.log(`Wrote ${opts.out}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
