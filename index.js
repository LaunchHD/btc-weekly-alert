const axios = require("axios");
const nodemailer = require("nodemailer");

const SMA_PERIOD = 50;
const RSI_PERIOD = 14;

// --- Fetch daily BTC/USD prices from CoinGecko (no auth, no geo-block) and
// resample into weekly candles (Monday–Sunday, UTC), matching the Binance
// weekly-candle convention. Binance's own API 451-blocks GitHub Actions'
// datacenter IPs, so we build the weekly close ourselves from daily data. ---
function mondayOfWeekUTC(date) {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

async function fetchWeeklyCandles(weeksNeeded) {
  // CoinGecko's free/no-key tier caps historical range at 365 days — stay under that.
  const daysNeeded = Math.min(weeksNeeded * 7 + 14, 364);
  const url = `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=${daysNeeded}&interval=daily`;
  const res = await axios.get(url);
  const dailyPrices = res.data.prices; // [[timestampMs, price], ...] ascending

  // Bucket daily prices into weeks; each week's close = latest price seen in that week
  const weekMap = new Map(); // key: monday ISO date -> { closeTime, close, lastTs }
  for (const [ts, price] of dailyPrices) {
    const monday = mondayOfWeekUTC(ts);
    const key = monday.toISOString();
    const closeTime = monday.getTime() + 7 * 24 * 60 * 60 * 1000; // next Monday 00:00 UTC
    const existing = weekMap.get(key);
    if (!existing || ts > existing.lastTs) {
      weekMap.set(key, { closeTime, close: price, lastTs: ts });
    }
  }

  const now = Date.now();
  const weeks = [...weekMap.values()]
    .filter((w) => w.closeTime <= now) // only fully-closed weeks
    .sort((a, b) => a.closeTime - b.closeTime);

  return weeks.map((w) => ({ close: w.close, closeTime: w.closeTime }));
}

// --- Simple Moving Average over the last N closes ---
function sma(closes, period) {
  const slice = closes.slice(-period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}

// --- Wilder's RSI over the given closes (needs period+1 closes minimum) ---
function rsi(closes, period) {
  let gains = 0;
  let losses = 0;

  // Initial average gain/loss over the first `period` changes
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  // Wilder smoothing for the rest of the series
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change >= 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// --- Crypto Fear & Greed Index (alternative.me, no auth needed) ---
async function fetchFearGreed() {
  try {
    const res = await axios.get("https://api.alternative.me/fng/?limit=1");
    const entry = res.data.data[0];
    return { value: parseInt(entry.value, 10), classification: entry.value_classification };
  } catch (err) {
    console.error("Fear & Greed fetch failed:", err.message);
    return null;
  }
}

function fmtUsd(n) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

async function buildReport() {
  // Fetch enough weekly candles for SMA(50) + RSI(14) with headroom.
  // fetchWeeklyCandles already only returns fully-closed weeks.
  const closedCandles = await fetchWeeklyCandles(SMA_PERIOD + RSI_PERIOD + 5);

  const closes = closedCandles.map((c) => c.close);
  const latest = closedCandles[closedCandles.length - 1];

  const smaValue = sma(closes, SMA_PERIOD);
  const rsiValue = rsi(closes, RSI_PERIOD);
  const fearGreed = await fetchFearGreed();

  const aboveSma = latest.close > smaValue;
  const pctFromSma = ((latest.close - smaValue) / smaValue) * 100;

  let rsiStatus = "Neutral";
  if (rsiValue >= 70) rsiStatus = "⚠️ Overbought";
  else if (rsiValue <= 30) rsiStatus = "⚠️ Oversold";

  const weekLabel = new Date(latest.closeTime).toISOString().slice(0, 10);

  const subject = `BTC/USDT Weekly: ${aboveSma ? "Above" : "Below"} 50W SMA (${weekLabel})`;

  const lines = [
    `📊 BTC/USDT Weekly Update — week ending ${weekLabel}`,
    ``,
    `Close: ${fmtUsd(latest.close)}`,
    `50-week SMA: ${fmtUsd(smaValue)}`,
    `Price is ${aboveSma ? "ABOVE" : "BELOW"} the 50W SMA (${pctFromSma >= 0 ? "+" : ""}${pctFromSma.toFixed(2)}%)`,
    ``,
    `RSI(14, weekly): ${rsiValue.toFixed(1)} — ${rsiStatus}`,
  ];

  if (fearGreed) {
    lines.push(``, `Crypto Fear & Greed Index: ${fearGreed.value} — ${fearGreed.classification}`);
  } else {
    lines.push(``, `Crypto Fear & Greed Index: unavailable this week`);
  }

  return { subject, text: lines.join("\n") };
}

async function sendEmail(subject, text) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_FROM,
      pass: process.env.EMAIL_APP_PASSWORD,
    },
  });

  const to = process.env.EMAIL_TO; // comma-separated list

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    text,
  });

  console.log("Email sent to:", to);
}

(async () => {
  try {
    const { subject, text } = await buildReport();
    console.log(text);
    await sendEmail(subject, text);
  } catch (err) {
    console.error("Failed to build/send weekly report:", err);
    process.exit(1);
  }
})();
