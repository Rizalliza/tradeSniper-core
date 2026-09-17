export const MARKET_EVENT_TYPES = Object.freeze({
    TRADE: 'TRADE',
    QUOTE: 'QUOTE',
});

const TYPE_ORDER = Object.freeze({
    QUOTE: 0,
    TRADE: 1,
});

export function normalizeMarketEvent(input = {}) {
    const type = String(input.type || input.ev || '').toUpperCase();
    if (!Object.values(MARKET_EVENT_TYPES).includes(type)) {
        throw new Error(`Unsupported market event type: ${input.type || input.ev || 'unknown'}`);
    }

    const symbol = String(input.symbol || input.sym || '').toUpperCase();
    if (!symbol) throw new Error('MarketEvent requires symbol');

    const base = {
        type,
        symbol,
        exchangeTs: finiteOrNull(input.exchangeTs ?? input.participantTs ?? input.trfTs),
        sipTs: finiteOrNull(input.sipTs ?? input.timestamp ?? input.t),
        receiveTs: finiteOrNull(input.receiveTs),
        sequence: finiteOrNull(input.sequence ?? input.q),
        date: input.date ?? null,
        time: input.time ?? null,
        exchange: input.exchange ?? input.x ?? null,
        conditions: Array.isArray(input.conditions)
            ? [...input.conditions]
            : Array.isArray(input.c)
                ? [...input.c]
                : [],
        raw: input.raw ?? null,
    };

    if (type === MARKET_EVENT_TYPES.TRADE) {
        const price = Number(input.price ?? input.p);
        const size = Number(input.size ?? input.s);
        if (!Number.isFinite(price)) throw new Error('TRADE event requires price');
        return {
            ...base,
            price,
            size: Number.isFinite(size) ? size : 0,
        };
    }

    const bid = Number(input.bid ?? input.bp);
    const ask = Number(input.ask ?? input.ap);
    if (!Number.isFinite(bid) || !Number.isFinite(ask)) {
        throw new Error('QUOTE event requires bid and ask');
    }

    return {
        ...base,
        bid,
        bidSize: numberOrZero(input.bidSize ?? input.bs),
        ask,
        askSize: numberOrZero(input.askSize ?? input.as),
    };
}

export function normalizeMassiveMessage(message, receiveTs = Date.now()) {
    const ev = String(message?.ev || '').toUpperCase();
    if (ev === 'T') {
        return normalizeMarketEvent({
            type: MARKET_EVENT_TYPES.TRADE,
            symbol: message.sym,
            exchangeTs: message.participantTs ?? message.y,
            sipTs: message.sipTs ?? message.t,
            receiveTs,
            sequence: message.q,
            exchange: message.x,
            conditions: message.c,
            price: message.p,
            size: message.s,
            raw: message,
        });
    }

    if (ev === 'Q') {
        return normalizeMarketEvent({
            type: MARKET_EVENT_TYPES.QUOTE,
            symbol: message.sym,
            exchangeTs: message.participantTs ?? message.y,
            sipTs: message.sipTs ?? message.t,
            receiveTs,
            sequence: message.q,
            bid: message.bp,
            bidSize: message.bs,
            ask: message.ap,
            askSize: message.as,
            conditions: message.c,
            raw: message,
        });
    }

    throw new Error(`Unsupported Massive message ev: ${message?.ev || 'unknown'}`);
}

export function marketEventTime(event) {
    return event.sipTs ?? event.exchangeTs ?? event.receiveTs ?? 0;
}

export function compareMarketEvents(a, b) {
    const timeDiff = marketEventTime(a) - marketEventTime(b);
    if (timeDiff !== 0) return timeDiff;

    const seqDiff = (a.sequence ?? 0) - (b.sequence ?? 0);
    if (seqDiff !== 0) return seqDiff;

    const typeDiff = (TYPE_ORDER[a.type] ?? 99) - (TYPE_ORDER[b.type] ?? 99);
    if (typeDiff !== 0) return typeDiff;

    return String(a.symbol).localeCompare(String(b.symbol));
}

function finiteOrNull(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function numberOrZero(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}
