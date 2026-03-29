/**
 * ◈ GNZ Trading — Strategy Tester
 * 
 * Interactive backtesting with real Alpaca data.
 * Run: node strategy-tester.js
 * (Make sure server.js is running in another terminal)
 */

const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));

const PROXY = "http://localhost:3000";
const KEY = "PKFC6PK2O2XWQ3RQWDIZOO6VR4";
const SECRET = "EzvC6YTWBphTZvvYS57cBL44YEquxfQWNq6NCm4nPdJa";

// ════════════════════════════════════════
// ALPACA DATA
// ════════════════════════════════════════
async function fetchBars(symbol, tf, start, end) {
  const url = `${PROXY}/data/v2/stocks/${symbol}/bars?timeframe=${tf}&limit=10000&adjustment=split&feed=iex&start=${start}T00:00:00Z&end=${end}T23:59:59Z`;
  const resp = await fetch(url, {
    headers: { "APCA-API-KEY-ID": KEY, "APCA-API-SECRET-KEY": SECRET, "Content-Type": "application/json" }
  });
  if (!resp.ok) throw new Error(`Alpaca ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  if (!data.bars || data.bars.length === 0) throw new Error(`No bars for ${symbol} ${tf} ${start}→${end}`);
  return data.bars.map(b => ({ t: b.t, o: +b.o, h: +b.h, l: +b.l, c: +b.c, v: +b.v }));
}

// ════════════════════════════════════════
// TECHNICAL INDICATORS
// ════════════════════════════════════════
function calcATR(candles, period = 14) {
  const trs = [0];
  for (let i = 1; i < candles.length; i++) {
    trs.push(Math.max(
      candles[i].h - candles[i].l,
      Math.abs(candles[i].h - candles[i - 1].c),
      Math.abs(candles[i].l - candles[i - 1].c)
    ));
  }
  return (idx) => {
    const slice = trs.slice(Math.max(0, idx - period), idx + 1);
    return slice.length > 0 ? slice.reduce((a, b) => a + b) / slice.length : 0;
  };
}

function calcEMA(values, period) {
  const ema = [values[0]];
  const k = 2 / (period + 1);
  for (let i = 1; i < values.length; i++) {
    ema.push(values[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

function calcRSI(candles, period = 14) {
  const rsi = new Array(candles.length).fill(50);
  let gains = 0, losses = 0;
  for (let i = 1; i <= period && i < candles.length; i++) {
    const diff = candles[i].c - candles[i - 1].c;
    if (diff > 0) gains += diff; else losses -= diff;
  }
  if (period < candles.length) {
    let avgGain = gains / period, avgLoss = losses / period;
    rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    for (let i = period + 1; i < candles.length; i++) {
      const diff = candles[i].c - candles[i - 1].c;
      avgGain = (avgGain * (period - 1) + Math.max(0, diff)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.max(0, -diff)) / period;
      rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
  }
  return rsi;
}

function calcBollinger(candles, period = 20, mult = 2) {
  const closes = candles.map(c => c.c);
  const mid = [], upper = [], lower = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) { mid.push(closes[i]); upper.push(closes[i]); lower.push(closes[i]); continue; }
    const slice = closes.slice(i - period + 1, i + 1);
    const avg = slice.reduce((a, b) => a + b) / period;
    const std = Math.sqrt(slice.reduce((a, v) => a + (v - avg) ** 2, 0) / period);
    mid.push(avg); upper.push(avg + mult * std); lower.push(avg - mult * std);
  }
  return { mid, upper, lower };
}

function calcMACD(candles) {
  const closes = candles.map(c => c.c);
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = calcEMA(macdLine, 9);
  const histogram = macdLine.map((v, i) => v - signalLine[i]);
  return { macdLine, signalLine, histogram };
}

// ════════════════════════════════════════
// STRATEGY DETECTORS
// ════════════════════════════════════════
const STRATEGIES = {
  "1": {
    name: "Inside Bar",
    detect: (candles, p) => {
      const sigs = [];
      const atr = calcATR(candles, p.atrP);
      const avgV = (i, n = 20) => { const s = candles.slice(Math.max(0, i - n), i); return s.length ? s.reduce((a, b) => a + b.v, 0) / s.length : 0; };
      for (let i = 2; i < candles.length; i++) {
        const m = candles[i - 1], ins = candles[i];
        if (!(ins.h <= m.h && ins.l >= m.l)) continue;
        const a = atr(i); if (!a) continue;
        if (p.minB > 0 && (m.h - m.l) < a * p.minB) continue;
        if (p.volF && m.v < avgV(i) * 0.8) continue;
        if (p.conf && i + 1 < candles.length) {
          const cf = candles[i + 1], up = cf.c > m.h, dn = cf.c < m.l;
          if (!up && !dn) continue;
          const d = up ? "LONG" : "SHORT", e = up ? m.h : m.l;
          sigs.push({ idx: i, ts: ins.t, dir: d, entry: +e.toFixed(2), sl: +(d === "LONG" ? e - a * p.slM : e + a * p.slM).toFixed(2), tp: +(d === "LONG" ? e + a * p.tpM : e - a * p.tpM).toFixed(2), rr: +(p.tpM / p.slM).toFixed(2) });
        } else if (!p.conf) {
          const d = m.c > m.o ? "LONG" : "SHORT", e = d === "LONG" ? m.h : m.l;
          sigs.push({ idx: i, ts: ins.t, dir: d, entry: +e.toFixed(2), sl: +(d === "LONG" ? e - a * p.slM : e + a * p.slM).toFixed(2), tp: +(d === "LONG" ? e + a * p.tpM : e - a * p.tpM).toFixed(2), rr: +(p.tpM / p.slM).toFixed(2) });
        }
      }
      return sigs;
    },
    extraParams: async (defaults) => {
      const minB = +(await ask(`  Min Bar Size (x ATR) [${defaults.minB}]: `)) || defaults.minB;
      const volF = (await ask(`  Volume Filter (y/n) [y]: `)).toLowerCase() !== "n";
      const conf = (await ask(`  Confirmation Candle (y/n) [y]: `)).toLowerCase() !== "n";
      return { ...defaults, minB, volF, conf };
    }
  },

  "2": {
    name: "Engulfing Pattern",
    detect: (candles, p) => {
      const sigs = [];
      const atr = calcATR(candles, p.atrP);
      for (let i = 1; i < candles.length; i++) {
        const prev = candles[i - 1], curr = candles[i];
        const a = atr(i); if (!a) continue;
        // Bullish engulfing
        if (prev.c < prev.o && curr.c > curr.o && curr.o <= prev.c && curr.c >= prev.o) {
          const e = curr.c;
          sigs.push({ idx: i, ts: curr.t, dir: "LONG", entry: +e.toFixed(2), sl: +(e - a * p.slM).toFixed(2), tp: +(e + a * p.tpM).toFixed(2), rr: +(p.tpM / p.slM).toFixed(2) });
        }
        // Bearish engulfing
        if (prev.c > prev.o && curr.c < curr.o && curr.o >= prev.c && curr.c <= prev.o) {
          const e = curr.c;
          sigs.push({ idx: i, ts: curr.t, dir: "SHORT", entry: +e.toFixed(2), sl: +(e + a * p.slM).toFixed(2), tp: +(e - a * p.tpM).toFixed(2), rr: +(p.tpM / p.slM).toFixed(2) });
        }
      }
      return sigs;
    },
    extraParams: async (defaults) => defaults
  },

  "3": {
    name: "Pin Bar / Hammer",
    detect: (candles, p) => {
      const sigs = [];
      const atr = calcATR(candles, p.atrP);
      for (let i = 1; i < candles.length; i++) {
        const c = candles[i], a = atr(i); if (!a) continue;
        const body = Math.abs(c.c - c.o), range = c.h - c.l;
        if (range < a * 0.3) continue;
        const lowerWick = Math.min(c.o, c.c) - c.l;
        const upperWick = c.h - Math.max(c.o, c.c);
        // Bullish pin bar (long lower wick)
        if (lowerWick > range * 0.6 && body < range * 0.3) {
          const e = c.c;
          sigs.push({ idx: i, ts: c.t, dir: "LONG", entry: +e.toFixed(2), sl: +(c.l - a * 0.2).toFixed(2), tp: +(e + a * p.tpM).toFixed(2), rr: +(p.tpM / p.slM).toFixed(2) });
        }
        // Bearish pin bar (long upper wick)
        if (upperWick > range * 0.6 && body < range * 0.3) {
          const e = c.c;
          sigs.push({ idx: i, ts: c.t, dir: "SHORT", entry: +e.toFixed(2), sl: +(c.h + a * 0.2).toFixed(2), tp: +(e - a * p.tpM).toFixed(2), rr: +(p.tpM / p.slM).toFixed(2) });
        }
      }
      return sigs;
    },
    extraParams: async (defaults) => defaults
  },

  "4": {
    name: "EMA Crossover",
    detect: (candles, p) => {
      const sigs = [];
      const closes = candles.map(c => c.c);
      const fast = calcEMA(closes, p.emaFast);
      const slow = calcEMA(closes, p.emaSlow);
      const atr = calcATR(candles, p.atrP);
      for (let i = 2; i < candles.length; i++) {
        const a = atr(i); if (!a) continue;
        // Golden cross
        if (fast[i] > slow[i] && fast[i - 1] <= slow[i - 1]) {
          const e = candles[i].c;
          sigs.push({ idx: i, ts: candles[i].t, dir: "LONG", entry: +e.toFixed(2), sl: +(e - a * p.slM).toFixed(2), tp: +(e + a * p.tpM).toFixed(2), rr: +(p.tpM / p.slM).toFixed(2) });
        }
        // Death cross
        if (fast[i] < slow[i] && fast[i - 1] >= slow[i - 1]) {
          const e = candles[i].c;
          sigs.push({ idx: i, ts: candles[i].t, dir: "SHORT", entry: +e.toFixed(2), sl: +(e + a * p.slM).toFixed(2), tp: +(e - a * p.tpM).toFixed(2), rr: +(p.tpM / p.slM).toFixed(2) });
        }
      }
      return sigs;
    },
    extraParams: async (defaults) => {
      const emaFast = +(await ask(`  EMA Fast Period [${defaults.emaFast}]: `)) || defaults.emaFast;
      const emaSlow = +(await ask(`  EMA Slow Period [${defaults.emaSlow}]: `)) || defaults.emaSlow;
      return { ...defaults, emaFast, emaSlow };
    }
  },

  "5": {
    name: "RSI Extremes",
    detect: (candles, p) => {
      const sigs = [];
      const rsi = calcRSI(candles, p.rsiPeriod);
      const atr = calcATR(candles, p.atrP);
      for (let i = 2; i < candles.length; i++) {
        const a = atr(i); if (!a) continue;
        // RSI crosses above oversold
        if (rsi[i] > p.rsiOS && rsi[i - 1] <= p.rsiOS) {
          const e = candles[i].c;
          sigs.push({ idx: i, ts: candles[i].t, dir: "LONG", entry: +e.toFixed(2), sl: +(e - a * p.slM).toFixed(2), tp: +(e + a * p.tpM).toFixed(2), rr: +(p.tpM / p.slM).toFixed(2) });
        }
        // RSI crosses below overbought
        if (rsi[i] < p.rsiOB && rsi[i - 1] >= p.rsiOB) {
          const e = candles[i].c;
          sigs.push({ idx: i, ts: candles[i].t, dir: "SHORT", entry: +e.toFixed(2), sl: +(e + a * p.slM).toFixed(2), tp: +(e - a * p.tpM).toFixed(2), rr: +(p.tpM / p.slM).toFixed(2) });
        }
      }
      return sigs;
    },
    extraParams: async (defaults) => {
      const rsiPeriod = +(await ask(`  RSI Period [${defaults.rsiPeriod}]: `)) || defaults.rsiPeriod;
      const rsiOS = +(await ask(`  RSI Oversold [${defaults.rsiOS}]: `)) || defaults.rsiOS;
      const rsiOB = +(await ask(`  RSI Overbought [${defaults.rsiOB}]: `)) || defaults.rsiOB;
      return { ...defaults, rsiPeriod, rsiOS, rsiOB };
    }
  },

  "6": {
    name: "MACD Crossover",
    detect: (candles, p) => {
      const sigs = [];
      const { macdLine, signalLine } = calcMACD(candles);
      const atr = calcATR(candles, p.atrP);
      for (let i = 27; i < candles.length; i++) {
        const a = atr(i); if (!a) continue;
        // MACD crosses above signal
        if (macdLine[i] > signalLine[i] && macdLine[i - 1] <= signalLine[i - 1]) {
          const e = candles[i].c;
          sigs.push({ idx: i, ts: candles[i].t, dir: "LONG", entry: +e.toFixed(2), sl: +(e - a * p.slM).toFixed(2), tp: +(e + a * p.tpM).toFixed(2), rr: +(p.tpM / p.slM).toFixed(2) });
        }
        // MACD crosses below signal
        if (macdLine[i] < signalLine[i] && macdLine[i - 1] >= signalLine[i - 1]) {
          const e = candles[i].c;
          sigs.push({ idx: i, ts: candles[i].t, dir: "SHORT", entry: +e.toFixed(2), sl: +(e + a * p.slM).toFixed(2), tp: +(e - a * p.tpM).toFixed(2), rr: +(p.tpM / p.slM).toFixed(2) });
        }
      }
      return sigs;
    },
    extraParams: async (defaults) => defaults
  },

  "7": {
    name: "Bollinger Squeeze",
    detect: (candles, p) => {
      const sigs = [];
      const { upper, lower, mid } = calcBollinger(candles, 20, 2);
      const atr = calcATR(candles, p.atrP);
      for (let i = 21; i < candles.length; i++) {
        const a = atr(i); if (!a) continue;
        const bw = (upper[i] - lower[i]) / mid[i];
        const prevBw = (upper[i - 1] - lower[i - 1]) / mid[i - 1];
        // Squeeze breakout: bandwidth was tight, now expanding
        if (prevBw < 0.06 && bw > prevBw * 1.2) {
          const dir = candles[i].c > mid[i] ? "LONG" : "SHORT";
          const e = candles[i].c;
          sigs.push({ idx: i, ts: candles[i].t, dir, entry: +e.toFixed(2), sl: +(dir === "LONG" ? e - a * p.slM : e + a * p.slM).toFixed(2), tp: +(dir === "LONG" ? e + a * p.tpM : e - a * p.tpM).toFixed(2), rr: +(p.tpM / p.slM).toFixed(2) });
        }
      }
      return sigs;
    },
    extraParams: async (defaults) => defaults
  },

  "8": {
    name: "ATR Breakout",
    detect: (candles, p) => {
      const sigs = [];
      const atr = calcATR(candles, p.atrP);
      for (let i = 2; i < candles.length; i++) {
        const a = atr(i); if (!a) continue;
        const move = Math.abs(candles[i].c - candles[i - 1].c);
        if (move > a * 1.5) {
          const dir = candles[i].c > candles[i - 1].c ? "LONG" : "SHORT";
          const e = candles[i].c;
          sigs.push({ idx: i, ts: candles[i].t, dir, entry: +e.toFixed(2), sl: +(dir === "LONG" ? e - a * p.slM : e + a * p.slM).toFixed(2), tp: +(dir === "LONG" ? e + a * p.tpM : e - a * p.tpM).toFixed(2), rr: +(p.tpM / p.slM).toFixed(2) });
        }
      }
      return sigs;
    },
    extraParams: async (defaults) => defaults
  }
};

// ════════════════════════════════════════
// BACKTEST ENGINE
// ════════════════════════════════════════
function backtest(candles, sigs, capital, riskPct, maxHold = 50) {
  let c = capital, w = 0, lo = 0, mx = capital, md = 0;
  const trades = [];
  let totalProfit = 0, totalLoss = 0;

  sigs.forEach((s) => {
    const sd = Math.abs(s.entry - s.sl);
    if (!sd) return;
    const riskAmt = c * riskPct;
    const sz = Math.floor(riskAmt / sd);
    if (!sz || sz < 1) return;
    const maxShares = Math.floor(c * 0.5 / s.entry);
    const posSize = Math.min(sz, maxShares);
    if (posSize < 1) return;

    let h = null, exitPrice = s.entry, exitBar = -1;
    const end = Math.min(s.idx + maxHold, candles.length - 1);

    for (let j = s.idx + 1; j <= end; j++) {
      const k = candles[j];
      if (s.dir === "LONG") {
        if (k.l <= s.sl) { h = "SL"; exitPrice = s.sl; exitBar = j; break; }
        if (k.h >= s.tp) { h = "TP"; exitPrice = s.tp; exitBar = j; break; }
      } else {
        if (k.h >= s.sl) { h = "SL"; exitPrice = s.sl; exitBar = j; break; }
        if (k.l <= s.tp) { h = "TP"; exitPrice = s.tp; exitBar = j; break; }
      }
    }

    if (!h) {
      const lastBar = candles[end] || candles[candles.length - 1];
      exitPrice = lastBar.c;
      exitBar = end;
      h = s.dir === "LONG" ? (exitPrice > s.entry ? "WIN" : "LOSS") : (exitPrice < s.entry ? "WIN" : "LOSS");
    }

    const pnlPerShare = s.dir === "LONG" ? (exitPrice - s.entry) : (s.entry - exitPrice);
    const pnlAbs = +(posSize * pnlPerShare).toFixed(2);
    const pnlPct = +((exitPrice - s.entry) / s.entry * 100 * (s.dir === "LONG" ? 1 : -1)).toFixed(2);
    const capBefore = c;
    c = +(c + pnlAbs).toFixed(2);
    const portPct = +(pnlAbs / capBefore * 100).toFixed(2);

    const isWin = h === "TP" || h === "WIN";
    if (isWin) { w++; totalProfit += Math.max(0, pnlAbs); }
    else { lo++; totalLoss += Math.abs(Math.min(0, pnlAbs)); }

    mx = Math.max(mx, c);
    const curDD = mx > 0 ? -((mx - c) / mx * 100) : 0;
    md = Math.max(md, mx > 0 ? (mx - c) / mx : 0);

    const barsHeld = exitBar > 0 ? exitBar - s.idx : 0;
    const exitDate = exitBar > 0 && candles[exitBar] ? candles[exitBar].t : s.ts;

    trades.push({
      num: trades.length + 1,
      dateEntry: s.ts, dateExit: exitDate,
      type: s.dir === "LONG" ? "BUY" : "SELL",
      shares: posSize, entry: s.entry, sl: s.sl, tp: s.tp, exit: +exitPrice.toFixed(2),
      result: h, pnlAbs, pnlPct, portPct,
      capital: c, drawdown: +curDD.toFixed(2), barsHeld
    });
  });

  const tot = w + lo;
  return {
    tot, w, lo,
    wr: +(tot ? w / tot * 100 : 0).toFixed(1),
    md: +(md * 100).toFixed(1),
    ret: +((c - capital) / capital * 100).toFixed(2),
    pf: totalLoss > 0 ? +(totalProfit / totalLoss).toFixed(2) : (totalProfit > 0 ? 999 : 0),
    expectancy: tot > 0 ? +((totalProfit - totalLoss) / tot).toFixed(2) : 0,
    capF: c, cap0: capital,
    avgWin: w > 0 ? +(totalProfit / w).toFixed(2) : 0,
    avgLoss: lo > 0 ? +(totalLoss / lo).toFixed(2) : 0,
    avgBars: tot > 0 ? +(trades.reduce((a, t) => a + t.barsHeld, 0) / tot).toFixed(1) : 0,
    trades
  };
}

// ════════════════════════════════════════
// DISPLAY
// ════════════════════════════════════════
function printResults(stratName, symbol, tf, period, bt, candles) {
  console.log("\n" + "═".repeat(70));
  console.log(`  ◈ ${stratName} — ${symbol} ${tf} — ${period}`);
  console.log(`  Data: ${candles.length} REAL bars from Alpaca (IEX)`);
  console.log(`  Price range: $${Math.min(...candles.map(c => c.l)).toFixed(2)} — $${Math.max(...candles.map(c => c.h)).toFixed(2)}`);
  console.log("═".repeat(70) + "\n");

  console.log("  ┌──────────────────────────────────────────────┐");
  console.log(`  │ Capital Inicial:    $${bt.cap0.toLocaleString().padStart(15)}  │`);
  console.log(`  │ Capital Final:      $${bt.capF.toLocaleString().padStart(15)}  │`);
  console.log(`  │ Retorno:            ${(bt.ret + "%").padStart(16)}  │`);
  console.log(`  │ Win Rate:           ${(bt.wr + "%").padStart(16)}  │`);
  console.log(`  │ Trades:             ${String(bt.tot).padStart(16)}  │`);
  console.log(`  │ Wins / Losses:      ${(bt.w + " / " + bt.lo).padStart(16)}  │`);
  console.log(`  │ Profit Factor:      ${String(bt.pf).padStart(16)}  │`);
  console.log(`  │ Max Drawdown:       ${(bt.md + "%").padStart(16)}  │`);
  console.log(`  │ Avg Win:            $${bt.avgWin.toLocaleString().padStart(14)}  │`);
  console.log(`  │ Avg Loss:           $${bt.avgLoss.toLocaleString().padStart(14)}  │`);
  console.log(`  │ Expectancy/Trade:   $${bt.expectancy.toLocaleString().padStart(14)}  │`);
  console.log(`  │ Avg Bars Held:      ${(bt.avgBars + " bars").padStart(16)}  │`);
  console.log("  └──────────────────────────────────────────────┘\n");

  if (bt.trades.length > 0) {
    console.log("  TRADE LOG:");
    console.log("  " + "-".repeat(140));
    console.log("  #  | Entry Date   | Exit Date    | Type | Shrs | Entry     | SL        | TP        | Exit      | Result | PnL $         | Prc%    | Port%   | Capital        | DD%     | Bars");
    console.log("  " + "-".repeat(140));

    bt.trades.forEach(t => {
      const de = new Date(t.dateEntry).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "2-digit" });
      const dx = new Date(t.dateExit).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "2-digit" });
      const pnl = `${t.pnlAbs >= 0 ? "+" : ""}$${t.pnlAbs.toFixed(2)}`;
      console.log(`  ${String(t.num).padStart(2)} | ${de.padEnd(12)}| ${dx.padEnd(12)}| ${t.type.padEnd(4)} | ${String(t.shares).padStart(4)} | $${String(t.entry).padStart(8)} | $${String(t.sl).padStart(8)} | $${String(t.tp).padStart(8)} | $${String(t.exit).padStart(8)} | ${t.result.padEnd(6)} | ${pnl.padStart(13)} | ${(t.pnlPct >= 0 ? "+" : "") + t.pnlPct + "%"} | ${(t.portPct >= 0 ? "+" : "") + t.portPct + "%"} | $${t.capital.toLocaleString().padStart(13)} | ${t.drawdown.toFixed(1).padStart(6)}% | ${t.barsHeld}`);
    });
  }

  // Verification
  console.log("\n  VERIFICATION:");
  let verCap = bt.cap0;
  let ok = true;
  bt.trades.forEach(t => {
    verCap = +(verCap + t.pnlAbs).toFixed(2);
    if (Math.abs(verCap - t.capital) > 0.05) { console.log(`    ✗ Trade ${t.num}: Expected $${verCap}, got $${t.capital}`); ok = false; }
  });
  if (ok) console.log("    ✓ Capital chain correct");
  console.log(`    ✓ Final: $${bt.capF}`);
  console.log(`    ✓ Data: REAL (Alpaca IEX) — ${candles.length} bars`);
  console.log(`    ✓ No random outcomes`);
}

// ════════════════════════════════════════
// MAIN
// ════════════════════════════════════════
async function main() {
  console.log("\n" + "═".repeat(50));
  console.log("  ◈ GNZ Trading — Strategy Tester");
  console.log("  Real data from Alpaca via proxy");
  console.log("═".repeat(50) + "\n");

  while (true) {
    // Strategy selection
    console.log("  ESTRATEGIAS DISPONIBLES:");
    console.log("  ─────────────────────────────────────");
    Object.entries(STRATEGIES).forEach(([k, v]) => {
      console.log(`    ${k}. ${v.name}`);
    });
    console.log(`    0. Salir`);
    console.log("");

    const choice = await ask("  Selecciona estrategia (1-8, o 0 para salir): ");
    if (choice === "0") { console.log("\n  ¡Hasta luego!\n"); rl.close(); return; }
    const strategy = STRATEGIES[choice];
    if (!strategy) { console.log("  Opción inválida.\n"); continue; }

    console.log(`\n  → ${strategy.name} seleccionada\n`);

    // Ticker(s)
    const tickerInput = await ask("  Ticker(s) separados por coma [NVDA]: ");
    const tickers = (tickerInput || "NVDA").toUpperCase().split(",").map(s => s.trim()).filter(Boolean);

    // Timeframe
    console.log("  Timeframes: 1Min, 5Min, 15Min, 1Hour, 4Hour, 1Day, 1Week");
    const tf = (await ask("  Timeframe [1Hour]: ")) || "1Hour";

    // Period
    const start = (await ask("  Fecha inicio YYYY-MM-DD [2025-01-01]: ")) || "2025-01-01";
    const end = (await ask("  Fecha fin YYYY-MM-DD [2026-03-29]: ")) || "2026-03-29";

    // Capital & Risk
    const capital = +(await ask("  Capital inicial [$100000]: ")) || 100000;
    const riskPct = +(await ask("  Riesgo por trade % [8]: ")) || 8;

    // Common params
    const atrP = +(await ask("  ATR Period [14]: ")) || 14;
    const slM = +(await ask("  SL Multiplier (x ATR) [1.5]: ")) || 1.5;
    const tpM = +(await ask("  TP Multiplier (x ATR) [3.0]: ")) || 3.0;

    let params = {
      atrP, slM, tpM,
      minB: 0.5, volF: true, conf: true,
      emaFast: 9, emaSlow: 21,
      rsiPeriod: 14, rsiOS: 30, rsiOB: 70
    };

    // Strategy-specific params
    params = await strategy.extraParams(params);

    const maxHold = +(await ask("  Max Hold Bars [50]: ")) || 50;

    // Run for each ticker
    for (const symbol of tickers) {
      console.log(`\n  Fetching ${symbol} ${tf} from ${start} to ${end}...`);
      try {
        const candles = await fetchBars(symbol, tf, start, end);
        console.log(`  ✓ Got ${candles.length} real bars`);

        const sigs = strategy.detect(candles, params);
        console.log(`  ✓ Detected ${sigs.length} signals`);

        if (sigs.length === 0) {
          console.log(`\n  No signals found for ${symbol}. Try different params or period.\n`);
          continue;
        }

        const bt = backtest(candles, sigs, capital, riskPct / 100, maxHold);
        printResults(strategy.name, symbol, tf, `${start} → ${end}`, bt, candles);

      } catch (err) {
        console.log(`  ✗ Error for ${symbol}: ${err.message}`);
      }
    }

    console.log("\n" + "─".repeat(50));
    const again = await ask("\n  ¿Correr otro test? (y/n) [y]: ");
    if (again.toLowerCase() === "n") { console.log("\n  ¡Hasta luego!\n"); rl.close(); return; }
    console.log("");
  }
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
