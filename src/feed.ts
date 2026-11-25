import type {
  Bar,
  BarSubscriptionOptions,
  BarsPage,
  BarsPageRequest,
  BarsRequest,
  DataFeed,
  InstrumentKey,
  LiveBarMeta,
  QuoteFeed,
  QuoteRequest,
  QuoteSnapshot,
  QuoteStreamHandlers,
  SymbolMatch,
  SymbolSearchRequest,
} from 'openalgo-charts';
import { fetchCandles, type MinuteBar, type RawBar } from './api';
import { INSTRUMENTS, SESSION_OPEN_MIN, findInstrument, type InstrumentDef } from './instruments';
import { quoteHub, type QuoteEvent } from './live';
import { IST_OFFSET, bucketStart, fold, istDayStart, parseInterval, type Tf } from './timeframes';

const PAGE_MAX = 5000;
/** One request on first load (13 sessions of 1-minute bars); older history pages in on scroll-left. */
const FIRST_LOAD_MAX = 5000;

function resolve(req: { symbol: string; interval: string }): { def: InstrumentDef; tf: Tf } {
  const def = findInstrument(req.symbol);
  if (!def) throw new Error(`Unknown symbol ${req.symbol}`);
  const tf = parseInterval(req.interval);
  if (!tf) throw new Error(`Unsupported interval ${req.interval}`);
  return { def, tf };
}

/** Base bars needed for one bar of `tf`. */
function perBar(tf: Tf): number {
  if (tf.kind === 'intraday') return tf.minutes;
  return tf.kind === 'week' ? 5 : 1;
}

function baseOf(tf: Tf): '1m' | '1d' {
  return tf.kind === 'intraday' ? '1m' : '1d';
}

/**
 * Fold a page and drop its first bucket when older base bars exist: that bucket
 * may be cut by the page edge, and the next page (anchored at the returned
 * `nextBefore`) reads it whole.
 */
function foldPage(tf: Tf, raw: RawBar[], hasMore: boolean, serverNext: number | null): BarsPage {
  const bars = fold(tf, raw, baseOf(tf));
  if (!hasMore) return { bars, hasMore: false };
  if (bars.length > 1) {
    bars.shift();
    return { bars, hasMore: true, nextBefore: bars[0]!.time };
  }
  const page: BarsPage = { bars, hasMore: true };
  const next = bars[0]?.time ?? serverNext;
  if (next != null) page.nextBefore = next;
  return page;
}

function minuteOfDayIst(t: number): number {
  return Math.floor((((t + IST_OFFSET) % 86400) + 86400) % 86400 / 60);
}

export class AuctionEdgeFeed implements DataFeed, QuoteFeed {
  async getBars(req: BarsRequest): Promise<Bar[]> {
    const { def, tf } = resolve(req);
    const k = perBar(tf);
    const want = Math.max(50, req.countBack ?? 500);
    const need = Math.min(FIRST_LOAD_MAX, want * k + k);
    let raw: RawBar[] = [];
    let before: number | undefined;
    let hasMore = true;
    while (raw.length < need && hasMore) {
      const page = await fetchCandles(def.root, def.inst, baseOf(tf), before, Math.min(PAGE_MAX, need - raw.length), req.signal);
      raw = page.bars.concat(raw);
      hasMore = page.has_more && page.next_before != null;
      before = page.next_before ?? undefined;
      if (page.bars.length === 0) break;
    }
    return foldPage(tf, raw, hasMore, before ?? null).bars;
  }

  async getBarsPage(req: BarsPageRequest): Promise<BarsPage> {
    const { def, tf } = resolve(req);
    const k = perBar(tf);
    const count = Math.min(PAGE_MAX, Math.max(3 * k, req.countBack * k + k));
    const page = await fetchCandles(def.root, def.inst, baseOf(tf), req.before, count, req.signal);
    return foldPage(tf, page.bars, page.has_more && page.next_before != null, page.next_before);
  }

  subscribeBars(
    req: BarsRequest,
    onBar: (bar: Bar, meta?: LiveBarMeta) => void,
    opts?: BarSubscriptionOptions,
  ): () => void {
    const { def, tf } = resolve(req);
    let cur: Bar | null = opts?.seedFrom ? { ...opts.seedFrom } : null;
    let opened = false; // a bucket this subscription opened itself
    let provisional = false;
    let volBase: number | null = null;
    let lastCum: number | null = null;

    const widen = (bar: Bar, m: MinuteBar | null | undefined, bucket: number): void => {
      if (!m || bucketStart(tf, m.t) !== bucket) return;
      if (m.h > bar.high) bar.high = m.h;
      if (m.l < bar.low) bar.low = m.l;
    };

    const onQuote = (e: QuoteEvent): void => {
      if (!e.live) return;
      const q = e.quote;
      const ltp = q.ltp;
      const cum = typeof q.volume === 'number' && q.volume > 0 ? q.volume : null;

      if (tf.kind !== 'intraday') {
        // The exchange's own day open/high/low come with every tick.
        const day = istDayStart(q.ts);
        const b = tf.kind === 'day' ? day : bucketStart(tf, q.ts);
        const dOpen = q.open ?? ltp;
        const dHigh = Math.max(q.high ?? ltp, ltp);
        const dLow = Math.min(q.low ?? ltp, ltp);
        if (!cur || b > cur.time) cur = { time: b, open: dOpen, high: dHigh, low: dLow, close: ltp };
        else if (b === cur.time) {
          cur.high = Math.max(cur.high, dHigh);
          cur.low = Math.min(cur.low, dLow);
          cur.close = ltp;
        } else return;
        if (tf.kind === 'day' && cum != null) cur.volume = cum;
        onBar({ ...cur });
        return;
      }

      const mod = minuteOfDayIst(q.ts);
      if (mod < SESSION_OPEN_MIN || mod >= def.closeMin) return;
      const b = bucketStart(tf, q.ts);
      if (cur && b < cur.time) return;
      if (!cur || b > cur.time) {
        // First tick after subscribing that lands past the seed: minutes may
        // have been missed, so the bar says so and history keeps its own open.
        provisional = !opened && cur !== null && b - cur.time > tf.minutes * 60;
        const m = q.bar && bucketStart(tf, q.bar.t) === b && tf.minutes === 1 ? q.bar : null;
        cur = { time: b, open: m?.o ?? ltp, high: m?.h ?? ltp, low: m?.l ?? ltp, close: ltp };
        opened = true;
        volBase = lastCum;
      }
      widen(cur, q.prev_bar, b);
      widen(cur, q.bar, b);
      if (ltp > cur.high) cur.high = ltp;
      if (ltp < cur.low) cur.low = ltp;
      cur.close = ltp;
      if (cum != null) {
        if (opened && volBase != null) cur.volume = Math.max(0, cum - volBase);
        lastCum = cum;
      }
      onBar({ ...cur }, provisional ? { provisional: true } : undefined);
    };

    const offQuote = quoteHub.subscribe(def.quoteKey, onQuote);
    const offResync = opts?.onResync ? quoteHub.onResync(opts.onResync) : () => {};
    return () => {
      offQuote();
      offResync();
    };
  }

  async searchSymbols(request: SymbolSearchRequest): Promise<SymbolMatch[]> {
    const q = request.query.trim().toUpperCase();
    return INSTRUMENTS.filter((i) => !q || i.symbol.includes(q) || i.name.toUpperCase().includes(q)).map((i) => ({
      symbol: i.symbol,
      exchange: i.exchange,
      name: i.name,
    }));
  }

  // ---- QuoteFeed (watchlist rows) -----------------------------------------

  async getQuotes(request: QuoteRequest): Promise<QuoteSnapshot[]> {
    const out: QuoteSnapshot[] = [];
    for (const key of request.instruments) {
      const def = findInstrument(key.symbol);
      const ev = def ? quoteHub.latest(def.quoteKey) : undefined;
      if (def && ev) out.push(snapshot(def, ev));
    }
    return out;
  }

  subscribeQuotes(instruments: readonly InstrumentKey[], handlers: QuoteStreamHandlers): () => void {
    const offs: Array<() => void> = [];
    for (const key of instruments) {
      const def = findInstrument(key.symbol);
      if (!def) continue;
      offs.push(quoteHub.subscribe(def.quoteKey, (ev) => handlers.onQuote(snapshot(def, ev))));
    }
    offs.push(
      quoteHub.onStatus((s) => handlers.onStatus?.(s === 'offline' ? 'reconnecting' : 'live')),
    );
    return () => offs.forEach((off) => off());
  }
}

function snapshot(def: InstrumentDef, ev: QuoteEvent): QuoteSnapshot {
  const q = ev.quote;
  const snap: QuoteSnapshot = { symbol: def.symbol, exchange: def.exchange, last: q.ltp, time: Math.floor(q.ts) };
  if (typeof q.prev_close === 'number') snap.previousClose = q.prev_close;
  if (typeof q.volume === 'number') snap.volume = q.volume;
  if (!ev.live) snap.delayed = true;
  return snap;
}
