"""
mobile_routes.py - feeds for the phone charting app (auction-edge-mobile, 2026-11-24).

    GET /api/mobile/candles/{symbol}?tf=1m|1d&inst=INDEX|FUTURES&before=<utc s, exclusive>&count=<1..5000>
        -> {symbol, inst, tf, bars: [[t, o, h, l, c, v], ...] ascending,
            has_more, next_before, count, source}

    GET /api/mobile/quote?symbols=NIFTY,NIFTY-FUT
        -> {quotes: {SYM: {ltp, ts, open, high, low, prev_close, volume, source}},
            relay_ts, age_s, live}

Why a new file rather than a 1m lane on /api/candles: that route's 5m lane is
the ClickHouse stock table and its contract is used by the desktop pages. This
one is index/futures 1-minute from PG raw_candles_1min, for a different client,
and stays additive.

SOURCES
  1m  PG raw_candles_1min ("timestamp" timestamptz). Session filter is the
      shared market_hours.rth_sql predicate, which also drops the UTC-labelled
      duplicate rows (03:45-09:14 IST) and the GIFT pre-market bars. `t` is the
      bar-open instant in UTC seconds.
      FUTURES has a floor of 2026-02-09: older rows are the +5:30-shifted era
      (labels 14:45-20:59) that consumers must compensate per day; this route
      does not, so it does not serve them.
  1d  INDEX: PG daily_profile, same numbers as /api/candles?tf=1d.
      FUTURES: folded from the 1m rows above, per IST date.
  quote  /dev/shm/ae_live_quotes.json, written by scripts/live_quote_relay.py
      (Kite ticker, market hours). When the file is missing or older than
      STALE_S the last stored 1-minute close is returned with live=false.

Read-only. Core feature group. USER policy (JWT).
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, HTTPException, Query

from app import market_hours as mh
from app.api.candles_routes import _num, _page_1d, get_pg_conn, ist_midnight_epoch

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/mobile", tags=["mobile"])

MAX_COUNT = 5000
QUOTE_FILE = "/dev/shm/ae_live_quotes.json"
STALE_S = 20.0
_SYMBOL_RE = re.compile(r"^[A-Z0-9&_.\-]{1,32}$")
_SYMBOLS = ("NIFTY", "BANKNIFTY")
_FUT_FLOOR = datetime(2026, 2, 8, 18, 30, tzinfo=timezone.utc)  # 2026-02-09 00:00 IST
_TS_IST = "(\"timestamp\" AT TIME ZONE 'Asia/Kolkata')"


def _norm_symbol(symbol: str) -> str:
    s = (symbol or "").strip().upper()
    if not _SYMBOL_RE.match(s) or s not in _SYMBOLS:
        raise HTTPException(status_code=422, detail="unknown symbol")
    return s


def _rth(inst: str) -> str:
    return mh.rth_sql(_TS_IST, instrument=mh.INDEX if inst == "INDEX" else mh.DERIV)


def _page_1m(sym: str, inst: str, before: Optional[int], count: int):
    where = ["symbol = %s", "instrument_type = %s", _rth(inst)]
    params: List[Any] = [sym, inst]
    if inst == "FUTURES":
        where.append("\"timestamp\" >= %s")
        params.append(_FUT_FLOOR)
    if before is not None:
        where.append("\"timestamp\" < to_timestamp(%s)")
        params.append(before)
    params.append(count + 1)
    conn = get_pg_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT extract(epoch FROM \"timestamp\")::bigint, open, high, low, close, volume "
            "FROM raw_candles_1min WHERE " + " AND ".join(where) +
            " ORDER BY \"timestamp\" DESC LIMIT %s",
            params,
        )
        rows = cur.fetchall()
    finally:
        conn.close()
    has_more = len(rows) > count
    rows = rows[:count]
    bars: List[list] = []
    for t, o, h, l, c, v in reversed(rows):
        o, h, l, c = _num(o), _num(h), _num(l), _num(c)
        if o is None or h is None or l is None or c is None:
            continue
        bars.append([int(t), o, h, l, c, int(v) if v is not None else 0])
    earliest = int(rows[-1][0]) if rows else None
    return bars, has_more, earliest


def _page_1d_futures(sym: str, before: Optional[int], count: int):
    where = ["symbol = %s", "instrument_type = 'FUTURES'", _rth("FUTURES"), "\"timestamp\" >= %s"]
    params: List[Any] = [sym, _FUT_FLOOR]
    if before is not None:
        # `before` is IST midnight of a trade date: everything strictly earlier.
        where.append("\"timestamp\" < to_timestamp(%s)")
        params.append(before)
    params.append(count + 1)
    conn = get_pg_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT " + _TS_IST + "::date AS d, "
            "(array_agg(open ORDER BY \"timestamp\"))[1], max(high), min(low), "
            "(array_agg(close ORDER BY \"timestamp\" DESC))[1], sum(volume) "
            "FROM raw_candles_1min WHERE " + " AND ".join(where) +
            " GROUP BY 1 ORDER BY 1 DESC LIMIT %s",
            params,
        )
        rows = cur.fetchall()
    finally:
        conn.close()
    has_more = len(rows) > count
    rows = rows[:count]
    bars = [[ist_midnight_epoch(d), _num(o), _num(h), _num(l), _num(c), int(v or 0)]
            for d, o, h, l, c, v in reversed(rows)]
    earliest = ist_midnight_epoch(rows[-1][0]) if rows else None
    return bars, has_more, earliest


@router.get("/candles/{symbol}")
def get_mobile_candles(
    symbol: str,
    tf: Literal["1m", "1d"] = "1m",
    inst: Literal["INDEX", "FUTURES"] = "INDEX",
    before: Optional[int] = Query(default=None, ge=0, description="exclusive UTC-second anchor; absent = latest"),
    count: int = Query(default=1500, ge=1, le=MAX_COUNT),
):
    sym = _norm_symbol(symbol)
    try:
        if tf == "1m":
            bars, has_more, earliest = _page_1m(sym, inst, before, count)
            source = "pg:raw_candles_1min"
        elif inst == "INDEX":
            bars, has_more, _exists, earliest = _page_1d(sym, before, count)
            source = "pg:daily_profile"
        else:
            bars, has_more, earliest = _page_1d_futures(sym, before, count)
            source = "pg:raw_candles_1min(1d fold)"
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        logger.exception("mobile candles %s %s %s failed", sym, inst, tf)
        raise HTTPException(status_code=500, detail=f"candles query failed: {e.__class__.__name__}")
    return {
        "symbol": sym,
        "inst": inst,
        "tf": tf,
        "bars": bars,
        "count": len(bars),
        "has_more": bool(has_more),
        "next_before": earliest,
        "source": source,
    }


# ---------------------------------------------------------------------------
# quote
# ---------------------------------------------------------------------------
_fallback_cache: Dict[str, Any] = {"at": 0.0, "quotes": {}}


def _read_relay() -> Optional[dict]:
    try:
        with open(QUOTE_FILE, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def _last_bar_quotes() -> Dict[str, dict]:
    """Last stored 1-minute close per instrument; refreshed at most every 30 s."""
    now = time.time()
    if now - _fallback_cache["at"] < 30 and _fallback_cache["quotes"]:
        return _fallback_cache["quotes"]
    out: Dict[str, dict] = {}
    conn = get_pg_conn()
    try:
        cur = conn.cursor()
        for sym in _SYMBOLS:
            for inst, key in (("INDEX", sym), ("FUTURES", sym + "-FUT")):
                cur.execute(
                    "SELECT extract(epoch FROM \"timestamp\")::bigint, close FROM raw_candles_1min "
                    "WHERE symbol = %s AND instrument_type = %s AND " + _rth(inst) +
                    " ORDER BY \"timestamp\" DESC LIMIT 1",
                    (sym, inst),
                )
                row = cur.fetchone()
                if row:
                    out[key] = {"ltp": _num(row[1]), "ts": int(row[0]) + 60, "source": "last_bar"}
    finally:
        conn.close()
    _fallback_cache["at"] = now
    _fallback_cache["quotes"] = out
    return out


@router.get("/quote")
def get_mobile_quote(symbols: str = Query(default="NIFTY", max_length=200)):
    want = [s.strip().upper() for s in symbols.split(",") if s.strip()][:16]
    now = time.time()
    relay = _read_relay()
    relay_ts = float(relay.get("updated", 0)) if relay else 0.0
    live = bool(relay) and (now - relay_ts) <= STALE_S
    src = (relay or {}).get("quotes", {}) if live else {}
    quotes: Dict[str, dict] = {}
    missing = [s for s in want if s not in src]
    fallback = _last_bar_quotes() if missing else {}
    for s in want:
        q = src.get(s) or fallback.get(s)
        if q:
            quotes[s] = q
    return {
        "quotes": quotes,
        "relay_ts": relay_ts or None,
        "age_s": round(now - relay_ts, 2) if relay_ts else None,
        "live": live,
        "server_ts": round(now, 3),
    }
