# Auction Edge Mobile: discovery (2026-11-24)

Status: discovery only. Nothing built, nothing changed on the server. Waiting for scope approval.

## 1. The brief does not match the stated goal

The brief describes a multi-user, bring-your-own-broker product. The owner's goal is a personal Android app fed by data we already collect. Most of the brief's hard constraints exist only to avoid redistributing market data to other users, and fall away for a single user reading their own server.

| Brief item | Personal-use verdict |
|---|---|
| Per-user broker adapters (Kite, Upstox, Fyers), contract test suite | Drop. The server already holds the candles and levels. |
| "No raw price storage on the server", schema-scan test | Drop. The server is the owner's own feed. |
| Encrypted per-user token store, re-login flows | Drop. One login to the existing Auction Edge account. |
| Per-user drawing/layout sync | Keep, small. `user_chart_templates` (migr 099) already exists. |
| iOS Safari testing, staging subdomain, NSE licence question | Drop. |
| Tape Said data | Missing from the brief entirely. Add. |
| Mobile UX phase (full-height chart, bottom sheet, label collisions, 44 px targets, TPO/VP) | Keep. This is the real work. |
| Alerts with push | Keep as a later phase. |

## 2. What exists

**Charting library.** openalgo-charts is pinned at 2.6.4 in the live Next app; the docs are at 2.7.5. Relevant for mobile:
- `createWidget` option `mobile: 'auto' | 'always' | 'never'`: compact layout at 640 px and below, touch header, bottom bar (Draw, Studies, Objects, More), property sheets.
- Touch: one-finger pan with kinetic scroll, pinch zoom, double-tap reset, tap and drag on price lines. Long-press crosshair is not documented and needs a device test.
- `DataFeed` interface: `getBars`, `getBarsPage` (cursor paging with `before`), `subscribeBars` for the live bar.
- TPO, Volume Profile and footprint ship in the open `openalgo-charts/profile` entry point.
- Drawings: headless `DrawingController` with `toJSON()` / `fromJSON()`.
- Right-axis labels: 2.7.5 docs describe a priority resolve that drops overlapping lower-priority labels. Our 2.6.4 notes say axis tags do not de-collide, so this needs checking at 2.7.5 before relying on it.
- Performance note from the README: frame p95 17 ms at 2,000 bars, 717 ms at 50,000 bars. Keep loaded history bounded on a phone.

**Auction Edge backend** (FastAPI, `/opt/tradingdashboard/backend`, default-deny auth).
- `GET /api/candles/{symbol}?tf=5m|1d&before&count`: pageable, compact arrays. 5m reads the ClickHouse stock table, 1d reads `daily_profile`.
- Level sources, each on its own route: `db/profile/{symbol}/{date}`, `levels/{symbol}/{date}`, `hiro/levels`, `balance/areas/{symbol}`, `series/levels/{symbol}`, weekly and monthly profile, `intraday/developing/{symbol}`, `dayplan`, `user-settings/levels`.
- A read-only `X-API-Key` service lane already serves the MotiveWave studies.
- Reusable frontend code in the Next app: `lib/openalgo/` (feed, history loader, resample, session bounds, templates, primitives).

**Tape Said** (`/opt/gmn`, DB `global_markets`, localhost only).
- Tables: bars at 1m/5m/30m/1h/4h/1d, `daily_profile`, `weekly_profile`, `tpo_periods`, `naked_pocs`, `balance_areas`, `gaps`, `market_structure_zones`, drift/vol/regime state, `scenario` with `frozen_levels`, posts and revisions.
- Collection is batch, twice a day (21:15Z and 00:15Z). There is no live lane.

## 3. Gaps to close on the server

1. **No pageable 1-minute NIFTY index or futures route.** `/api/candles` has no 1m timeframe. The older `analytics/candlestick` route returns Plotly figures and has the known missing `instrument_type` filter. Need a 1m lane on `/api/candles` reading `raw_candles_1min` through `mh.rth_sql`. Not verified: whether the 5m lane returns NIFTY index bars or stocks only.
2. **No push channel.** The API layer has no websocket or SSE. Existing pages poll at 15 to 60 s. The brief's one-second live candle needs either a new SSE relay off the collector or a direct Kite ticker connection from the phone.
3. **No single levels endpoint.** A phone should make one call, not nine. Need one aggregator route returning a flat list of `{id, kind, price, label, priority, as_of}`. Not verified: whether naked POCs and single prints are exposed by any current route.
4. **Tape Said has no JSON API.** The reader on port 3002 serves pages only, and bars and levels are not in the `pub` schema. Need read-only views plus two or three route handlers.

Every new Auction Edge route needs a policy entry and a feature group, or the route tests fail.

## 4. Proposed shape

- Standalone Vite + TypeScript app in `projects\auction-edge-mobile`, openalgo-charts 2.7.5, dark theme.
- Served as static files under `app.auctionedge.in` so it shares the existing login and `/api/proxy`.
- Installed on the phone as a PWA. Capacitor wrap only if alerts need native push.
- Data: Auction Edge for NIFTY (candles, levels, HIRO/GEX levels later), Tape Said for ES/NQ/GC/SI/CL/BTC (prior-session bars, levels, scenarios, the day's post).

Phases:
1. NIFTY chart on the phone: 1m candle route, levels aggregator, Auction preset overlays, polling live bar.
2. Mobile UX: bottom sheet, label priorities, TPO and Volume Profile for current and prior sessions, presets.
3. Tape Said tab: six instruments with levels, scenarios and the post text.
4. Live push (SSE) and alerts; APK wrap if needed.

## 5. Decisions needed

1. Confirm the personal-use scope in section 1 (no broker adapters, server feeds only).
2. Live updates in phase 1: polling every few seconds, or build the SSE relay first.
3. PWA under `app.auctionedge.in`, or a sideloaded APK from day one.
