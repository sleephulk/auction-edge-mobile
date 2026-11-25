#!/usr/bin/env python3
"""
live_quote_relay.py - latest NIFTY / BANKNIFTY index + front-month futures ticks
for the phone charting app (auction-edge-mobile, 2026-11-24).

One Kite ticker connection (the market-data app, broker='zerodha_data') in full
mode. The newest tick per instrument is kept in memory and written to
/dev/shm/ae_live_quotes.json a few times a second (write to a temp file, then
rename, so a reader never sees half a file). GET /api/mobile/quote reads it.

Nothing is written to the database and nothing else on the box reads the file.

    python scripts/live_quote_relay.py          # until 15:48 IST, then exit
    python scripts/live_quote_relay.py --once   # ~20 s smoke test

Cron (09:00 IST Mon-Fri):
    30 3 * * 1-5 /usr/bin/flock -n /tmp/live_quote_relay.lock -c 'cd /opt/tradingdashboard/backend && /opt/tradingdashboard/venv/bin/python scripts/live_quote_relay.py' >> /opt/tradingdashboard/logs/live_quote_relay.log 2>&1
"""
import json
import logging
import os
import signal
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

_HERE = Path(__file__).resolve()
for _cand in _HERE.parents:
    if (_cand / "app" / "core" / "secrets.py").exists():
        if str(_cand) not in sys.path:
            sys.path.insert(0, str(_cand))
        break
sys.path.insert(0, str(_HERE.parent))

import kite_feed as kf  # noqa: E402

IST = ZoneInfo("Asia/Kolkata")
OUT = "/dev/shm/ae_live_quotes.json"
TMP = OUT + ".tmp"
LOOP_END = (15, 48)
WRITE_EVERY_S = 0.25
ROOTS = ("NIFTY", "BANKNIFTY")
INDEX_NAMES = {"NIFTY": "NIFTY", "BANKNIFTY": "NIFTY BANK"}

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
log = logging.getLogger("live_quote_relay")

_lock = threading.Lock()
_quotes = {}
_dirty = False
_stop = False


def _sig(_signum, _frame):
    global _stop
    _stop = True


def past_loop_end() -> bool:
    now = datetime.now(IST)
    return (now.hour, now.minute) > LOOP_END


def resolve_tokens():
    """{instrument_token: key}. An instrument that cannot be resolved is skipped, not fatal."""
    out = {}
    for root in ROOTS:
        try:
            out[kf.index_token(INDEX_NAMES[root])] = root
        except Exception as e:  # noqa: BLE001
            log.error("index token for %s failed: %s", root, e)
        try:
            kf._fut_cache = None  # per-root cache in kite_feed holds one root only
            front = kf._live_futures(root)[0]
            out[front["instrument_token"]] = root + "-FUT"
            log.info("%s-FUT -> %s (%s)", root, front["tradingsymbol"], front["expiry"])
        except Exception as e:  # noqa: BLE001
            log.error("front future for %s failed: %s", root, e)
    return out


def _on_ticks_factory(keys):
    def on_ticks(_ws, ticks):
        global _dirty
        rx = time.time()
        with _lock:
            for t in ticks:
                key = keys.get(t.get("instrument_token"))
                ltp = t.get("last_price")
                if not key or ltp is None:
                    continue
                ohlc = t.get("ohlc") or {}
                ex = t.get("exchange_timestamp") or t.get("last_trade_time")
                # kiteconnect builds these with datetime.fromtimestamp (process-local
                # naive), so .timestamp() is the exact inverse whatever the OS zone is.
                ex_ts = ex.timestamp() if hasattr(ex, "timestamp") else None
                if not ex_ts or ex_ts <= 0:
                    ex_ts = None
                # Minute bar built from EVERY tick, so a client polling once a
                # second still gets the true high/low of the minute.
                ltp = float(ltp)
                minute = int(rx // 60) * 60
                prev = _quotes.get(key) or {}
                bar = prev.get("bar")
                prev_bar = prev.get("prev_bar")
                if not bar or bar["t"] != minute:
                    prev_bar = bar
                    bar = {"t": minute, "o": ltp, "h": ltp, "l": ltp, "c": ltp}
                else:
                    bar = {"t": minute, "o": bar["o"], "h": max(bar["h"], ltp),
                           "l": min(bar["l"], ltp), "c": ltp}
                _quotes[key] = {
                    "bar": bar,
                    "prev_bar": prev_bar,
                    "ltp": float(ltp),
                    "ts": round(rx, 3),
                    "exch_ts": ex_ts,
                    "open": ohlc.get("open"),
                    "high": ohlc.get("high"),
                    "low": ohlc.get("low"),
                    "prev_close": ohlc.get("close"),
                    "volume": t.get("volume_traded"),
                    "oi": t.get("oi"),
                    "source": "kite",
                }
            _dirty = True
    return on_ticks


def write_out():
    global _dirty
    with _lock:
        payload = {"updated": round(time.time(), 3), "quotes": dict(_quotes)}
        _dirty = False
    with open(TMP, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, separators=(",", ":"))
    os.replace(TMP, OUT)


def main():
    once = "--once" in sys.argv
    signal.signal(signal.SIGTERM, _sig)
    signal.signal(signal.SIGINT, _sig)
    if not once and past_loop_end():
        log.info("past %02d:%02d IST, nothing to do", *LOOP_END)
        return 0

    from kiteconnect import KiteTicker
    kite = kf.kite()
    keys = resolve_tokens()
    if not keys:
        log.error("no instruments resolved")
        return 2
    tokens = list(keys)

    kt = KiteTicker(kite.api_key, kite.access_token, reconnect=True,
                    reconnect_max_tries=300, reconnect_max_delay=30)

    def on_connect(ws, _resp):
        ws.subscribe(tokens)
        ws.set_mode(ws.MODE_FULL, tokens)
        log.info("connected, subscribed %d instruments: %s", len(tokens), sorted(keys.values()))

    kt.on_connect = on_connect
    kt.on_ticks = _on_ticks_factory(keys)
    kt.on_close = lambda _ws, code, reason: log.warning("closed %s %s", code, reason)
    kt.on_error = lambda _ws, code, reason: log.warning("error %s %s", code, reason)
    kt.on_reconnect = lambda _ws, n: log.warning("reconnect attempt %s", n)
    kt.connect(threaded=True)

    started = time.time()
    last_write = 0.0
    last_beat = 0.0
    try:
        while not _stop:
            now = time.time()
            # Heartbeat write every 5 s even without ticks, so the route can tell
            # "relay up, market quiet" from "relay gone".
            if (_dirty and now - last_write >= WRITE_EVERY_S) or now - last_beat >= 5:
                write_out()
                last_write = now
                last_beat = now
            if once and now - started > 20:
                break
            if not once and past_loop_end():
                break
            time.sleep(0.05)
    finally:
        try:
            kt.close()
        except Exception:  # noqa: BLE001
            pass
        with _lock:
            n = len(_quotes)
        log.info("exit; %d instruments had ticks: %s", n, json.dumps(_quotes)[:600])
        if not once:
            try:
                os.remove(OUT)
            except OSError:
                pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
