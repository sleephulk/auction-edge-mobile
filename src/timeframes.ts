import type { Bar } from 'openalgo-charts';
import type { RawBar } from './api';
import { SESSION_OPEN_MIN } from './instruments';

export const IST_OFFSET = 19800;
const DAY = 86400;

export type Tf =
  | { kind: 'intraday'; minutes: number }
  | { kind: 'day' }
  | { kind: 'week' };

/** The interval codes the app offers. Everything intraday is folded from 1-minute bars on the phone. */
export const INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '1d', '1w'] as const;

export function parseInterval(code: string): Tf | null {
  const c = code.trim();
  const m = /^(\d+)\s*(m|h)$/i.exec(c);
  if (m) {
    const n = Number(m[1]) * (m[2]!.toLowerCase() === 'h' ? 60 : 1);
    return n >= 1 && n <= 375 ? { kind: 'intraday', minutes: n } : null;
  }
  if (/^(1d|d)$/i.test(c)) return { kind: 'day' };
  if (/^(1w|w)$/i.test(c)) return { kind: 'week' };
  return null;
}

/** IST midnight of the day holding `t`, as UTC seconds. */
export function istDayStart(t: number): number {
  return Math.floor((t + IST_OFFSET) / DAY) * DAY - IST_OFFSET;
}

/** Monday IST midnight of the week holding `t`. 1970-01-01 was a Thursday. */
export function istWeekStart(t: number): number {
  const dayIdx = Math.floor((t + IST_OFFSET) / DAY);
  const sinceMonday = (((dayIdx + 3) % 7) + 7) % 7;
  return (dayIdx - sinceMonday) * DAY - IST_OFFSET;
}

/**
 * Start of the bucket holding `t`. Intraday buckets are anchored at the 09:15
 * session open, not at the clock hour, so a 30m or 1h bar lines up with the
 * TPO periods (09:15, 09:45, ...; 09:15, 10:15, ...).
 */
export function bucketStart(tf: Tf, t: number): number {
  if (tf.kind === 'day') return istDayStart(t);
  if (tf.kind === 'week') return istWeekStart(t);
  if (tf.minutes === 1) return Math.floor(t / 60) * 60;
  const open = istDayStart(t) + SESSION_OPEN_MIN * 60;
  const span = tf.minutes * 60;
  return open + Math.floor((t - open) / span) * span;
}

export function toBar(r: RawBar): Bar {
  return { time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] };
}

/** Fold ascending base bars into `tf` buckets. A 1m or 1d request against its own base is a straight map. */
export function fold(tf: Tf, base: readonly RawBar[], baseIs: '1m' | '1d'): Bar[] {
  const passthrough = (tf.kind === 'intraday' && tf.minutes === 1) || (tf.kind === 'day' && baseIs === '1d');
  if (passthrough) return base.map(toBar);
  const out: Bar[] = [];
  let cur: Bar | null = null;
  for (const r of base) {
    const b = bucketStart(tf, r[0]);
    if (!cur || cur.time !== b) {
      cur = { time: b, open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] };
      out.push(cur);
    } else {
      if (r[2] > cur.high) cur.high = r[2];
      if (r[3] < cur.low) cur.low = r[3];
      cur.close = r[4];
      cur.volume = (cur.volume ?? 0) + r[5];
    }
  }
  return out;
}
