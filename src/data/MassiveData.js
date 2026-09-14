import { BarLoader } from '../market/BarLoader.js';

/**
 * Massive.com market data adapter.
 *
 * Supports two data sources:
 * 1. REST API - on-demand aggregate bars (minute, second, day)
 * 2. S3 Flat Files - bulk historical downloads (minute, day, trades)
 *
 * Both sources produce standardized bar format:
 * { symbol, date, time, open, high, low, close, volume }
 *
 * Usage:
 *   const fetcher = new MassiveData({ apiKey: 'xxx', accessKey: 'xxx', secretKey: 'xxx' });
 *   const bars = await fetcher.fetchMinuteBars('AAPL', '2026-02-02', '2026-02-02');
 */

const MASSIVE_REST_BASE = 'https://api.massive.com/v2';
const MASSIVE_S3_ENDPOINT = 'https://files.massive.com';
const MASSIVE_S3_BUCKET = 'flatfiles';

export class MassiveData {
  constructor(config = {}) {
    this.apiKey = config.apiKey || process.env.MASSIVE_API_KEY || '';
    this.accessKey = config.accessKey || process.env.MASSIVE_ACCESS_KEY || '';
    this.secretKey = config.secretKey || process.env.MASSIVE_SECRET_KEY || '';
    this.useS3 = config.useS3 !== false && !!this.accessKey && !!this.secretKey;
    this.cacheDir = config.cacheDir || './data/massive_cache';
  }

  /**
   * Fetch aggregate bars via REST API.
   * @param {string} symbol - Ticker symbol
   * @param {number} multiplier - Aggregate multiplier
   * @param {string} timespan - 'second', 'minute', 'hour', 'day', 'week', 'month', 'quarter', 'year'
   * @param {string} from - Start date YYYY-MM-DD
   * @param {string} to - End date YYYY-MM-DD
   * @param {number} limit - Max results per request (default 50000)
   * @returns {Promise<Array>} Standardized bars
   */
  async fetchAggregates(symbol, multiplier, timespan, from, to, limit = 50000) {
    if (!this.apiKey) throw new Error('Massive API key required');

    const results = [];
    let cursor = null;
    let round = 0;

    do {
      const url = cursor
        ? cursor
        : `${MASSIVE_REST_BASE}/aggs/ticker/${symbol}/range/${multiplier}/${timespan}/${from}/${to}?adjusted=true&sort=asc&limit=${limit}&apiKey=${this.apiKey}`;

      const res = await fetch(url);
      const data = await res.json();

      if (data.status === 'ERROR' || data.status === 'NOT_AUTHORIZED') {
        // Rate limit or error - retry once after delay
        if (round === 0) {
          await new Promise(r => setTimeout(r, 1000));
          round++;
          continue;
        }
        throw new Error(`Massive API error: ${data.message || data.status}`);
      }

      if (data.results && data.results.length) {
        results.push(...data.results.map((r) => this._convertAggregate(symbol, r, timespan)));
      }

      cursor = data.next_url || null;
      round++;
    } while (cursor && round < 10); // safety limit

    return results;
  }

  /**
   * Fetch 1-second bars.
   */
  async fetchSecondBars(symbol, from, to) {
    return this.fetchAggregates(symbol, 1, 'second', from, to, 50000);
  }

  /**
   * Fetch 1-minute bars.
   */
  async fetchMinuteBars(symbol, from, to) {
    return this.fetchAggregates(symbol, 1, 'minute', from, to, 50000);
  }

  /**
   * Fetch daily bars.
   */
  async fetchDailyBars(symbol, from, to) {
    return this.fetchAggregates(symbol, 1, 'day', from, to, 500);
  }

  /**
   * Fetch opening window bars (first N minutes of trading day).
   * @param {string} symbol
   * @param {string} date - YYYY-MM-DD
   * @param {number} minutes - Window length in minutes (default 30)
   * @param {string} timespan - 'second' or 'minute'
   * @returns {Promise<Array>} Bars in the opening window
   */
  async fetchOpeningWindow(symbol, date, minutes = 30, timespan = 'minute') {
    const bars = await this.fetchAggregates(symbol, 1, timespan, date, date);
    // Market opens at 9:30 AM ET = 14:30 UTC
    // Filter bars in the first N minutes after 09:30:00
    const windowEnd = new Date(`${date}T09:30:00`);
    windowEnd.setMinutes(windowEnd.getMinutes() + minutes);

    return bars.filter((b) => {
      const t = b.time;
      return t >= '09:30:00' && parseInt(t.split(':')[1]) < 30 + (minutes > 30 ? minutes - 30 : 0);
    }).slice(0, timespan === 'second' ? minutes * 60 : minutes);
  }

  /**
   * Convert Massive aggregate bar to standard format.
   * Massive returns Unix ms timestamps in 't' field.
   * Converts to US/Eastern time for market-hours filtering.
   */
  _convertAggregate(symbol, agg, timespan) {
    const utcDate = new Date(agg.t);
    // Convert to US/Eastern time
    // US/Eastern: UTC-5 (EST) or UTC-4 (EDT, Mar-Nov)
    const etOffsetMs = this._getEasternOffset(utcDate);
    const etDate = new Date(utcDate.getTime() + etOffsetMs);

    const dateStr = etDate.toISOString().slice(0, 10);
    const timeStr = etDate.toISOString().slice(11, 19);

    return {
      symbol,
      date: dateStr,
      time: timeStr,
      open: agg.o,
      high: agg.h,
      low: agg.l,
      close: agg.c,
      volume: agg.v,
      timestamp: agg.t,
      vwap: agg.vw,
      transactions: agg.n,
    };
  }

  /**
   * Get US/Eastern timezone offset in milliseconds (negative = behind UTC).
   * Handles DST: EDT = UTC-4, EST = UTC-5.
   * DST in US: 2nd Sunday of March to 1st Sunday of November.
   */
  _getEasternOffset(date) {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth(); // 0-11
    const day = date.getUTCDate();
    const hour = date.getUTCHours();

    // November-Feb: EST (UTC-5)
    if (month < 2 || month > 10) return 5 * 3600 * 1000;

    // Find 2nd Sunday of March
    const mar1 = new Date(Date.UTC(year, 2, 1));
    const marDOW = mar1.getUTCDay(); // 0=Sun
    const dstStart = 14 - marDOW; // 2nd Sunday
    if (month === 2) { // March
      if (day < dstStart) return 5 * 3600 * 1000; // EST
      if (day === dstStart && hour < 7) return 5 * 3600 * 1000; // before 2am ET = 7am UTC
      return 4 * 3600 * 1000; // EDT
    }

    // Find 1st Sunday of November
    const nov1 = new Date(Date.UTC(year, 10, 1));
    const novDOW = nov1.getUTCDay();
    const dstEnd = novDOW === 0 ? 1 : 1 + (7 - novDOW);
    if (month === 10) { // November
      if (day < dstEnd) return 4 * 3600 * 1000; // EDT
      if (day === dstEnd && hour < 6) return 4 * 3600 * 1000; // before 2am ET = 6am UTC
      return 5 * 3600 * 1000; // EST
    }

    // April-October: EDT (UTC-4)
    return 4 * 3600 * 1000;
  }

  /**
   * List available dates in S3 flat files for a data type.
   * @param {string} assetClass - 'us_stocks_sip'
   * @param {string} dataType - 'minute_aggs_v1', 'day_aggs_v1', 'trades_v1', 'quotes_v1'
   * @param {string} yearMonth - 'YYYY/MM'
   * @returns {Promise<Array<string>>} List of file keys
   */
  async listFlatFiles(assetClass = 'us_stocks_sip', dataType = 'minute_aggs_v1', yearMonth = '2026/02') {
    if (!this.useS3) throw new Error('S3 access not configured');
    const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
    const s3 = new S3Client({
      endpoint: MASSIVE_S3_ENDPOINT,
      region: 'us-east-1',
      credentials: { accessKeyId: this.accessKey, secretAccessKey: this.secretKey },
      forcePathStyle: true,
    });
    const prefix = `${assetClass}/${dataType}/${yearMonth}/`;
    const cmd = new ListObjectsV2Command({ Bucket: MASSIVE_S3_BUCKET, Prefix: prefix, MaxKeys: 100 });
    const result = await s3.send(cmd);
    return (result.Contents || []).map((o) => o.Key);
  }

  /**
   * Download and parse a flat file for a specific symbol.
   * Downloads the whole day file, filters to target symbol.
   */
  async downloadFlatFile(key, filterSymbol = null) {
    if (!this.useS3) throw new Error('S3 access not configured');
    const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
    const zlib = await import('node:zlib');
    const { Readable } = await import('node:stream');

    const s3 = new S3Client({
      endpoint: MASSIVE_S3_ENDPOINT,
      region: 'us-east-1',
      credentials: { accessKeyId: this.accessKey, secretAccessKey: this.secretKey },
      forcePathStyle: true,
    });

    const cmd = new GetObjectCommand({ Bucket: MASSIVE_S3_BUCKET, Key: key });
    const result = await s3.send(cmd);
    const body = await result.Body.transformToByteArray();
    const decompressed = zlib.gunzipSync(Buffer.from(body)).toString('utf-8');

    const lines = decompressed.trim().split('\n');
    const header = lines[0].split(',');

    const bars = [];
    for (let i = 1; i < lines.length; i++) {
      const row = lines[i].split(',');
      const tickerIdx = header.findIndex((h) => h === 'ticker');
      if (filterSymbol && row[tickerIdx] !== filterSymbol) continue;

      const bar = this._convertFlatRow(row, header);
      if (bar) bars.push(bar);
    }

    return bars;
  }

  _convertFlatRow(row, header) {
    const get = (name) => row[header.indexOf(name)];
    const ticker = get('ticker');
    const timestamp = parseInt(get('window_start'), 10);
    // window_start is in nanoseconds for minute aggs
    const ms = timestamp > 1e15 ? Math.floor(timestamp / 1e6) : timestamp;
    const utcDate = new Date(ms);
    const etOffsetMs = this._getEasternOffset(utcDate);
    const etDate = new Date(utcDate.getTime() + etOffsetMs);

    return {
      symbol: ticker,
      date: etDate.toISOString().slice(0, 10),
      time: etDate.toISOString().slice(11, 19),
      open: parseFloat(get('open')),
      high: parseFloat(get('high')),
      low: parseFloat(get('low')),
      close: parseFloat(get('close')),
      volume: parseFloat(get('volume')),
      timestamp: ms,
      transactions: get('transactions') ? parseInt(get('transactions'), 10) : null,
    };
  }

  /**
   * Fetch daily bars for marker computation.
   * Returns array of { date, o, h, l, c, v } format used by MarkerService.
   */
  async fetchDailyForMarkers(symbol, from, to) {
    const bars = await this.fetchDailyBars(symbol, from, to);
    return bars.map((b) => ({
      date: b.date,
      o: b.open,
      h: b.high,
      l: b.low,
      c: b.close,
      v: b.volume,
    }));
  }
}
