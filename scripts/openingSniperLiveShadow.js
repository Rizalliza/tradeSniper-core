#!/usr/bin/env node
/**
 * Live shadow verifier for the first-two-minute opening sniper.
 *
 * Uses Massive real-time stock trades/quotes when the account supports the
 * Polygon-compatible WebSocket feed. It records raw tape and paper execution
 * decisions without sending broker orders.
 *
 * Usage:
 *   node -r dotenv/config scripts/openingSniperLiveShadow.js --symbols AAPL,MSFT,NVDA,TSLA
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeMassiveMessage } from '../src/events/MarketEvent.js';
import { TapeRecorder } from '../src/tape/TapeRecorder.js';
import { OpeningSniperPaperTrader } from '../src/microstructure/OpeningSniperPaperTrader.js';

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {
        symbols: ['AAPL', 'MSFT', 'NVDA', 'TSLA'],
        wsUrl: process.env.MASSIVE_WS_URL || 'wss://socket.massive.com/stocks',
        outDir: null,
        until: '09:45:00',
        periodSeconds: 2,
        zonePct: 0.0015,
        scalpTargetPct: 0.001,
        hardStopPct: 0.001,
        runnerTriggerPct: 0.0015,
        runnerTrailPct: 0.001,
        noQuotes: false,
        channels: ['A'],
        transport: 'ws',
        pollMs: 1000,
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--symbols': opts.symbols = args[++i].split(',').map(s => s.trim().toUpperCase()).filter(Boolean); break;
            case '--symbol': opts.symbols = [args[++i].toUpperCase()]; break;
            case '--ws-url': opts.wsUrl = args[++i]; break;
            case '--out-dir': opts.outDir = args[++i]; break;
            case '--until': opts.until = args[++i]; break;
            case '--period-seconds': opts.periodSeconds = Number(args[++i]); break;
            case '--zone-pct': opts.zonePct = Number(args[++i]); break;
            case '--scalp-target-pct': opts.scalpTargetPct = Number(args[++i]); break;
            case '--hard-stop-pct': opts.hardStopPct = Number(args[++i]); break;
            case '--runner-trigger-pct': opts.runnerTriggerPct = Number(args[++i]); break;
            case '--runner-trail-pct': opts.runnerTrailPct = Number(args[++i]); break;
            case '--no-quotes': opts.noQuotes = true; break;
            case '--channels': opts.channels = args[++i].split(',').map(s => s.trim().toUpperCase()).filter(Boolean); break;
            case '--transport': opts.transport = args[++i]; break;
            case '--poll-ms': opts.pollMs = Number(args[++i]); break;
        }
    }

    return opts;
}

function marketDateTime(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).formatToParts(date);
    const get = type => parts.find(part => part.type === type)?.value;
    return {
        date: `${get('year')}-${get('month')}-${get('day')}`,
        time: `${get('hour')}:${get('minute')}:${get('second')}`,
    };
}

function timestampToDate(ts) {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return new Date();
    if (n > 1e17) return new Date(n / 1e6); // ns
    if (n > 1e14) return new Date(n / 1e3); // us
    return new Date(n); // ms
}

function timeToSeconds(time) {
    const [hh = 0, mm = 0, ss = 0] = String(time).split(':').map(Number);
    return hh * 3600 + mm * 60 + ss;
}

function bucketTime(time, periodSeconds) {
    const bucket = Math.floor(timeToSeconds(time) / periodSeconds) * periodSeconds;
    const hh = String(Math.floor(bucket / 3600)).padStart(2, '0');
    const mm = String(Math.floor((bucket % 3600) / 60)).padStart(2, '0');
    const ss = String(bucket % 60).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
}

function pct(value) {
    return value == null ? '-' : `${(value * 100).toFixed(2)}%`;
}

class LiveBarBuilder {
    constructor({ symbol, date, periodSeconds, trader, onBar }) {
        this.symbol = symbol;
        this.date = date;
        this.periodSeconds = periodSeconds;
        this.trader = trader;
        this.onBar = onBar;
        this.current = null;
        this.lastOpeningBar = null;
        this.closedOpening = false;
        this.eventCursor = 0;
    }

    observeTrade(event) {
        if (event.date !== this.date || event.time < '09:30:00') return [];
        const time = bucketTime(event.time, this.periodSeconds);
        if (!this.current) {
            this.current = this._newBar(event, time);
            return [];
        }
        if (time !== this.current.time) {
            const flushed = this.flush();
            this.current = this._newBar(event, time);
            return flushed;
        }
        this.current.high = Math.max(this.current.high, event.price);
        this.current.low = Math.min(this.current.low, event.price);
        this.current.close = event.price;
        this.current.volume += event.size || 0;
        return [];
    }

    flushDue(nowTime) {
        if (!this.current) return [];
        if (bucketTime(nowTime, this.periodSeconds) === this.current.time) return [];
        return this.flush();
    }

    closeOpeningIfDue(nowTime) {
        if (this.closedOpening || nowTime < '09:32:00' || !this.lastOpeningBar) return [];
        this.closedOpening = true;
        this.trader.closeOpeningWindow(this.lastOpeningBar);
        return this._newTraderEvents();
    }

    finalize() {
        const events = [];
        events.push(...this.flush());
        events.push(...this.closeOpeningIfDue('16:00:00'));
        if (this.lastOpeningBar) {
            this.trader.finalize(this.lastOpeningBar);
            events.push(...this._newTraderEvents());
        }
        return events;
    }

    flush() {
        if (!this.current) return [];
        const bar = this.current;
        this.current = null;
        this.onBar(bar);

        if (bar.time < '09:32:00') {
            this.trader.processOpeningBar(bar);
            this.lastOpeningBar = bar;
        } else {
            this.closeOpeningIfDue(bar.time);
            this.trader.processRunnerBar(bar);
        }
        return this._newTraderEvents();
    }

    _newBar(event, time) {
        return {
            symbol: this.symbol,
            date: this.date,
            time,
            open: event.price,
            high: event.price,
            low: event.price,
            close: event.price,
            volume: event.size || 0,
        };
    }

    observeAggregate(bar) {
        this.onBar(bar);
        if (bar.time < '09:32:00') {
            this.trader.processOpeningBar(bar);
            this.lastOpeningBar = bar;
        } else {
            this.closeOpeningIfDue(bar.time);
            this.trader.processRunnerBar(bar);
        }
        return this._newTraderEvents();
    }

    _newTraderEvents() {
        const snapshot = this.trader.snapshot();
        const events = snapshot.events.slice(this.eventCursor).map(event => ({
            ...event,
            symbol: this.symbol,
            date: this.date,
            phase: snapshot.phase,
            localBias: snapshot.localBias,
        }));
        this.eventCursor = snapshot.events.length;
        return events;
    }
}

async function appendJsonl(filePath, rows) {
    if (!rows.length) return;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
}

async function writeSummary(filePath, builders, opts) {
    const rows = Object.fromEntries(Object.entries(builders).map(([symbol, builder]) => [symbol, builder.trader.snapshot()]));
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({
        generated_at: new Date().toISOString(),
        config: opts,
        rows,
    }, null, 2) + '\n');
}

async function fetchSecondBars(apiKey, symbol, date) {
    const url = new URL(`https://api.massive.com/v2/aggs/ticker/${symbol}/range/1/second/${date}/${date}`);
    url.searchParams.set('adjusted', 'true');
    url.searchParams.set('sort', 'desc');
    url.searchParams.set('limit', '200');
    url.searchParams.set('apiKey', apiKey);
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.status === 'ERROR' || data.status === 'NOT_AUTHORIZED') {
        throw new Error(data.message || data.error || `${res.status} ${res.statusText}`);
    }
    return (data.results || []).reverse().map(row => {
        const dt = marketDateTime(new Date(row.t));
        return {
            type: 'TRADE',
            symbol,
            date: dt.date,
            time: dt.time,
            price: Number(row.c),
            size: Number(row.v) || 0,
            sipTs: row.t,
            receiveTs: Date.now(),
            raw: row,
        };
    });
}

function aggregateMessageToBar(raw, session) {
    const dt = marketDateTime(timestampToDate(raw.s ?? raw.t));
    return {
        symbol: raw.sym,
        date: dt.date || session,
        time: dt.time,
        open: Number(raw.o),
        high: Number(raw.h),
        low: Number(raw.l),
        close: Number(raw.c),
        volume: Number(raw.v) || 0,
        vwap: Number(raw.a),
    };
}

async function main() {
    const opts = parseArgs();
    const apiKey = process.env.MASSIVE_API_KEY;
    if (!apiKey) throw new Error('MASSIVE_API_KEY missing. Run with node -r dotenv/config ...');
    if (opts.transport === 'ws' && typeof WebSocket !== 'function') throw new Error('This Node runtime does not expose global WebSocket');

    const session = marketDateTime().date;
    opts.outDir ||= path.join('data', 'live-shadow', session);
    const tapePath = path.join(opts.outDir, 'tape.jsonl');
    const barsPath = path.join(opts.outDir, 'bars.jsonl');
    const eventsPath = path.join(opts.outDir, 'paper-events.jsonl');
    const summaryPath = path.join(opts.outDir, 'summary.json');
    const tape = new TapeRecorder({ filePath: tapePath, source: opts.transport === 'ws' ? 'MASSIVE_WS' : 'MASSIVE_REST_AGGS', session });

    const builders = {};
    for (const symbol of opts.symbols) {
        const trader = new OpeningSniperPaperTrader({
            symbol,
            date: session,
            zonePct: opts.zonePct,
            scalpTargetPct: opts.scalpTargetPct,
            hardStopPct: opts.hardStopPct,
            runnerTriggerPct: opts.runnerTriggerPct,
            runnerTrailPct: opts.runnerTrailPct,
        });
        builders[symbol] = new LiveBarBuilder({
            symbol,
            date: session,
            periodSeconds: opts.periodSeconds,
            trader,
            onBar: bar => {
                void appendJsonl(barsPath, [{ recordedAt: new Date().toISOString(), bar }]);
                console.log(`[BAR] ${bar.time} ${symbol} O=${bar.open.toFixed(4)} H=${bar.high.toFixed(4)} L=${bar.low.toFixed(4)} C=${bar.close.toFixed(4)}`);
            },
        });
    }

    console.log(`Opening sniper live shadow`);
    console.log(`Session ${session}, symbols ${opts.symbols.join(', ')}`);
    console.log(`Output ${opts.outDir}`);
    console.log(`Transport ${opts.transport}`);
    if (opts.transport === 'ws') console.log(`Connecting ${opts.wsUrl}`);

    const ws = opts.transport === 'ws' ? new WebSocket(opts.wsUrl) : null;
    let authed = false;
    let stopped = false;

    const stop = async reason => {
        if (stopped) return;
        stopped = true;
        console.log(`\nStopping: ${reason}`);
        const eventRows = [];
        for (const builder of Object.values(builders)) eventRows.push(...builder.finalize());
        await appendJsonl(eventsPath, eventRows.map(event => ({ recordedAt: new Date().toISOString(), event })));
        await writeSummary(summaryPath, builders, opts);
        try { ws?.close(); } catch {}
        console.log(`Wrote ${summaryPath}`);
        process.exit(0);
    };

    process.on('SIGINT', () => { void stop('SIGINT'); });

    setInterval(async () => {
        const now = marketDateTime();
        const eventRows = [];
        for (const builder of Object.values(builders)) {
            eventRows.push(...builder.flushDue(now.time));
            eventRows.push(...builder.closeOpeningIfDue(now.time));
        }
        for (const event of eventRows) {
            console.log(`[EVENT] ${event.time} ${event.symbol} ${event.type} ${event.direction || ''} ${event.reason || ''} ${event.pnlPct != null ? pct(event.pnlPct) : ''}`);
        }
        await appendJsonl(eventsPath, eventRows.map(event => ({ recordedAt: new Date().toISOString(), event })));
        await writeSummary(summaryPath, builders, opts);
        if (now.time >= opts.until) await stop(`until ${opts.until}`);
    }, 500);

    async function handleTradeEvents(tradeEvents) {
        const paperEvents = [];
        for (const event of tradeEvents) {
            if (builders[event.symbol]) paperEvents.push(...builders[event.symbol].observeTrade(event));
        }
        if (!paperEvents.length) return;
        for (const event of paperEvents) {
            console.log(`[EVENT] ${event.time} ${event.symbol} ${event.type} ${event.direction || ''} ${event.reason || ''} ${event.pnlPct != null ? pct(event.pnlPct) : ''}`);
        }
        await appendJsonl(eventsPath, paperEvents.map(event => ({ recordedAt: new Date().toISOString(), event })));
    }

    if (opts.transport === 'rest') {
        const seen = Object.fromEntries(opts.symbols.map(symbol => [symbol, new Set()]));
        setInterval(async () => {
            for (const symbol of opts.symbols) {
                try {
                    const bars = await fetchSecondBars(apiKey, symbol, session);
                    const fresh = bars.filter(bar => {
                        const key = `${bar.time}|${bar.price}|${bar.size}`;
                        if (seen[symbol].has(key)) return false;
                        seen[symbol].add(key);
                        return bar.time >= '09:30:00';
                    });
                    if (!fresh.length) continue;
                    await tape.recordMany(fresh);
                    await handleTradeEvents(fresh);
                } catch (err) {
                    console.error(`[REST] ${symbol} ${err.message}`);
                }
            }
        }, opts.pollMs);
        return;
    }

    ws.onopen = () => {
        ws.send(JSON.stringify({ action: 'auth', params: apiKey }));
    };

    ws.onerror = error => {
        console.error('WebSocket error:', error?.message || error);
    };

    ws.onclose = event => {
        if (!stopped) console.error(`WebSocket closed code=${event.code} reason=${event.reason || ''}`);
    };

    ws.onmessage = async message => {
        const payload = JSON.parse(message.data);
        const messages = Array.isArray(payload) ? payload : [payload];
        const tapeEvents = [];
        const paperEvents = [];

        for (const raw of messages) {
            if (raw.ev === 'status') {
                console.log(`[STATUS] ${raw.status || ''} ${raw.message || ''}`);
                if (!authed && /auth/i.test(raw.status || raw.message || '')) {
                    authed = true;
                    const channelTypes = opts.noQuotes
                        ? opts.channels.filter(channel => channel !== 'Q')
                        : opts.channels;
                    const channels = opts.symbols.flatMap(symbol => channelTypes.map(channel => `${channel}.${symbol}`));
                    ws.send(JSON.stringify({ action: 'subscribe', params: channels.join(',') }));
                    console.log(`Subscribed ${channels.join(',')}`);
                }
                continue;
            }
            if (raw.ev === 'AM' || raw.ev === 'A') {
                const bar = aggregateMessageToBar(raw, session);
                if (builders[bar.symbol]) {
                    paperEvents.push(...builders[bar.symbol].observeAggregate(bar));
                }
                continue;
            }
            if (raw.ev !== 'T' && raw.ev !== 'Q') continue;

            const normalized = normalizeMassiveMessage(raw, Date.now());
            const dt = marketDateTime(timestampToDate(normalized.sipTs || normalized.exchangeTs || normalized.receiveTs));
            normalized.date = dt.date;
            normalized.time = dt.time;
            tapeEvents.push(normalized);

            if (normalized.type === 'TRADE' && builders[normalized.symbol]) paperEvents.push(normalized);
        }

        if (tapeEvents.length) await tape.recordMany(tapeEvents);
        await handleTradeEvents(paperEvents);
    };
}

main().catch(err => {
    console.error(`ERROR: ${err.message}`);
    console.error(err.stack?.slice(0, 1000));
    process.exit(1);
});
