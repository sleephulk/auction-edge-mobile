import type { Bar } from 'openalgo-charts';
import type { DrawContext, DrawingTool, HitContext } from 'openalgo-charts/draw';
import { computeMarketProfile, type MarketProfileSessionResult } from 'openalgo-charts/profile';
import { TPO_COLORS } from './profileStyle';

// Fixed-range TPO: two taps mark a time range, and the drawing shows one
// Market Profile over the bars between them (30-minute periods, 70% value
// area). Works on the index too, since TPO needs no volume. The anchors' prices
// are ignored; only their times matter.

export const FIXED_RANGE_TPO_ID = 'fixed-range-tpo';

const TICK = 0.05;
const MAX_COLUMN_PX = 6;

/** A row height that gives about 40 rows over the range, on a 1-2-5 step. */
function rowSize(high: number, low: number): number {
  const raw = Math.max((high - low) / 40, TICK);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  return Math.max(TICK, step);
}

interface Cached {
  key: string;
  session: MarketProfileSessionResult | null;
}
const cache = new WeakMap<object, Cached>();

function profileFor(drawing: DrawContext['drawing'], bars: readonly Bar[]): MarketProfileSessionResult | null {
  const [a, b] = drawing.points;
  if (!a || !b) return null;
  const t0 = Math.min(a.time, b.time);
  const t1 = Math.max(a.time, b.time);
  const inRange = bars.filter((x) => x.time >= t0 && x.time <= t1);
  const last = inRange[inRange.length - 1];
  const key = `${t0}:${t1}:${inRange.length}:${last?.time ?? 0}:${last?.close ?? 0}:${last?.high ?? 0}:${last?.low ?? 0}`;
  const hit = cache.get(drawing);
  if (hit && hit.key === key) return hit.session;
  let session: MarketProfileSessionResult | null = null;
  if (inRange.length >= 2) {
    let hi = -Infinity;
    let lo = Infinity;
    for (const x of inRange) {
      if (x.high > hi) hi = x.high;
      if (x.low < lo) lo = x.low;
    }
    const result = computeMarketProfile(inRange, {
      tickSize: TICK,
      rowTicks: Math.round(rowSize(hi, lo) / TICK),
      session: 'composite',
      blockMinutes: 30,
      valueAreaPercent: 0.7,
      initialBalancePeriods: 2,
      timezone: 'Asia/Kolkata',
    });
    session = result.sessions[0] ?? null;
  }
  cache.set(drawing, { key, session });
  return session;
}

function xs(pts: readonly { x: number }[]): [number, number] {
  const a = pts[0]?.x ?? 0;
  const b = pts[1]?.x ?? a;
  return [Math.min(a, b), Math.max(a, b)];
}

export const FIXED_RANGE_TPO: DrawingTool = {
  id: FIXED_RANGE_TPO_ID,
  name: 'Fixed Range TPO',
  points: 2,
  defaultStyle: { color: TPO_COLORS.va, lineWidth: 1 },

  draw(c: DrawContext): void {
    const { ctx, rc, pts, drawing } = c;
    const dpr = rc.dpr;
    const [x0, x1] = xs(pts);
    const width = Math.max(x1 - x0, 1);

    // The range itself: a faint box edge so the span is visible while placing.
    ctx.save();
    ctx.strokeStyle = TPO_COLORS.edge;
    ctx.globalAlpha = c.selected ? 0.9 : 0.45;
    ctx.lineWidth = dpr;
    ctx.setLineDash([4 * dpr, 4 * dpr]);
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    ctx.lineTo(x0, rc.plotHeight * dpr);
    ctx.moveTo(x1, 0);
    ctx.lineTo(x1, rc.plotHeight * dpr);
    ctx.stroke();
    ctx.restore();

    const bars = rc.bars?.() ?? [];
    const s = profileFor(drawing, bars);
    if (!s || s.levels.length === 0) return;

    const y = (p: number): number => rc.priceScale.priceToY(p) * dpr;
    const rowPts = s.levels.length > 1 ? Math.abs(s.levels[1]!.price - s.levels[0]!.price) : rowSize(s.high, s.low);
    const maxCount = s.levels.reduce((m, l) => Math.max(m, l.count), 1);
    const col = Math.min(MAX_COLUMN_PX * dpr, width / maxCount);

    ctx.save();
    for (const lvl of s.levels) {
      const top = y(lvl.price + rowPts);
      const bottom = y(lvl.price);
      const h = Math.max(Math.abs(bottom - top) - dpr, dpr);
      const inVa = lvl.price >= s.val && lvl.price <= s.vah;
      ctx.fillStyle = inVa ? TPO_COLORS.va : TPO_COLORS.outside;
      ctx.globalAlpha = inVa ? 0.85 : 0.5;
      ctx.fillRect(x0, Math.min(top, bottom), lvl.count * col, h);
    }
    ctx.globalAlpha = 1;

    const line = (price: number, color: string, w: number, dash: number[]): void => {
      const yy = Math.round(y(price + rowPts / 2));
      ctx.strokeStyle = color;
      ctx.lineWidth = w * dpr;
      ctx.setLineDash(dash.map((d) => d * dpr));
      ctx.beginPath();
      ctx.moveTo(x0, yy);
      ctx.lineTo(x1, yy);
      ctx.stroke();
    };
    line(s.vah, TPO_COLORS.edge, 1, [3, 3]);
    line(s.val, TPO_COLORS.edge, 1, [3, 3]);
    line(s.poc, TPO_COLORS.poc, 2, []);

    ctx.setLineDash([]);
    ctx.font = `${10 * dpr}px system-ui, sans-serif`;
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = TPO_COLORS.poc;
    const label = (txt: string, price: number): void => {
      const w = ctx.measureText(txt).width;
      ctx.fillText(txt, Math.max(x0, x1 - w - 2 * dpr), y(price + rowPts / 2) - 2 * dpr);
    };
    label(`POC ${c.formatPrice(s.poc + rowPts / 2)}`, s.poc);
    ctx.fillStyle = TPO_COLORS.edge;
    label(`VAH ${c.formatPrice(s.vah + rowPts)}`, s.vah);
    label(`VAL ${c.formatPrice(s.val)}`, s.val);
    ctx.restore();
  },

  distance(x: number, yy: number, c: HitContext): number | null {
    const [x0, x1] = xs(c.pts);
    if (x < x0 - 4 || x > x1 + 4) return null;
    const s = profileFor(c.drawing, c.rc.bars?.() ?? []);
    if (!s) return Math.min(Math.abs(x - x0), Math.abs(x - x1));
    const top = c.rc.priceScale.priceToY(s.high);
    const bottom = c.rc.priceScale.priceToY(s.low);
    if (yy >= Math.min(top, bottom) - 4 && yy <= Math.max(top, bottom) + 4) return 0;
    return null;
  },
};
