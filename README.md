# BTC Weekly SMA/RSI Report

Sends a weekly email with:
- BTC/USDT's latest **closed weekly candle** close price
- Whether that close is **above or below the 50-week SMA**
- **RSI(14)** on the weekly timeframe, flagged overbought (≥70) / oversold (≤30)
- The current **Crypto Fear & Greed Index**

Runs automatically every **Monday at 00:15 UTC** (shortly after the weekly
candle closes) via GitHub Actions — no server needed.

## One-time setup

1. **Create a new GitHub repo** and push these files to it (or upload them
   directly via the GitHub web UI).

2. **Add three repository secrets**
   (repo → Settings → Secrets and variables → Actions → New repository secret):

   | Secret name           | Value                                              |
   |------------------------|-----------------------------------------------------|
   | `EMAIL_FROM`            | The Gmail address to send from                     |
   | `EMAIL_APP_PASSWORD`    | A 16-character Gmail **App Password** (not your real password — generate one at myaccount.google.com/apppasswords, requires 2-Step Verification enabled) |
   | `EMAIL_TO`               | Comma-separated recipient list, e.g. `a@gmail.com,b@gmail.com` |

   ⚠️ If you already pasted an App Password somewhere insecure (like a chat),
   revoke it at myaccount.google.com/apppasswords and generate a fresh one to
   use here.

3. **Test it manually** before waiting for Monday: go to the repo's
   **Actions** tab → "BTC Weekly SMA/RSI Report" workflow → **Run workflow**.
   Check the run logs and your inbox.

That's it — it'll now run automatically every Monday.

## Local development (optional)

```bash
npm install
EMAIL_FROM="you@gmail.com" EMAIL_APP_PASSWORD="xxxxxxxxxxxxxxxx" EMAIL_TO="you@gmail.com" node index.js
```

## Customizing later

Everything lives in `index.js`:
- `SMA_PERIOD` / `RSI_PERIOD` constants to change the lookback windows
- RSI overbought/oversold thresholds (currently 70/30) in the `rsiStatus` logic
- Email formatting in the `lines` array inside `buildReport()`

Change the code, commit, push — no need to touch the workflow file unless
you want to change the schedule (the `cron` line).
