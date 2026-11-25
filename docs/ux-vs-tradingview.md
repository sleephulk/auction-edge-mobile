# UX: AE Pocket vs TradingView mobile (2026-11-25)

**Sources:**
- TradingView's six iPhone App Store screenshots (iOS 2.144.1).
- TradingView's own phone-web chart (in.tradingview.com/chart), opened in a 412×892 Android-sized browser.
- AE Pocket screenshots from 2026-11-24 (`shots/`, not committed).

I have not used the native TradingView app hands-on; the screenshots show its layout, not how it feels to use. TradingView's screenshots are kept out of this repo.

## How TradingView lays out a phone screen

1. **Two levels: a symbol page, then the chart.** Tapping a symbol in the watchlist opens an overview first:
   - the name plus exchange and session icons
   - a large price, with the day's change underneath and a separate pre/post-market chip
   - a simple area chart with range tabs (1D 5D 1M 3M YTD 1Y 5Y All)
   - one Trade button, and tabs for Overview / News / Minds / Ideas

   A full-screen icon opens the full technical chart. Most visits (checking a price) never reach the full chart.
2. **The app has a bottom tab bar** (Watchlist, Chart, Explore, Ideas, Menu). The chart is one tab, not the whole app.
3. **The full chart is nearly edge to edge.** No separate header bar. The symbol name and day change sit over the top-left of the chart as a legend. The only bars are the bottom toolbar and the price axis.
4. **The bottom toolbar is icons, with symbol and interval at the far left** ("NVDA | 1H", pencil, indicators, undo, full screen). The two things you change most are under your thumb.
5. **The drawing toolbar floats next to the drawing** (a small horizontal strip of tools) rather than taking a full rail or sheet.
6. **Price-axis tags for everything:**
   - every indicator's current value gets its own coloured tag on its pane's axis
   - the last price, a "Pre" price and the order buttons get tags too
   - so you read values from the axis, not from a legend
7. **Watchlist rows have two lines** (ticker over full name; price over change in colour), with section headers (Indices / Stocks / Futures), logos, and a small extra line for pre-market.
8. **Range presets on the phone web chart** (1D 5D 1M 3M 6M YTD 1Y 5Y All). Each preset picks a sensible interval for you ("1M" = 30-minute bars), plus Go to date, the clock with timezone, and RTH/ETH.

## Where AE Pocket stands

From the 2026-11-24 screenshots:
- **Top chrome is about 95 px over three rows:** the ticker strip (about 45 px), then a symbol search field with a tiny "1m" interval at the far right (about 50 px). The price and change only appear in the ticker strip, not on the chart.
- **The bottom bar is text-only** (Draw / Indicators / Objects / Data / More). Interval is not in it.
- **There are two menus:** our "⋯" app sheet and the widget's own "More". Several items appear in both (Indicators, Objects, Settings).
- **The app opens straight into the full chart.** There's no home screen, so the levels / plans / reports phases have nowhere to live.
- **The TPO colours are a rainbow** with a repeated "India" label. It's hard to read on a small screen compared with TradingView's quieter style.
- **The sign-out row shows the account email in full.**

## Recommended changes, in order

| # | Change | Why | How (openalgo) | Size |
|---|---|---|---|---|
| 1 | **One header row:** symbol (tap → instrument sheet), big LTP, change in points and %, live dot, interval chip. The ticker strip moves into the watchlist. | Gets back about 50 px of chart; price lives where you look | `topbar: false`, our own header fed by `quoteHub` | S |
| 2 | **Bottom tab bar for the app:** Watchlist · Chart · Levels · Alerts · More | Gives levels, plans and reports a home, the way TradingView separates chart from app | Our shell around the widget | M |
| 3 | **Watchlist home screen:** sectioned (Indices / Futures / later Stocks), two-line rows, sparkline, tap → chart | The first screen answers "where is NIFTY?" without loading a chart | Our list on `quoteHub` + daily bars | M |
| 4 | **Interval and range at thumb height:** an interval chip in the bottom bar, plus range presets (1D 5D 1M 3M 1Y) | The most-changed control is currently a 20 px label at top right | `widget.setRange`, `ranges` option; interval menu | S |
| 5 | **Icons in the bottom toolbar** with small labels, and **one menu**: drop duplicates from our "⋯" sheet, keep TPO/VP and the account items | Less to read, one place to look | CSS over the mobile chrome; trim `chart.ts` sheet | S |
| 6 | **Axis tags** for prev close, day high/low and indicator values; bar countdown | Read numbers off the axis like on TradingView | `PriceLevels`, `axisChrome` | S |
| 7 | **TPO/VP style:** calm two-tone palette, no "India" label, value area shaded, POC as the only strong line | Readable at phone size | `MarketProfile` / `VolumeProfile` options | S |
| 8 | **Full-screen landscape chart:** turn sideways → chrome hides, swipe down or tap → it comes back | The chart gets the whole screen when you study it | `fullscreen`, orientation listener | S |
| 9 | **Floating drawing toolbar** next to the selected drawing instead of a full sheet | Keeps the chart visible while drawing | Check `mountDrawingToolbar` with the mobile chrome | M |
| 10 | **Polish:** tabular numbers, a single accent colour, mask the email in the menu, haptic tick on long-press crosshair (APK only) | Feels finished | CSS, `applyTokens` | S |

Items 1, 4, 5, 6 and 7 are a day's work together and change the feel most. Items 2 and 3 are the frame the next phases (levels, plans, reports) need anyway, so they're worth doing before those phases start.

## Notes from a hands-on look at a real TradingView layout

Kept in a local, untracked file. The takeaways that matter for the app:
- Ship the trader's usual indicator set as a template.
- Draw IB range extensions and straddle/premium-decay charts from our own data.
- Offer plain-language alerts.
- Put the axis "+" on a tap.
- Add a replay transport bar.
- Default the indicator legend to collapsed.
- Add a floating favourite-tools bar.
- Make named layouts one tap away.
- Allow two charts in landscape.
- Show event markers.

## Not worth copying

- the social and ideas feeds
- the full-screen ad/promo pop-ups (the web chart opened with a Black Friday takeover)
- order buttons on the chart before a broker exists
