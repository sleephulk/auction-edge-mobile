import { PriceLevels, SessionCalendar } from 'openalgo-charts';
import { registerDrawingTool, registeredDrawingTools } from 'openalgo-charts/draw';
import 'openalgo-charts/indicators';
import 'openalgo-charts/transform';
import { createWidget, type Widget } from 'openalgo-charts/widget';
import {
  DrawingTemplateRepository,
  WatchlistRepository,
  WorkspaceRepository,
  createIndexedDbDrawingTemplateStorage,
  createIndexedDbWatchlistStorage,
  createIndexedDbWorkspaceStorage,
} from 'openalgo-charts/workspace';
import { AuctionEdgeFeed } from './feed';
import { FIXED_RANGE_TPO, FIXED_RANGE_TPO_ID } from './fixedTpo';
import { INSTRUMENTS, findInstrument } from './instruments';
import { mountProfiles } from './profiles';
import { quoteHub, type HubStatus, type QuoteEvent } from './live';
import { INTERVALS } from './timeframes';

export interface ChartApp {
  destroy(): void;
}

interface Options {
  email: string;
  onSignOut(): void;
}

const NS = 'ae-pocket';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const CALENDARS = {
  index: new SessionCalendar({ timezone: 'Asia/Kolkata', sessions: ['0915-1530:23456'] }),
  deriv: new SessionCalendar({ timezone: 'Asia/Kolkata', sessions: ['0915-1540:23456'] }),
};

if (!registeredDrawingTools().some((t) => t.id === FIXED_RANGE_TPO_ID)) registerDrawingTool(FIXED_RANGE_TPO);

/** a****@gmail.com: enough to recognise the account, not enough to read it off a screenshot. */
function maskEmail(email: string): string {
  const [user = '', domain = ''] = email.split('@');
  return `${user.slice(0, 1)}${'*'.repeat(Math.max(3, user.length - 1))}@${domain}`;
}

const fmt = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function mountChart(root: HTMLElement, opts: Options): ChartApp {
  const feed = new AuctionEdgeFeed();
  const cleanups: Array<() => void> = [];

  // ---- header: one slim row. The symbol is a picker (tap -> instruments with
  // live prices), then the interval, the feed status and the app menu. The
  // widget's own symbol box is hidden (style.css), which gives the chart back
  // its row.
  const strip = el('div', 'strip');
  const stage = el('div', 'stage');
  const host = el('div', 'host');
  stage.append(host);
  root.append(strip, stage);

  const pick = el('button', 'pick');
  pick.type = 'button';
  pick.setAttribute('aria-label', 'Change instrument');
  const pickSym = el('span', 'sym', 'NIFTY');
  const pickLtp = el('span', 'ltp', '—');
  const pickChg = el('span', 'chg', '');
  pick.append(pickSym, el('span', 'caret', '▾'), pickLtp, pickChg);

  const ivBtn = el('button', 'ivbtn', '1m');
  ivBtn.type = 'button';
  ivBtn.setAttribute('aria-label', 'Change interval');

  const status = el('span', 'status');
  const dot = el('span', 'dot');
  const statusText = el('span', '', 'closed');
  status.append(dot, statusText);
  const menuBtn = el('button', 'iconbtn', '⋯');
  menuBtn.type = 'button';
  menuBtn.setAttribute('aria-label', 'App menu');
  strip.append(pick, ivBtn, status, menuBtn);

  cleanups.push(
    quoteHub.onStatus((s: HubStatus) => {
      dot.className = `dot ${s === 'live' ? 'live' : s === 'offline' ? 'offline' : ''}`;
      statusText.textContent = s === 'live' ? 'live' : s === 'offline' ? 'offline' : 'closed';
    }),
  );

  // Latest quote per instrument, for the header and the picker rows.
  interface Shown { ltp: string; chg: string; cls: string }
  const shown = new Map<string, Shown>();
  const pickerRows = new Map<string, { ltp: HTMLElement; chg: HTMLElement }>();
  const describe = (e: QuoteEvent): Shown => {
    const q = e.quote;
    const prev = q.prev_close;
    if (e.live && typeof prev === 'number' && prev > 0) {
      const d = q.ltp - prev;
      return {
        ltp: fmt.format(q.ltp),
        chg: `${d >= 0 ? '+' : ''}${fmt.format(d)} (${((d / prev) * 100).toFixed(2)}%)`,
        cls: d >= 0 ? 'chg up' : 'chg down',
      };
    }
    return { ltp: fmt.format(q.ltp), chg: e.live ? '' : 'last close', cls: 'chg' };
  };
  const paint = (symbol: string): void => {
    const v = shown.get(symbol);
    const r = pickerRows.get(symbol);
    if (v && r) {
      r.ltp.textContent = v.ltp;
      r.chg.textContent = v.chg;
      r.chg.className = v.cls;
    }
    if (symbol === pickSym.textContent) {
      pickLtp.textContent = v?.ltp ?? '—';
      pickChg.textContent = v?.chg ?? '';
      pickChg.className = v?.cls ?? 'chg';
    }
  };
  for (const inst of INSTRUMENTS) {
    cleanups.push(
      quoteHub.subscribe(inst.quoteKey, (e: QuoteEvent) => {
        shown.set(inst.symbol, describe(e));
        paint(inst.symbol);
      }),
    );
  }

  // ---- the chart: the whole openalgo widget ---------------------------------
  const idb = globalThis.indexedDB;
  const watchlists = new WatchlistRepository(createIndexedDbWatchlistStorage(idb, `${NS}-watchlists`), NS);
  void watchlists.load().then(async (catalog) => {
    if (catalog.lists.length > 0) return;
    await watchlists.createList(
      'Indices',
      INSTRUMENTS.map((i) => ({ symbol: i.symbol, exchange: i.exchange })),
    );
  }).catch(() => undefined);

  const widget: Widget = createWidget(host, {
    feed,
    symbol: 'NIFTY',
    exchange: 'NSE',
    interval: '1m',
    intervals: INTERVALS,
    theme: 'dark',
    mobile: 'auto',
    persist: NS,
    fullscreen: true,
    // Three sessions of 1-minute bars on open; older history pages in on scroll-left.
    lookbackBars: 1125,
    // Countdown to the bar's close inside the last-price tag; switched on only
    // while the feed is live (below), since after hours it would count nothing.
    axisChrome: { barCountdown: false },
    sessionCalendar: (i) => (findInstrument(i.symbol)?.inst === 'FUTURES' ? CALENDARS.deriv : CALENDARS.index),
    workspaces: new WorkspaceRepository(createIndexedDbWorkspaceStorage(idb, `${NS}-workspaces`), NS),
    drawingTemplates: new DrawingTemplateRepository(createIndexedDbDrawingTemplateStorage(idb, `${NS}-drawing-templates`), NS),
    watchlist: { store: watchlists, quotes: feed },
  });

  // Previous close as a dashed line with its axis tag; the day's high and low as
  // axis tags only, so they don't clutter the plot.
  const levels = new PriceLevels({
    timezone: 'Asia/Kolkata',
    levels: {
      previousClose: { line: true, label: true },
      sessionHigh: { line: false, label: true },
      sessionLow: { line: false, label: true },
    },
  });
  void widget.ready.then(() => widget.chart.addPrimitive(levels, 0));
  cleanups.push(quoteHub.onStatus((s: HubStatus) => widget.chart.setAxisChromeOptions({ barCountdown: s === 'live' })));

  // Reset view: on a phone there is no right-click menu, so the reset sits on
  // the chart itself. Double-tapping the price axis does the same for price.
  const resetBtn = el('button', 'fab', '⟲');
  resetBtn.type = 'button';
  resetBtn.title = 'Reset chart view';
  resetBtn.setAttribute('aria-label', 'Reset chart view');
  resetBtn.addEventListener('click', () => widget.chart.resetScale());
  stage.append(resetBtn);

  const profiles = mountProfiles(widget);
  cleanups.push(() => profiles.destroy());

  if (import.meta.env.DEV) Object.assign(globalThis, { __aep: widget, __aepLevels: levels });

  const syncHeader = (): void => {
    pickSym.textContent = widget.symbol();
    ivBtn.textContent = widget.interval();
    paint(widget.symbol());
  };
  cleanups.push(widget.on('symbol', syncHeader), widget.on('interval', syncHeader));
  void widget.ready.then(syncHeader);

  // ---- bottom sheets: instrument picker, interval picker, app menu ---------
  let closeSheet: (() => void) | null = null;
  const showSheet = (fill: (sheet: HTMLElement, close: () => void) => void): void => {
    closeSheet?.();
    const backdrop = el('div', 'sheet-backdrop');
    const sheet = el('div', 'sheet');
    const close = (): void => {
      backdrop.remove();
      sheet.remove();
      pickerRows.clear();
      closeSheet = null;
    };
    closeSheet = close;
    backdrop.addEventListener('click', close);
    fill(sheet, close);
    document.body.append(backdrop, sheet);
  };

  pick.addEventListener('click', () =>
    showSheet((sheet, close) => {
      sheet.append(el('h2', '', 'Instrument'));
      const current = widget.symbol();
      for (const inst of INSTRUMENTS) {
        const b = el('button', 'pickrow');
        b.type = 'button';
        b.setAttribute('aria-pressed', String(inst.symbol === current));
        const name = el('span', 'name');
        name.append(el('span', '', inst.symbol), el('small', '', inst.inst === 'FUTURES' ? `${inst.exchange} · front month` : inst.exchange));
        const price = el('span', 'price');
        const ltp = el('span', 'ltp', '—');
        const chg = el('span', 'chg', '');
        price.append(ltp, chg);
        b.append(name, price);
        b.addEventListener('click', () => {
          close();
          if (inst.symbol !== widget.symbol()) widget.setSymbol(inst.symbol, inst.exchange);
        });
        sheet.append(b);
        pickerRows.set(inst.symbol, { ltp, chg });
        paint(inst.symbol);
      }
    }),
  );

  ivBtn.addEventListener('click', () =>
    showSheet((sheet, close) => {
      sheet.append(el('h2', '', 'Interval'));
      const grid = el('div', 'ivgrid');
      const current = widget.interval();
      for (const code of INTERVALS) {
        const b = el('button', 'ivchip', code);
        b.type = 'button';
        b.setAttribute('aria-pressed', String(code === current));
        b.addEventListener('click', () => {
          close();
          if (code !== widget.interval()) widget.setInterval(code);
        });
        grid.append(b);
      }
      sheet.append(grid);
    }),
  );

  menuBtn.addEventListener('click', () =>
    showSheet((sheet, close) => {
      const row = (label: string, hint: string, act: () => void): void => {
        const b = el('button');
        b.type = 'button';
        b.append(el('span', '', label), el('small', '', hint));
        b.addEventListener('click', () => {
          close();
          act();
        });
        sheet.append(b);
      };
      const heading = (text: string): void => {
        sheet.append(el('h2', '', text));
      };
      const arm = (tool: string): void => widget.draw.setTool(tool);
      const futures = findInstrument(widget.symbol())?.inst === 'FUTURES';
      heading('Profiles');
      const ps = profiles.state();
      row('Market Profile (TPO)', profiles.unavailable('tpo') ?? (ps.tpo ? 'on' : 'off'), () => profiles.toggle('tpo'));
      row('Volume Profile', profiles.unavailable('vp') ?? (ps.vp ? 'on' : 'off'), () => profiles.toggle('vp'));
      heading('Draw on the chart');
      row('Fixed-range TPO', 'tap start, then end', () => arm(FIXED_RANGE_TPO_ID));
      row('Fixed-range Volume Profile', futures ? 'tap start, then end' : 'futures only (an index has no volume)', () => arm('fixed-range-volume-profile'));
      row('Anchored VWAP', futures ? 'tap the anchor bar' : 'futures only (an index has no volume)', () => arm('anchored-vwap'));
      heading('Chart');
      row('Reset chart view', 'or double-tap the price axis', () => widget.chart.resetScale());
      row('Alerts', 'price, study, drawing', () => widget.openAlerts());
      row('Watchlist', 'live quotes', () => widget.openWatchlist());
      row('Layouts', 'save and reopen', () => widget.openLayouts());
      row('Chart settings', '', () => widget.openSettings());
      row('Reload data', '', () => void widget.reload());
      row('Sign out', maskEmail(opts.email), opts.onSignOut);
    }),
  );

  return {
    destroy(): void {
      closeSheet?.();
      for (const c of cleanups) c();
      widget.destroy();
    },
  };
}
