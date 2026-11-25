import { SessionCalendar } from 'openalgo-charts';
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

const fmt = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function mountChart(root: HTMLElement, opts: Options): ChartApp {
  const feed = new AuctionEdgeFeed();
  const cleanups: Array<() => void> = [];

  // ---- ticker strip: one-second prices, tap to chart that instrument -------
  const strip = el('div', 'strip');
  const ticks = el('div', 'ticks');
  strip.append(ticks);
  const stage = el('div', 'stage');
  const host = el('div', 'host');
  stage.append(host);
  root.append(strip, stage);

  const tickButtons = new Map<string, HTMLButtonElement>();
  for (const inst of INSTRUMENTS) {
    const b = el('button', 'tick');
    b.type = 'button';
    b.setAttribute('aria-pressed', 'false');
    const sym = el('span', 'sym', inst.symbol);
    const row = el('span', 'row');
    const ltp = el('span', 'ltp', '—');
    const chg = el('span', 'chg', '');
    row.append(ltp, chg);
    b.append(sym, row);
    b.addEventListener('click', () => widget.setSymbol(inst.symbol, inst.exchange));
    ticks.append(b);
    tickButtons.set(inst.symbol, b);
    cleanups.push(
      quoteHub.subscribe(inst.quoteKey, (e: QuoteEvent) => {
        const q = e.quote;
        ltp.textContent = fmt.format(q.ltp);
        const prev = q.prev_close;
        if (e.live && typeof prev === 'number' && prev > 0) {
          const d = q.ltp - prev;
          chg.textContent = `${d >= 0 ? '+' : ''}${fmt.format(d)} (${((d / prev) * 100).toFixed(2)}%)`;
          chg.className = `chg ${d >= 0 ? 'up' : 'down'}`;
        } else {
          chg.textContent = e.live ? '' : 'last close';
          chg.className = 'chg';
        }
      }),
    );
  }

  const status = el('span', 'status');
  const dot = el('span', 'dot');
  const statusText = el('span', '', 'closed');
  status.append(dot, statusText);
  strip.append(status);
  cleanups.push(
    quoteHub.onStatus((s: HubStatus) => {
      dot.className = `dot ${s === 'live' ? 'live' : s === 'offline' ? 'offline' : ''}`;
      statusText.textContent = s === 'live' ? 'live' : s === 'offline' ? 'offline' : 'closed';
    }),
  );
  const menuBtn = el('button', 'iconbtn', '⋯');
  menuBtn.type = 'button';
  menuBtn.setAttribute('aria-label', 'App menu');
  strip.append(menuBtn);

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
    sessionCalendar: (i) => (findInstrument(i.symbol)?.inst === 'FUTURES' ? CALENDARS.deriv : CALENDARS.index),
    workspaces: new WorkspaceRepository(createIndexedDbWorkspaceStorage(idb, `${NS}-workspaces`), NS),
    drawingTemplates: new DrawingTemplateRepository(createIndexedDbDrawingTemplateStorage(idb, `${NS}-drawing-templates`), NS),
    watchlist: { store: watchlists, quotes: feed },
  });

  const profiles = mountProfiles(widget);
  cleanups.push(() => profiles.destroy());

  if (import.meta.env.DEV) (globalThis as unknown as { __aep?: Widget }).__aep = widget;

  const markActive = (): void => {
    const s = widget.symbol();
    for (const [sym, b] of tickButtons) b.setAttribute('aria-pressed', String(sym === s));
  };
  cleanups.push(widget.on('symbol', markActive));
  void widget.ready.then(markActive);

  // ---- app menu ---------------------------------------------------------------
  let closeSheet: (() => void) | null = null;
  const openSheet = (): void => {
    const backdrop = el('div', 'sheet-backdrop');
    const sheet = el('div', 'sheet');
    const close = (): void => {
      backdrop.remove();
      sheet.remove();
      closeSheet = null;
    };
    closeSheet = close;
    backdrop.addEventListener('click', close);
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
    sheet.append(el('h2', '', 'AE Pocket'));
    const ps = profiles.state();
    row('Market Profile (TPO)', profiles.unavailable('tpo') ?? (ps.tpo ? 'on' : 'off'), () => profiles.toggle('tpo'));
    row('Volume Profile', profiles.unavailable('vp') ?? (ps.vp ? 'on' : 'off'), () => profiles.toggle('vp'));
    row('Indicators', '113 built in', () => widget.openIndicatorPicker());
    row('Alerts', 'price, study, drawing', () => widget.openAlerts());
    row('Watchlist', 'live quotes', () => widget.openWatchlist());
    row('Layouts', 'save and reopen', () => widget.openLayouts());
    row('Objects', 'drawings and studies', () => widget.openObjects());
    row('Chart settings', '', () => widget.openSettings());
    row('Reload data', '', () => void widget.reload());
    row('Sign out', opts.email, opts.onSignOut);
    document.body.append(backdrop, sheet);
  };
  menuBtn.addEventListener('click', openSheet);

  return {
    destroy(): void {
      closeSheet?.();
      for (const c of cleanups) c();
      widget.destroy();
    },
  };
}
