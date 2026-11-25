import type { Inst } from './api';

export interface InstrumentDef {
  /** What the chart shows and the feed is asked for. */
  symbol: string;
  exchange: string;
  name: string;
  /** Server candle parameters. */
  root: string;
  inst: Inst;
  /** Key in the live quote payload. */
  quoteKey: string;
  /** Last minute of the session, IST minutes from midnight (exclusive end of the last 1m bar). */
  closeMin: number;
}

const OPEN_MIN = 9 * 60 + 15;

export const SESSION_OPEN_MIN = OPEN_MIN;

// NIFTY 1-minute is the template; BANKNIFTY rides on the same server tables.
export const INSTRUMENTS: readonly InstrumentDef[] = [
  { symbol: 'NIFTY', exchange: 'NSE', name: 'NIFTY 50 index', root: 'NIFTY', inst: 'INDEX', quoteKey: 'NIFTY', closeMin: 15 * 60 + 30 },
  { symbol: 'NIFTY-FUT', exchange: 'NFO', name: 'NIFTY front-month future', root: 'NIFTY', inst: 'FUTURES', quoteKey: 'NIFTY-FUT', closeMin: 15 * 60 + 40 },
  { symbol: 'BANKNIFTY', exchange: 'NSE', name: 'NIFTY BANK index', root: 'BANKNIFTY', inst: 'INDEX', quoteKey: 'BANKNIFTY', closeMin: 15 * 60 + 30 },
  { symbol: 'BANKNIFTY-FUT', exchange: 'NFO', name: 'BANKNIFTY front-month future', root: 'BANKNIFTY', inst: 'FUTURES', quoteKey: 'BANKNIFTY-FUT', closeMin: 15 * 60 + 40 },
];

export function findInstrument(symbol: string): InstrumentDef | undefined {
  const s = symbol.trim().toUpperCase();
  return INSTRUMENTS.find((i) => i.symbol === s);
}
