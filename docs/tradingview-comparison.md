# TradingView mobile vs AE Pocket (2026-11-25)

This compares what the TradingView mobile app does with what AE Pocket does today and what openalgo-charts 2.7.5 could do with more work. The TradingView side comes from public pages only: pricing, data coverage, the broker list, blog posts, the App Store listing and its release notes (iOS 2.144.1, 17 Nov 2026), plus two third-party guides. Google Play would not load. Rows marked "unconfirmed" would need someone to check the live app.

The **Pocket** column uses these labels:
- **Yes**: works in the app today.
- **Lib**: openalgo has it, but it isn't wired into the app yet.
- **Build**: we would have to write it.
- **No**: we aren't planning it.

## TradingView plan limits that matter for the comparison

| | Free | Essential | Plus | Premium |
|---|---|---|---|---|
| Price (India, per month, billed yearly) | 0 | ₹995 | ₹2,095 | ₹4,195 |
| Indicators per chart | 2 | 5 | 10 | 25 |
| Charts per tab | 1 | 2 | 4 | 8 |
| Historical bars | 5K | 10K | 10K | 20K |
| Price alerts | 3 | 20 | 100 | 400 |
| NSE data | 15 min delayed | real-time | real-time | real-time |
| Volume profile | no | yes | yes | yes |
| TPO | no | no | no | yes |

AE Pocket has no limits of this kind. TPO and Volume Profile, which need TradingView Premium, are already in phase 1.

## 1. Chart core

| Feature | TradingView mobile | Pocket |
|---|---|---|
| Candles, bars, line, area, baseline, Heikin Ashi, Renko, P&F, Kagi, Line Break, Range | standard types (no full mobile list published) | **Yes**: 13 base types plus the transforms |
| Intervals 1m to 1W | yes | **Yes**: 1m, 3m, 5m, 15m, 30m, 1h, 1d, 1w |
| Custom intervals | Essential and up | **Lib**: the widget has "Add custom interval", but any new code must also be folded in `timeframes.ts` |
| Seconds and tick intervals | Essential and up; on mobile unconfirmed | **Build**: needs tick data from the server; we only store 1m |
| Bar replay | yes, with speed control | **Lib**: `ReplayController` has no built-in UI, so we'd draw a play/step/speed bar |
| Extended hours | yes | **No**: the NSE regular session only |
| Several charts on one screen | one at a time on a phone; switch between them | **Lib**: `createChartGrid` (1 to 16 charts, linked crosshair and time) |
| Compare / overlay a symbol | unconfirmed on mobile | **Lib**: the widget's "Compare with" exists but is untested with our feed; only 4 symbols |
| Log, percent, indexed-to-100 scales | unconfirmed on mobile | **Yes**: via the price-axis menu and settings |
| Go to date | yes | **Lib**: `widget.goTo` loads older history first; not tested |
| Prev close, session high/low lines, bar countdown, clock | yes | **Lib**: `PriceLevels`, `axisChrome` |
| Export PNG, SVG or CSV | snapshot | **Yes**: in the widget's capture menu |

## 2. Drawing

| Feature | TradingView mobile | Pocket |
|---|---|---|
| Tool families (lines, Fibonacci, Gann, Elliott, patterns, pitchforks) | yes | **Yes**: 90 tools |
| Magnet | toggle (third-party source only) | **Yes**: weak and strong |
| 45-degree snap | angle button, 15 tools | **Yes**: Shift on desktop; a touch equivalent is unconfirmed |
| Drawing templates | unconfirmed on mobile | **Yes**: saved in IndexedDB |
| Object tree | unconfirmed on mobile | **Yes**: the Objects panel |
| Drawings sync across devices | yes (they live in the cloud) | **Build**: drawings stay on the phone (IndexedDB) |

## 3. Indicators

| Feature | TradingView mobile | Pocket |
|---|---|---|
| Built-in library | hundreds | **Yes**: 113, each checked bar by bar against its standard definition |
| Per-chart limit | 2 / 5 / 10 / 25 by plan | **Yes**: no limit |
| Scripting | Pine is apply-only on mobile; editor and Strategy Tester are desktop only | **Build**: `registerIndicator` in TypeScript at build time; no scripting in the app |
| Community scripts | thousands | **No** |
| Indicator templates | yes | **Lib**: the workspace tier has indicator templates |
| Volume Profile (visible and fixed range) | Essential and up | **Yes**: daily-session VP on futures; fixed-range VP is a drawing tool |
| TPO | Premium and up; on mobile unconfirmed | **Yes**: 30-minute periods, IB, value area |
| Footprint / order flow | Premium, desktop; iOS requests "noted" | **Lib**: needs classified tick data we don't record |

## 4. Data

| Feature | TradingView mobile | Pocket |
|---|---|---|
| Symbol universe | 100+ exchanges | **Build**: 4 instruments (NIFTY and BANKNIFTY, index and future) |
| NSE real-time | paid plans | **Yes**: from our own Kite relay, polled about once a second (not true ticks) |
| History depth | 5K to 20K bars | **Yes**: all of `raw_candles_1min`, paged on scroll-left (futures from 2026-02-09) |
| Open interest per bar | yes | **Lib**: the bar contract has `oi`; the relay already reads OI |
| Fundamentals, financials | yes | **Build**: we have Trendlyne data on the server |
| Options chain | web; mobile unconfirmed | **Build**: the server has the daily F&O chain and greeks |
| Screener | basic on mobile | **Build**: the Auction Edge screener exists on the server |
| Economic, earnings and dividend calendars | yes | **Lib**: the library can show event markers; we have no calendar feed |
| News | yes | **Lib**: news panel in the dock, if we supply a news feed |

## 5. Watchlists, alerts, social

| Feature | TradingView mobile | Pocket |
|---|---|---|
| Watchlists with live quotes | yes, flags, logos | **Yes**: named lists, live rows (4 symbols) |
| Price, indicator, drawing alerts | yes; 3 to 400 by plan | **Yes**: work out the conditions only while the app is open |
| Alerts that fire with the app closed + push | yes (server side, push, email, webhook) | **Build**: the biggest functional gap; needs a server alert engine plus push (a web push service worker, or FCM in an APK) |
| Home-screen widget | iOS, one watchlist | **Build**: APK only |
| Ideas, Minds, publishing, follows | yes | **No** |

## 6. Trading

| Feature | TradingView mobile | Pocket |
|---|---|---|
| Broker trading from the chart | Dhan, Fyers confirmed on mobile; Upstox, Angel One and others listed | **Lib**: trade tier (order, position and bracket lines, DOM ladder); needs a broker adapter |
| Zerodha | **not a TradingView broker**; Zerodha embeds TradingView inside Kite instead | **Build**: the BYO-Zerodha idea |
| Paper trading | yes | **Lib**: the trade tier has a sandbox ("analyzer") mode |

## 7. Mobile UX

| Feature | TradingView mobile | Pocket |
|---|---|---|
| Bottom toolbar (+, interval, Draw, type, settings) | yes | **Yes**: the openalgo mobile chrome (Draw, Indicators, Objects, Data, More) |
| Long-press crosshair that tracks OHLC and values | yes | **Yes**: the widget's touch crosshair; not tested on a real phone |
| Landscape / full screen | yes | **Yes**: `fullscreen` and the mobile chrome when the phone is on its side |
| Layouts sync between desktop and phone | yes | **Build**: layouts are per device |
| Offline | none found | **Build**: no service worker yet |

## What Auction Edge has that TradingView can't

The reason to build this at all is the data TradingView doesn't have: Auction Edge levels, daily and weekly plans, CAS, IB and day-type context, HIRO and GEX, Tape Said instruments. These are the planned next phases and have no TradingView equivalent.

## Gaps that matter most for the "TradingView replacement" goal

1. **Alerts that fire with the app closed.** On TradingView, alerts run on the server and arrive as push notifications. Ours run only while the screen is on, so they are the largest real gap. This is a server alert engine plus push. Web push works on Android Chrome for an installed PWA, so it doesn't require the APK.
2. **Layouts and drawings saved to the server.** They are on the phone only today, so losing the phone or switching devices loses them. The workspace tier already has revision-checked documents and swappable storage, so this is a server table plus an adapter.
3. **Bar replay.** Cheap: the controller exists and only needs a transport bar.
4. **More symbols.** Every other comparison row grows with this: stocks from `eq_bars_5min`, then the Tape Said instruments.
5. **Multi-chart grid.** `createChartGrid` exists; it is mainly useful on a tablet or a phone on its side.

Pine-style scripting, community scripts and social features are where TradingView is hardest to match. For personal use they are also the least needed.
