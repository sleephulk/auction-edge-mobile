import { accessToken } from './auth';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

// A phone drops requests: a cell handover, the screen locking mid-load, a
// reused connection the server already closed. Those surface as a TypeError
// ("Failed to fetch") with no response at all, so they are retried with a short
// backoff. An abort (the chart moved on) and an HTTP error are not retried here.
const NETWORK_RETRY_MS = [400, 1200, 3000];

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(signal.reason ?? new DOMException('aborted', 'AbortError'));
    }, { once: true });
  });
}

interface Fetched { status: number; ok: boolean; text: string }

/** Fetch and read the whole body, retrying network failures in either step. */
async function fetchRetrying(path: string, init: RequestInit, signal?: AbortSignal): Promise<Fetched> {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(path, init);
      return { status: res.status, ok: res.ok, text: await res.text() };
    } catch (e) {
      if (signal?.aborted || !(e instanceof TypeError) || i >= NETWORK_RETRY_MS.length) {
        if (e instanceof TypeError) throw new ApiError(`network error, ${i + 1} tries (${e.message})`, 0);
        throw e;
      }
      await wait(NETWORK_RETRY_MS[i]!, signal);
    }
  }
}

/** GET a same-origin API path as JSON, with the session's Bearer token; one retry after a forced refresh on 401. */
export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await accessToken(attempt === 1);
    if (!token) throw new ApiError('not signed in', 401);
    const init: RequestInit = { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' };
    if (signal) init.signal = signal;
    const res = await fetchRetrying(path, init, signal);
    if (res.status === 401 && attempt === 0) continue;
    if (!res.ok) throw new ApiError(`${path} -> ${res.status}`, res.status);
    return JSON.parse(res.text) as T;
  }
  throw new ApiError('unauthorised', 401);
}

export type Inst = 'INDEX' | 'FUTURES';
export type RawBar = [t: number, o: number, h: number, l: number, c: number, v: number];

export interface CandlePage {
  bars: RawBar[];
  has_more: boolean;
  next_before: number | null;
}

export function fetchCandles(
  symbol: string,
  inst: Inst,
  tf: '1m' | '1d',
  before: number | undefined,
  count: number,
  signal?: AbortSignal,
): Promise<CandlePage> {
  const q = new URLSearchParams({ tf, inst, count: String(count) });
  if (before !== undefined) q.set('before', String(Math.floor(before)));
  return getJson<CandlePage>(`/api/mobile/candles/${encodeURIComponent(symbol)}?${q}`, signal);
}

export interface MinuteBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface Quote {
  ltp: number;
  ts: number;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  prev_close?: number | null;
  volume?: number | null;
  oi?: number | null;
  bar?: MinuteBar | null;
  prev_bar?: MinuteBar | null;
  source: string;
}

export interface QuoteResponse {
  quotes: Record<string, Quote>;
  live: boolean;
  age_s: number | null;
  server_ts: number;
}

export function fetchQuotes(keys: readonly string[], signal?: AbortSignal): Promise<QuoteResponse> {
  return getJson<QuoteResponse>(`/api/mobile/quote?symbols=${encodeURIComponent(keys.join(','))}`, signal);
}
