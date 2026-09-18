#!/usr/bin/env node
/**
 * Research-only opening scanner that keeps discovering candidates after the
 * first signal resolves. This does not change production or paper execution.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {
        input: 'data/pressure-pilot-2026-09-09_2026-09-15.json',
        out: 'data/opening-multi-event-study-2026-09-09_2026-09-15.json',
        zonePct: 0.0015,
        retestZonePct: 0.00025,
        retestCloseZoneMultiplier: 2,
        hardStopPct: 0.001,
        scalpTargetPct: 0.001,
        runnerTriggerPct: 0.0015,
        runnerTrailPct: 0.001,
        confirmBars: 2,
        limitExpirySeconds: 60,
        maxPendingBars: 18,
        boundaryHoldBars: 4,
        minCandidateGapBars: 3,
    };
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--input': opts.input = args[++i]; break;
            case '--out': opts.out = args[++i]; break;
            case '--zone-pct': opts.zonePct = Number(args[++i]); break;
            case '--retest-zone-pct': opts.retestZonePct = Number(args[++i]); break;
            case '--retest-close-zone-multiplier': opts.retestCloseZoneMultiplier = Number(args[++i]); break;
            case '--hard-stop-pct': opts.hardStopPct = Number(args[++i]); break;
            case '--scalp-target-pct': opts.scalpTargetPct = Number(args[++i]); break;
            case '--runner-trigger-pct': opts.runnerTriggerPct = Number(args[++i]); break;
            case '--runner-trail-pct': opts.runnerTrailPct = Number(args[++i]); break;
            case '--confirm-bars': opts.confirmBars = Number(args[++i]); break;
            case '--limit-expiry-seconds': opts.limitExpirySeconds = Number(args[++i]); break;
            case '--max-pending-bars': opts.maxPendingBars = Number(args[++i]); break;
            case '--boundary-hold-bars': opts.boundaryHoldBars = Number(args[++i]); break;
            case '--min-candidate-gap-bars': opts.minCandidateGapBars = Number(args[++i]); break;
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

function scanSession({ symbol, date, first2Bars, validationBars, f2Window, config }) {
    const ledger = [];
    const candidates = [];
    const pending = [];
    const allBars = [...first2Bars, ...validationBars].map((bar, index) => ({ ...bar, index }));
    let high = null;
    let low = null;
    let prevBar = null;
    let interactionSeq = 0;
    let candidateSeq = 0;
    let lastCandidateIndexBySide = new Map();

    for (let index = 0; index < first2Bars.length; index++) {
        const bar = { ...first2Bars[index], index };
        if (index === 0) {
            high = bar.high;
            low = bar.low;
            prevBar = bar;
            ledger.push(event({ time: bar.time, type: 'OPEN', message: `open ${round(bar.open)}` }));
            continue;
        }

        resolvePending({ pending, bar, index, candidates, ledger, allBars, first2Bars, f2Window, config, symbol, date, lastCandidateIndexBySide, nextCandidateId: () => `C${String(++candidateSeq).padStart(3, '0')}` });

        const levels = levelsFromRange(high, low);
        for (const level of levels) {
            for (const cross of detectCrosses({ prevBar, bar, level, config })) {
                interactionSeq += 1;
                const interactionCycleId = `I${String(interactionSeq).padStart(3, '0')}`;
                const item = {
                    ...cross,
                    symbol,
                    date,
                    interactionCycleId,
                    triggerClusterId: level.level,
                    level: level.level,
                    levelValue: level.levelValue,
                    crossTime: bar.time,
                    crossIndex: index,
                    maxExcursionPct: 0,
                    maxExcursionIndex: index,
                    maxExcursionTime: bar.time,
                    createdCandidate: false,
                };
                pending.push(item);
                ledger.push(event({
                    time: bar.time,
                    type: cross.eventType,
                    interactionCycleId,
                    direction: cross.direction,
                    level: level.level,
                    price: level.levelValue,
                    message: `${cross.direction} ${level.level}`,
                }));
            }
        }

        for (const boundary of detectBoundaryWatches({ bar, high, low })) {
            interactionSeq += 1;
            const interactionCycleId = `I${String(interactionSeq).padStart(3, '0')}`;
            const item = {
                ...boundary,
                symbol,
                date,
                interactionCycleId,
                triggerClusterId: boundary.level,
                crossTime: bar.time,
                crossIndex: index,
                maxPendingBars: config.boundaryHoldBars,
                maxExcursionPct: 0,
                maxExcursionIndex: index,
                maxExcursionTime: bar.time,
                createdCandidate: false,
            };
            pending.push(item);
            ledger.push(event({
                time: bar.time,
                type: boundary.eventType,
                interactionCycleId,
                direction: boundary.direction,
                level: boundary.level,
                price: boundary.levelValue,
                message: `${boundary.direction} watch ${boundary.level}`,
            }));
        }

        high = Math.max(high, bar.high);
        low = Math.min(low, bar.low);
        prevBar = bar;
    }

    for (const item of pending.filter(item => !item.createdCandidate)) {
        ledger.push(event({
            time: first2Bars.at(-1)?.time,
            type: 'INTERACTION_EXPIRED',
            interactionCycleId: item.interactionCycleId,
            direction: item.direction,
            level: item.level,
            message: `${item.direction} ${item.level} no retest candidate`,
        }));
    }

    ledger.sort(compareLedger);
    return {
        symbol,
        date,
        summary: summarizeSession(candidates),
        candidates,
        ledger,
    };
}

function resolvePending({ pending, bar, index, candidates, ledger, allBars, first2Bars, f2Window, config, symbol, date, lastCandidateIndexBySide, nextCandidateId }) {
    for (const item of pending) {
        if (item.createdCandidate || index <= item.crossIndex) continue;
        updateSeparation(item, bar);
        if (index - item.crossIndex > (item.maxPendingBars ?? config.maxPendingBars)) {
            item.createdCandidate = true;
            ledger.push(event({
                time: bar.time,
                type: 'INTERACTION_EXPIRED',
                interactionCycleId: item.interactionCycleId,
                direction: item.direction,
                level: item.level,
                message: 'pending interaction aged out',
            }));
            continue;
        }

        const boundaryHold = detectBoundaryHold(item, bar, config);
        const retest = !boundaryHold && detectRetest(item, bar, config);
        const reclaim = !boundaryHold && detectReclaimCandidate(item, bar, config);
        const candidateDirection = reclaim ? opposite(item.direction) : item.direction;
        const triggerType = boundaryHold ? 'BOUNDARY_HOLD_CANDIDATE' : reclaim ? 'RECLAIM_RETEST_CANDIDATE' : retest ? 'RETEST_CANDIDATE' : null;
        if (!triggerType) continue;

        const gapKey = `${candidateDirection}|${item.level}|${round(item.levelValue, 2)}`;
        const lastIndex = lastCandidateIndexBySide.get(gapKey);
        if (Number.isFinite(lastIndex) && index - lastIndex < config.minCandidateGapBars) continue;
        lastCandidateIndexBySide.set(gapKey, index);
        item.createdCandidate = true;

        const candidate = buildCandidate({
            symbol,
            date,
            candidateId: nextCandidateId(),
            candidateSeq: candidates.length + 1,
            item,
            bar,
            index,
            direction: candidateDirection,
            triggerType,
            allBars,
            first2Bars,
            f2Window,
            config,
            priorCandidate: candidates.at(-1),
        });
        applyLifecycle({ candidate, allBars, first2Bars, config });
        candidates.push(candidate);
        ledger.push(...candidate.ledgerEvents);
    }
}

function buildCandidate({ symbol, date, candidateId, candidateSeq, item, bar, index, direction, triggerType, allBars, first2Bars, f2Window, config, priorCandidate }) {
    const level = item.level;
    const levelValue = item.levelValue;
    const separation = separationFeatures({ item, retestIndex: index, levelValue, first2Bars, f2Window });
    return {
        symbol,
        date,
        candidateId,
        candidateSeq,
        interactionCycleId: item.interactionCycleId,
        triggerClusterId: item.triggerClusterId,
        direction,
        lifecycle: 'DETECTED',
        triggerType,
        level,
        levelValue: round(levelValue),
        crossTime: item.crossTime,
        crossIndex: item.crossIndex,
        entryCandidateTime: bar.time,
        entryCandidateIndex: index,
        entryCandidateHigh: round(bar.high),
        entryCandidateLow: round(bar.low),
        entryCandidateClose: round(bar.close),
        priorCandidateOutcome: priorCandidate ? `${priorCandidate.candidateId}:${priorCandidate.lifecycle}` : null,
        context: {
            f2High: round(f2Window?.high),
            f2Low: round(f2Window?.low),
            f2Mid: finite(f2Window?.high) && finite(f2Window?.low) ? round((Number(f2Window.high) + Number(f2Window.low)) / 2) : null,
            source: 'BAR',
            resolutionMs: 2000,
            executionCertainty: 'BAR_RESOLVED',
        },
        separation,
        confirmation: null,
        order: null,
        fill: null,
        trade: null,
        opportunityCost: measureOpportunity({ candidate: { direction, levelValue }, allBars, config, startIndex: index + 1 }),
        explanation: [
            `${triggerType} from ${item.eventType} ${item.level}`,
            `separation ${round(separation.maxExcursionBps, 2)} bps over ${separation.barsElapsed} bars`,
        ],
        ledgerEvents: [
            event({
                time: bar.time,
                type: triggerType,
                candidateId,
                interactionCycleId: item.interactionCycleId,
                direction,
                level,
                price: bar.close,
                message: `${candidateId} ${direction} ${level}`,
            }),
        ],
    };
}

function applyLifecycle({ candidate, allBars, first2Bars, config }) {
    candidate.lifecycle = 'WAITING_CONFIRMATION';
    candidate.ledgerEvents.push(event({
        time: candidate.entryCandidateTime,
        type: 'WAITING_CONFIRMATION',
        candidateId: candidate.candidateId,
        direction: candidate.direction,
        level: candidate.level,
        message: `wait ${config.confirmBars} hold bars`,
    }));

    const confirmationIndex = resolveConfirmationIndex(candidate, allBars, config);
    if (confirmationIndex == null) {
        candidate.lifecycle = 'REJECTED';
        candidate.confirmation = {
            status: 'REJECTED',
            reason: 'NO_CONFIRMATION_OR_LEVEL_VIOLATION',
            confirmBars: config.confirmBars,
        };
        candidate.ledgerEvents.push(event({
            time: addSeconds(candidate.entryCandidateTime, config.confirmBars * 2),
            type: 'REJECTED',
            candidateId: candidate.candidateId,
            direction: candidate.direction,
            level: candidate.level,
            message: 'hold confirmation failed',
        }));
        return;
    }

    const confirmationBar = allBars[confirmationIndex];
    candidate.lifecycle = 'CONFIRMED';
    candidate.confirmation = {
        status: 'CONFIRMED',
        confirmationTime: confirmationBar.time,
        confirmationIndex,
        confirmationPrice: round(confirmationBar.close),
        barsWaited: confirmationIndex - candidate.entryCandidateIndex,
        reason: 'WAIT_HOLD_LEVEL',
    };
    candidate.ledgerEvents.push(event({
        time: confirmationBar.time,
        type: 'CONFIRMED',
        candidateId: candidate.candidateId,
        direction: candidate.direction,
        level: candidate.level,
        price: confirmationBar.close,
        message: 'hold confirmation passed',
    }));

    candidate.lifecycle = 'ORDER_PENDING';
    candidate.order = {
        orderId: `${candidate.symbol}-${candidate.date}-${candidate.candidateId}-WAIT_LIMIT_RETEST_WITH_EXPIRY`,
        fillModel: 'WAIT_LIMIT_RETEST_WITH_EXPIRY',
        orderCreatedTime: confirmationBar.time,
        orderCreatedIndex: confirmationIndex,
        requestedPrice: candidate.levelValue,
        expirySeconds: config.limitExpirySeconds,
        status: 'PENDING',
    };
    candidate.ledgerEvents.push(event({
        time: confirmationBar.time,
        type: 'ORDER_PENDING',
        candidateId: candidate.candidateId,
        direction: candidate.direction,
        price: candidate.order.requestedPrice,
        message: 'limit retest order created',
    }));

    const fill = simulateLimitFill({ candidate, allBars, confirmationIndex, config });
    candidate.fill = fill;
    if (fill.status !== 'FILLED') {
        candidate.lifecycle = fill.status;
        candidate.ledgerEvents.push(event({
            time: fill.statusTime,
            type: fill.status,
            candidateId: candidate.candidateId,
            direction: candidate.direction,
            message: fill.reason,
        }));
        return;
    }

    candidate.lifecycle = 'FILLED';
    candidate.ledgerEvents.push(event({
        time: fill.fillTime,
        type: 'FILLED',
        candidateId: candidate.candidateId,
        direction: candidate.direction,
        price: fill.fillPrice,
        message: 'post-confirmation retest filled',
    }));
    candidate.trade = simulateTrade({ candidate, allBars, first2Bars, config });
    candidate.lifecycle = 'EXITED';
    candidate.ledgerEvents.push(event({
        time: candidate.trade.exitTime,
        type: 'EXITED',
        candidateId: candidate.candidateId,
        direction: candidate.direction,
        price: candidate.trade.exitPrice,
        message: `${candidate.trade.exitReason} ${pct(candidate.trade.pnlPct)}`,
    }));
}

function resolveConfirmationIndex(candidate, bars, config) {
    const max = Math.min(bars.length - 1, candidate.entryCandidateIndex + config.confirmBars);
    for (let i = candidate.entryCandidateIndex + 1; i <= max; i++) {
        const bar = bars[i];
        if (violated(candidate, bar)) return null;
        if (confirmedHold(candidate, bar)) return i;
    }
    return null;
}

function confirmedHold(candidate, bar) {
    return candidate.direction === 'BUY'
        ? bar.close > candidate.levelValue && bar.low >= candidate.levelValue
        : bar.close < candidate.levelValue && bar.high <= candidate.levelValue;
}

function violated(candidate, bar) {
    return candidate.direction === 'BUY'
        ? bar.close < candidate.levelValue
        : bar.close > candidate.levelValue;
}

function simulateLimitFill({ candidate, allBars, confirmationIndex, config }) {
    const expiryTime = addSeconds(allBars[confirmationIndex].time, config.limitExpirySeconds);
    for (let i = confirmationIndex + 1; i < allBars.length; i++) {
        const bar = allBars[i];
        if (bar.time > expiryTime) break;
        const touched = candidate.direction === 'BUY'
            ? bar.low <= candidate.levelValue
            : bar.high >= candidate.levelValue;
        if (touched) {
            return {
                status: 'FILLED',
                fillTime: bar.time,
                fillIndex: i,
                fillPrice: candidate.levelValue,
                reason: 'POST_CONFIRMATION_LIMIT_RETEST',
                executionCertainty: bar.time >= '09:32:00' ? 'AMBIGUOUS' : 'BAR_RESOLVED',
            };
        }
    }
    return {
        status: 'EXPIRED',
        statusTime: expiryTime,
        fillIndex: null,
        fillPrice: null,
        reason: 'ORDER_EXPIRED_BEFORE_PRICE_AVAILABLE',
        executionCertainty: 'BAR_RESOLVED',
    };
}

function simulateTrade({ candidate, allBars, first2Bars, config }) {
    const entryBar = allBars[candidate.fill.fillIndex];
    const trade = {
        direction: candidate.direction,
        entryPrice: round(candidate.fill.fillPrice),
        entryTime: entryBar.time,
        entryIndex: candidate.fill.fillIndex,
        runner: false,
        bestPrice: candidate.direction === 'BUY' ? entryBar.high : entryBar.low,
        trailingStop: null,
        exitPrice: null,
        exitTime: null,
        exitReason: null,
        pnlPct: null,
        outcome: null,
    };
    for (let i = trade.entryIndex + 1; i < allBars.length; i++) {
        manageTrade(trade, allBars[i], config, i >= first2Bars.length);
        if (trade.exitReason) break;
    }
    if (!trade.exitReason) {
        const last = allBars.at(-1) || entryBar;
        closeTrade(trade, last.close, trade.runner ? 'RUNNER_HELD_TO_END' : 'UNRESOLVED_WINDOW_END', last.time);
    }
    trade.excursion = measureOpportunity({ candidate, allBars, config, startIndex: trade.entryIndex, referencePrice: trade.entryPrice });
    return trade;
}

function levelsFromRange(high, low) {
    return [
        { level: 'F2-H', levelValue: high },
        { level: 'F2-M', levelValue: (high + low) / 2 },
        { level: 'F2-L', levelValue: low },
    ].filter(level => finite(level.levelValue));
}

function detectCrosses({ prevBar, bar, level, config }) {
    const zone = level.levelValue * config.zonePct;
    const rows = [];
    if (prevBar.close <= level.levelValue + zone && bar.high > level.levelValue + zone) {
        rows.push({ direction: 'BUY', eventType: 'CROSS_UP' });
    }
    if (prevBar.close >= level.levelValue - zone && bar.low < level.levelValue - zone) {
        rows.push({ direction: 'SELL', eventType: 'CROSS_DOWN' });
    }
    return rows;
}

function detectBoundaryWatches({ bar, high, low }) {
    const rows = [];
    if (finite(high) && bar.high > high) {
        rows.push({
            direction: 'SELL',
            eventType: 'BOUNDARY_HIGH',
            level: 'F2-H',
            levelValue: bar.high,
        });
    }
    if (finite(low) && bar.low < low) {
        rows.push({
            direction: 'BUY',
            eventType: 'BOUNDARY_LOW',
            level: 'F2-L',
            levelValue: bar.low,
        });
    }
    return rows;
}

function detectRetest(item, bar, config) {
    const zone = item.levelValue * config.retestZonePct;
    const closeZone = zone * config.retestCloseZoneMultiplier;
    if (item.direction === 'BUY') {
        return bar.low <= item.levelValue + zone &&
            bar.close > item.levelValue &&
            bar.close <= item.levelValue + closeZone;
    }
    return bar.high >= item.levelValue - zone &&
        bar.close < item.levelValue &&
        bar.close >= item.levelValue - closeZone;
}

function detectReclaimCandidate(item, bar, config) {
    const zone = item.levelValue * config.retestZonePct;
    if (item.direction === 'SELL') {
        return bar.low <= item.levelValue + zone && bar.close > item.levelValue;
    }
    return bar.high >= item.levelValue - zone && bar.close < item.levelValue;
}

function detectBoundaryHold(item, bar, config) {
    if (item.eventType !== 'BOUNDARY_LOW' && item.eventType !== 'BOUNDARY_HIGH') return false;
    const zone = item.levelValue * config.retestZonePct * config.retestCloseZoneMultiplier;
    if (item.direction === 'BUY') {
        return bar.low <= item.levelValue + zone && bar.close > item.levelValue;
    }
    return bar.high >= item.levelValue - zone && bar.close < item.levelValue;
}

function updateSeparation(item, bar) {
    const favorable = item.direction === 'BUY' ? bar.high : bar.low;
    const move = Math.max(0, directionalPct(item.direction, item.levelValue, favorable));
    if (move > item.maxExcursionPct) {
        item.maxExcursionPct = move;
        item.maxExcursionIndex = bar.index;
        item.maxExcursionTime = bar.time;
    }
}

function separationFeatures({ item, retestIndex, levelValue, first2Bars, f2Window }) {
    const range = finite(f2Window?.high) && finite(f2Window?.low)
        ? Number(f2Window.high) - Number(f2Window.low)
        : 0;
    return {
        barsElapsed: retestIndex - item.crossIndex,
        elapsedSeconds: secondsBetween(item.crossTime, first2Bars[retestIndex]?.time),
        maxExcursionPct: round(item.maxExcursionPct, 6),
        maxExcursionBps: round(item.maxExcursionPct * 10000, 3),
        maxExcursionRangeUnits: range > 0 ? round((item.maxExcursionPct * levelValue) / range, 4) : null,
        maxExcursionTime: item.maxExcursionTime,
    };
}

function manageTrade(trade, bar, config, allowRunner) {
    const stopPrice = trade.direction === 'BUY'
        ? trade.entryPrice * (1 - config.hardStopPct)
        : trade.entryPrice * (1 + config.hardStopPct);
    const stopHit = trade.direction === 'BUY' ? bar.low <= stopPrice : bar.high >= stopPrice;
    if (stopHit) {
        closeTrade(trade, stopPrice, trade.runner ? 'RUNNER_HARD_STOP' : 'HARD_STOP', bar.time);
        return;
    }
    updateBestPrice(trade, bar);
    if (trade.runner) {
        updateTrail(trade, config);
        const trailHit = trade.direction === 'BUY'
            ? bar.low <= trade.trailingStop
            : bar.high >= trade.trailingStop;
        if (trailHit) closeTrade(trade, trade.trailingStop, 'RUNNER_TRAIL', bar.time);
        return;
    }
    const targetPrice = trade.direction === 'BUY'
        ? trade.entryPrice * (1 + config.scalpTargetPct)
        : trade.entryPrice * (1 - config.scalpTargetPct);
    const targetHit = trade.direction === 'BUY' ? bar.high >= targetPrice : bar.low <= targetPrice;
    if (!targetHit) return;
    const favorablePct = directionalPct(trade.direction, trade.entryPrice, bar.close);
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
    trade.pnlPct = round(directionalPct(trade.direction, trade.entryPrice, price), 6);
    trade.outcome = trade.pnlPct > 0 ? 'WON' : trade.pnlPct < 0 ? 'LOST' : 'BREAKEVEN';
}

function measureOpportunity({ candidate, allBars, config, startIndex, referencePrice = candidate.levelValue }) {
    if (!candidate?.direction || !finite(referencePrice)) return null;
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

function summarizeSession(candidates) {
    const filled = candidates.filter(c => c.fill?.status === 'FILLED');
    const trades = filled.filter(c => c.trade);
    const wins = trades.filter(c => c.trade.outcome === 'WON').length;
    const losses = trades.filter(c => c.trade.outcome === 'LOST').length;
    const totalPnlPct = trades.reduce((sum, c) => sum + (c.trade.pnlPct || 0), 0);
    return {
        candidates: candidates.length,
        confirmed: candidates.filter(c => c.confirmation?.status === 'CONFIRMED').length,
        filled: filled.length,
        rejected: candidates.filter(c => c.lifecycle === 'REJECTED').length,
        expired: candidates.filter(c => c.lifecycle === 'EXPIRED').length,
        wins,
        losses,
        winRate: wins + losses ? wins / (wins + losses) : null,
        totalPnlPct: round(totalPnlPct, 6),
        runners: trades.filter(c => c.trade.runner).length,
        directions: countBy(candidates, c => c.direction),
        lifecycles: countBy(candidates, c => c.lifecycle),
    };
}

function summarizeAll(sessions) {
    const candidates = sessions.flatMap(s => s.candidates);
    const trades = candidates.filter(c => c.trade);
    const wins = trades.filter(c => c.trade.outcome === 'WON').length;
    const losses = trades.filter(c => c.trade.outcome === 'LOST').length;
    const totalPnlPct = trades.reduce((sum, c) => sum + (c.trade.pnlPct || 0), 0);
    return {
        sessions: sessions.length,
        candidates: candidates.length,
        confirmed: candidates.filter(c => c.confirmation?.status === 'CONFIRMED').length,
        filled: candidates.filter(c => c.fill?.status === 'FILLED').length,
        rejected: candidates.filter(c => c.lifecycle === 'REJECTED').length,
        expired: candidates.filter(c => c.lifecycle === 'EXPIRED').length,
        wins,
        losses,
        winRate: wins + losses ? wins / (wins + losses) : null,
        totalPnlPct: round(totalPnlPct, 6),
        runners: trades.filter(c => c.trade.runner).length,
        directions: countBy(candidates, c => c.direction),
        lifecycles: countBy(candidates, c => c.lifecycle),
    };
}

function countBy(rows, fn) {
    return rows.reduce((acc, row) => {
        const key = fn(row) || 'UNKNOWN';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});
}

function event(row) {
    return {
        time: row.time || null,
        type: row.type,
        candidateId: row.candidateId || null,
        interactionCycleId: row.interactionCycleId || null,
        direction: row.direction || null,
        level: row.level || null,
        price: finite(row.price) ? round(Number(row.price)) : null,
        message: row.message || '',
    };
}

function compareLedger(a, b) {
    const time = String(a.time || '').localeCompare(String(b.time || ''));
    if (time !== 0) return time;
    return String(a.candidateId || a.interactionCycleId || '').localeCompare(String(b.candidateId || b.interactionCycleId || ''));
}

function directionalPct(direction, entryPrice, price) {
    const dir = direction === 'BUY' ? 1 : -1;
    return ((price - entryPrice) / entryPrice) * dir;
}

function opposite(direction) {
    return direction === 'BUY' ? 'SELL' : 'BUY';
}

function secondsBetween(start, end) {
    if (!start || !end) return null;
    return timeToSeconds(end) - timeToSeconds(start);
}

function timeToSeconds(time) {
    const [hh = 0, mm = 0, ss = 0] = String(time).split(':').map(Number);
    return hh * 3600 + mm * 60 + ss;
}

function addSeconds(time, seconds) {
    const total = timeToSeconds(time) + seconds;
    const h = String(Math.floor(total / 3600)).padStart(2, '0');
    const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
    const s = String(total % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
}

function pct(value) {
    return value == null ? '-' : `${(Number(value) * 100).toFixed(2)}%`;
}

function finite(value) {
    return Number.isFinite(Number(value));
}

function round(value, digits = 6) {
    return Number.isFinite(Number(value)) ? Number(value.toFixed(digits)) : null;
}

async function main() {
    const opts = parseArgs();
    const config = { ...opts };
    delete config.input;
    delete config.out;

    const payload = JSON.parse(await fs.readFile(opts.input, 'utf8'));
    const sessions = [];
    for (const symbolPack of payload.results || []) {
        for (const pack of symbolPack.packs || []) {
            const first2Bars = normalizeBars(pack.bars?.open_first_2_min_aggregated_seconds || []);
            const validationBars = normalizeBars(pack.bars?.open_aggregated_seconds || []);
            sessions.push(scanSession({
                symbol: pack.symbol,
                date: pack.date,
                first2Bars,
                validationBars,
                f2Window: pack.windows?.open_first_2_min || null,
                config,
            }));
        }
    }

    const output = {
        generated_at: new Date().toISOString(),
        input: opts.input,
        note: 'Research-only continuous opening scanner. A completed candidate does not terminate session discovery. Production Sniper is unchanged.',
        config,
        summary: summarizeAll(sessions),
        sessions,
    };

    await fs.mkdir(path.dirname(opts.out), { recursive: true });
    await fs.writeFile(opts.out, JSON.stringify(output, null, 2) + '\n');

    console.log(`Opening multi-event scanner: ${opts.input}`);
    const s = output.summary;
    console.log(`sessions=${s.sessions} candidates=${s.candidates} confirmed=${s.confirmed} filled=${s.filled} rejected=${s.rejected} expired=${s.expired} W/L=${s.wins}/${s.losses} WR=${pct(s.winRate)} total=${pct(s.totalPnlPct)} runners=${s.runners}`);
    for (const session of sessions.filter(row => row.symbol === 'TSLA' && (row.date === '2026-09-09' || row.date === '2026-09-10'))) {
        console.log(`\n${session.symbol} ${session.date}`);
        for (const c of session.candidates) {
            const result = c.trade ? `${c.trade.exitReason} ${pct(c.trade.pnlPct)}` : c.lifecycle;
            console.log(`${c.candidateId} ${c.entryCandidateTime} ${c.direction} ${c.triggerType} ${c.level} sep=${round(c.separation.maxExcursionBps, 2)}bps -> ${result}`);
        }
    }
    console.log(`Wrote ${opts.out}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
