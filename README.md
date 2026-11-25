# AE Pocket (auction-edge-mobile)

Personal phone charting app on openalgo-charts 2.7.5, fed by the Auction Edge server.
Live at https://app.auctionedge.in/pocket/ (sign in with the Auction Edge account, then "Add to Home screen" in Chrome).

## What it does (phase 1, 2026-11-24)

- NIFTY and BANKNIFTY, index and front-month future. 1-minute candles from the server; 3m to 1h folded on the phone, anchored at 09:15; 1d and 1w from daily bars.
- Older history pages in on scroll-left.
- Live candle and ticker strip from a once-a-second quote poll while the relay runs (09:00 to 15:48 IST).
- The full openalgo widget: drawings, 113 indicators, chart types (Heikin Ashi, Renko, P&F, Kagi...), alerts, watchlist, saved layouts, drawing templates, fullscreen. Layout and drawings persist on the device (IndexedDB).
- Market Profile (TPO) and Volume Profile toggles in the app menu (the "..." button). Volume Profile is futures only.

## Layout

- `src/feed.ts` - DataFeed + QuoteFeed over `/api/mobile/*`. `src/live.ts` - the quote poller. `src/timeframes.ts` - session-anchored folding.
- `src/chart.ts` - widget, ticker strip, app menu. `src/profiles.ts` - TPO / VP. `src/auth.ts` - Supabase login over REST.
- `server/mobile_routes.py` -> `/opt/tradingdashboard/backend/app/api/mobile_routes.py`
- `server/live_quote_relay.py` -> `/opt/tradingdashboard/backend/scripts/live_quote_relay.py`

## Server pieces

| Piece | Where | Rollback |
|---|---|---|
| `GET /api/mobile/candles/{symbol}`, `GET /api/mobile/quote` | `app/api/mobile_routes.py`, mounted in `main.py`, group CORE in `feature_groups.py` | restore `main.py.bak-mobile-20261124` and `feature_groups.py.bak-mobile-20261124`, restart `prediction-engine` |
| Live relay (Kite ticker, data app) writing `/dev/shm/ae_live_quotes.json` | cron `30 3 * * 1-5`, log `/opt/tradingdashboard/logs/live_quote_relay.log` | remove the cron line (backup `/home/ubuntu/crontab-backups/crontab.bak-pocket-20261124`) |
| nginx `/pocket/` (static, `/var/www/ae-pocket`) and `/api/mobile/` (direct to FastAPI) | `/etc/nginx/sites-enabled/auctionedge.conf` | restore `/root/nginx-backups/auctionedge.conf.bak-pocket-20261124`, `nginx -t`, reload |

The relay writes nothing to the database. FUTURES history is served from 2026-02-09 only (older rows are the time-shifted era).

## Develop and deploy

```
npm run dev        # http://127.0.0.1:5183/pocket/ , /api proxied to the live server
npm run build
tar -C dist -czf /tmp/ae-pocket-dist.tgz .
scp /tmp/ae-pocket-dist.tgz <server>:/tmp/
ssh <server> 'rm -rf /var/www/ae-pocket/* && tar -C /var/www/ae-pocket -xzf /tmp/ae-pocket-dist.tgz'
```

`window.__aep` is the widget in dev builds, for probing from the console.

## Not done yet

- Live path has only been tested with simulated ticks (built on a market holiday). First real session: check the relay log and the live dot.
- Auction Edge levels, daily/weekly plans and reports, Tape Said instruments, stocks, push alerts.
- No service worker, so no offline shell.
