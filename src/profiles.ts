import type { Bar } from 'openalgo-charts';
import {
  MarketProfile,
  TRADING_HOURS,
  VolumeProfile,
  computeMarketProfile,
  computeVolumeProfileSessions,
} from 'openalgo-charts/profile';
import type { Widget } from 'openalgo-charts/widget';
import { findInstrument } from './instruments';
import { parseInterval } from './timeframes';
import { TPO_COLORS as STYLE, VP_COLORS } from './profileStyle';

// Market Profile (TPO) and Volume Profile over the bars the chart already
// holds. Both are per-session, 70% value area, India hours. Recomputed when the
// instrument, the interval or the data changes (at most every few seconds while
// the live bar ticks).

const TPO_STYLE = {
  colorMode: 'valueArea',
  vaColor: STYLE.va,
  color: STYLE.outside,
  outsideVaOpacity: 0.55,
  pocColor: STYLE.poc,
  vahColor: STYLE.edge,
  valColor: STYLE.edge,
  fillValueArea: false,
  ibColor: STYLE.ib,
  singlePrintColor: STYLE.faint,
  nakedColor: STYLE.faint,
  sessionOpenColor: STYLE.ib,
  lastPriceColor: STYLE.poc,
  labelColor: STYLE.faint,
  showSessionLabel: false,
  showDayType: false,
  showOpenType: false,
  showNakedLevels: true,
  showInitialBalance: true,
  showSinglePrints: true,
} as const;

const VP_STYLE = {
  barColor: VP_COLORS.va,
  pocColor: VP_COLORS.poc,
  vahColor: VP_COLORS.edge,
  valColor: VP_COLORS.edge,
  highlightValueArea: true,
  valueAreaFillColor: VP_COLORS.va,
  valueAreaFillOpacity: 0.08,
  valueAreaOpacityDim: 0.35,
} as const;

const KEY = 'aem_profiles_v1';
const TICK = 0.05;
const RECOMPUTE_MS = 4000;

export interface ProfileState {
  tpo: boolean;
  vp: boolean;
}

function load(): ProfileState {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<ProfileState>;
    return { tpo: !!s.tpo, vp: !!s.vp };
  } catch {
    return { tpo: false, vp: false };
  }
}

/** Price rows: 5 points on NIFTY, 20 on BANKNIFTY. */
function rowPoints(symbol: string): number {
  return symbol.startsWith('BANKNIFTY') ? 20 : 5;
}

export interface Profiles {
  state(): ProfileState;
  /** Why a profile cannot be shown right now, or null. */
  unavailable(kind: keyof ProfileState): string | null;
  toggle(kind: keyof ProfileState): void;
  destroy(): void;
}

export function mountProfiles(widget: Widget): Profiles {
  const state = load();
  let tpo: MarketProfile | null = null;
  let vp: VolumeProfile | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastRun = 0;

  const intraday = (): boolean => parseInterval(widget.interval())?.kind === 'intraday';
  const hasVolume = (): boolean => findInstrument(widget.symbol())?.inst === 'FUTURES';

  const unavailable = (kind: keyof ProfileState): string | null => {
    if (!intraday()) return 'intraday intervals only';
    if (kind === 'vp' && !hasVolume()) return 'futures only (an index has no volume)';
    return null;
  };

  const clear = (): void => {
    if (tpo) widget.chart.removePrimitive(tpo);
    if (vp) widget.chart.removePrimitive(vp);
    tpo = null;
    vp = null;
  };

  const run = (): void => {
    timer = null;
    lastRun = Date.now();
    if (widget.isDestroyed) return;
    const bars = widget.series.getData() as readonly Bar[];
    const rows = rowPoints(widget.symbol());
    const wantTpo = state.tpo && !unavailable('tpo') && bars.length > 0;
    const wantVp = state.vp && !unavailable('vp') && bars.length > 0;

    if (wantTpo) {
      const result = computeMarketProfile(bars, {
        tickSize: TICK,
        rowTicks: Math.round(rows / TICK),
        session: 'day',
        blockMinutes: 30,
        valueAreaPercent: 0.7,
        initialBalancePeriods: 2,
        window: TRADING_HOURS.india!,
        timezone: 'Asia/Kolkata',
      });
      if (tpo) tpo.setData(result);
      else {
        tpo = new MarketProfile(result, TPO_STYLE);
        widget.chart.addPrimitive(tpo);
      }
    } else if (tpo) {
      widget.chart.removePrimitive(tpo);
      tpo = null;
    }

    if (wantVp) {
      const result = computeVolumeProfileSessions(bars, {
        tickSize: rows,
        session: 'day',
        valueAreaPercent: 0.7,
        timezone: 'Asia/Kolkata',
      });
      if (vp) vp.setData(result);
      else {
        vp = new VolumeProfile(result, VP_STYLE);
        widget.chart.addPrimitive(vp);
      }
    } else if (vp) {
      widget.chart.removePrimitive(vp);
      vp = null;
    }
  };

  const schedule = (now = false): void => {
    if (!state.tpo && !state.vp) {
      clear();
      return;
    }
    if (timer) clearTimeout(timer);
    const wait = now ? 0 : Math.max(0, RECOMPUTE_MS - (Date.now() - lastRun));
    timer = setTimeout(run, wait);
  };

  const offs = [
    widget.on('data', () => schedule()),
    widget.on('symbol', () => { clear(); schedule(true); }),
    widget.on('interval', () => { clear(); schedule(true); }),
  ];
  void widget.ready.then(() => schedule(true));

  return {
    state: () => ({ ...state }),
    unavailable,
    toggle(kind): void {
      state[kind] = !state[kind];
      localStorage.setItem(KEY, JSON.stringify(state));
      schedule(true);
    },
    destroy(): void {
      if (timer) clearTimeout(timer);
      for (const off of offs) off();
      clear();
    },
  };
}
