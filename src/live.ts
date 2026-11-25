import { fetchQuotes, type Quote } from './api';

// One poller for every live consumer (the chart's live bar, the watchlist, the
// ticker strip). The server keeps the newest tick per instrument; asking once a
// second is what "one-second updates" means here. Slower when the relay is not
// live (market closed), and stopped while the page is hidden.

const LIVE_MS = 1000;
const IDLE_MS = 15000;
/** A silence longer than this means minutes were missed: consumers reload history. */
const RESYNC_GAP_MS = 75_000;

export interface QuoteEvent {
  key: string;
  quote: Quote;
  /** The relay is running and fresh; false means `quote` is the last stored bar's close. */
  live: boolean;
}

type QuoteCb = (e: QuoteEvent) => void;
export type HubStatus = 'live' | 'closed' | 'offline';

class QuoteHub {
  private subs = new Map<string, Set<QuoteCb>>();
  private resyncSubs = new Set<() => void>();
  private statusSubs = new Set<(s: HubStatus) => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private lastOk = 0;
  private status: HubStatus = 'closed';
  private last = new Map<string, QuoteEvent>();

  constructor() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.stop();
      else this.kick();
    });
    window.addEventListener('online', () => this.kick());
  }

  subscribe(key: string, cb: QuoteCb): () => void {
    let set = this.subs.get(key);
    if (!set) this.subs.set(key, (set = new Set()));
    set.add(cb);
    const cached = this.last.get(key);
    if (cached) cb(cached);
    this.kick();
    return () => {
      set.delete(cb);
      if (set.size === 0) this.subs.delete(key);
      if (this.subs.size === 0) this.stop();
    };
  }

  onResync(cb: () => void): () => void {
    this.resyncSubs.add(cb);
    return () => this.resyncSubs.delete(cb);
  }

  onStatus(cb: (s: HubStatus) => void): () => void {
    this.statusSubs.add(cb);
    cb(this.status);
    return () => this.statusSubs.delete(cb);
  }

  latest(key: string): QuoteEvent | undefined {
    return this.last.get(key);
  }

  private setStatus(s: HubStatus): void {
    if (s === this.status) return;
    this.status = s;
    for (const cb of this.statusSubs) cb(s);
  }

  private stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private kick(): void {
    if (document.hidden || this.subs.size === 0) return;
    this.stop();
    void this.tick();
  }

  private schedule(ms: number): void {
    this.stop();
    if (document.hidden || this.subs.size === 0) return;
    this.timer = setTimeout(() => void this.tick(), ms);
  }

  private async tick(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    let next = IDLE_MS;
    try {
      const keys = [...this.subs.keys()];
      const res = await fetchQuotes(keys);
      const now = Date.now();
      const gap = this.lastOk ? now - this.lastOk : 0;
      this.lastOk = now;
      this.setStatus(res.live ? 'live' : 'closed');
      // Missed minutes while live (phone slept, network dropped): history first, then ticks.
      if (res.live && gap > RESYNC_GAP_MS) for (const cb of this.resyncSubs) cb();
      for (const key of keys) {
        const quote = res.quotes[key];
        if (!quote) continue;
        const ev: QuoteEvent = { key, quote, live: res.live && quote.source === 'kite' };
        this.last.set(key, ev);
        for (const cb of this.subs.get(key) ?? []) cb(ev);
      }
      next = res.live ? LIVE_MS : IDLE_MS;
    } catch {
      this.setStatus('offline');
      next = 3000;
    } finally {
      this.inFlight = false;
      this.schedule(next);
    }
  }
}

export const quoteHub = new QuoteHub();
