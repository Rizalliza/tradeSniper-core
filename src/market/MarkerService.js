export const MARKER_TYPES = {
    monthly_high: { type: 'resistance', tier: 'monthly' },
    weekly_high: { type: 'resistance', tier: 'weekly' },
    daily_high: { type: 'resistance', tier: 'daily' },
    prior_day_close: { type: 'neutral', tier: 'daily' },
    prior_day_open: { type: 'neutral', tier: 'daily' },
    daily_low: { type: 'support', tier: 'daily' },
    weekly_low: { type: 'support', tier: 'weekly' },
    monthly_low: { type: 'support', tier: 'monthly' },
};

export class MarkerService {
    static compute(dailyBars, index) {
        if (index < 1) return null;
        const prior = dailyBars[index - 1];
        const week = dailyBars.slice(Math.max(0, index - 5), index);
        const targetMonth = dailyBars[index].date.slice(0, 7);
        const priorMonths = dailyBars.slice(0, index).filter(b => b.date.slice(0, 7) !== targetMonth);
        const monthlyRef = priorMonths.length ? priorMonths : [prior];
        return {
            prior_day_open: prior.o, prior_day_close: prior.c,
            daily_high: prior.h, daily_low: prior.l,
            weekly_high: Math.max(...week.map(b => b.h)),
            weekly_low: Math.min(...week.map(b => b.l)),
            monthly_high: Math.max(...monthlyRef.map(b => b.h)),
            monthly_low: Math.min(...monthlyRef.map(b => b.l)),
        };
    }

    static buildList(markers) {
        const raw = [
            { name: 'monthly_high', value: markers.monthly_high },
            { name: 'weekly_high', value: markers.weekly_high },
            { name: 'daily_high', value: markers.daily_high },
            { name: 'prior_day_open', value: markers.prior_day_open },
            { name: 'prior_day_close', value: markers.prior_day_close },
            { name: 'daily_low', value: markers.daily_low },
            { name: 'weekly_low', value: markers.weekly_low },
            { name: 'monthly_low', value: markers.monthly_low },
        ].map(m => ({ ...m, type: MARKER_TYPES[m.name].type, tier: MARKER_TYPES[m.name].tier }));
        const sorted = raw.sort((a, b) => b.value - a.value);
        const deduped = [];
        for (const m of sorted) {
            if (!deduped.length || Math.abs(deduped[deduped.length - 1].value - m.value) > 0.01) deduped.push(m);
        }
        return deduped;
    }

    static nextMarker(markerList, markerName, direction) {
        const idx = markerList.findIndex(m => m.name === markerName);
        if (idx < 0) return null;
        const nextIdx = direction === 'UP' ? idx - 1 : idx + 1;
        if (nextIdx < 0 || nextIdx >= markerList.length) return null;
        return markerList[nextIdx];
    }

    static classify(markerList, currentPrice) {
        const above = markerList.filter(m => m.value > currentPrice + 0.001);
        const below = markerList.filter(m => m.value < currentPrice - 0.001);
        return {
            above, below,
            nearestResistance: above.length ? above[above.length - 1] : null,
            nearestSupport: below.length ? below[0] : null,
        };
    }
}