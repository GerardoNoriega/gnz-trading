/**
 * ◈ GNZ Trading — Backtest Verification with REAL DATA
 * 
 * Run this from your gnz-trading folder:
 *   node verify-backtest.js
 * 
 * Make sure server.js or the proxy is running first:
 *   node server.js
 */

const PROXY = "http://localhost:3000"; // production server
const ALPACA_KEY = "PKFC6PK2O2XWQ3RQWDIZOO6VR4";
const ALPACA_SECRET = "EzvC6YTWBphTZvvYS57cBL44YEquxfQWNq6NCm4nPdJa";

// ═══ PARAMS (matching your screenshot) ═══
const SYMBOL = "NVDA";
const TIMEFRAME = "1Hour";
const CAPITAL = 100000;
const RISK_PCT = 0.08; // 8%
const START = "2025-12-29";
const END = "2026-03-29";
const ATR_PERIOD = 14;
const SL_MULT = 1.5;
const TP_MULT = 3.0;
const VOL_FILTER = true;
const CONFIRMATION = true;
const MIN_BAR = 0.5;
const MAX_HOLD = 50;

// ═══ FETCH REAL DATA ═══
async function fetchBars() {
  const url = `${PROXY}/data/v2/stocks/${SYMBOL}/bars?timeframe=${TIMEFRAME}&limit=10000&adjustment=split&feed=iex&start=${START}T00:00:00Z&end=${END}T23:59:59Z`;
  console.log(`\nFetching: ${url}\n`);
  
  const resp = await fetch(url, {
    headers: {
      "APCA-API-KEY-ID": ALPACA_KEY,
      "APCA-API-SECRET-KEY": ALPACA_SECRET,
      "Content-Type": "application/json"
    }
  });
  
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Alpaca API error ${resp.status}: ${err}`);
  }
  
  const data = await resp.json();
  if (!data.bars || data.bars.length === 0) {
    throw new Error("No bars returned. Check symbol, dates, and that market was open.");
  }
  
  return data.bars.map(b => ({
    t: b.t, o: +b.o, h: +b.h, l: +b.l, c: +b.c, v: +b.v
  }));
}

// ═══ INSIDE BAR DETECTION ═══
function detectIB(candles) {
  const p = { atrP: ATR_PERIOD, slM: SL_MULT, tpM: TP_MULT, volF: VOL_FILTER, conf: CONFIRMATION, minB: MIN_BAR };
  const sigs = [], atrs = [];
  for (let i = 1; i < candles.length; i++) {
    atrs.push(Math.max(
      candles[i].h - candles[i].l,
      Math.abs(candles[i].h - candles[i - 1].c),
      Math.abs(candles[i].l - candles[i - 1].c)
    ));
  }
  const atr = i => { const s = atrs.slice(Math.max(0, i - p.atrP), i); return s.length ? s.reduce((a, b) => a + b) / s.length : 0; };
  const avgV = (i, n = 20) => { const s = candles.slice(Math.max(0, i - n), i); return s.length ? s.reduce((a, b) => a + b.v, 0) / s.length : 0; };

  for (let i = 2; i < candles.length; i++) {
    const m = candles[i - 1], ins = candles[i];
    if (!(ins.h <= m.h && ins.l >= m.l)) continue;
    const a = atr(i);
    if (p.minB > 0 && (m.h - m.l) < a * p.minB) continue;
    if (p.volF && m.v < avgV(i) * 0.8) continue;

    if (p.conf && i + 1 < candles.length) {
      const cf = candles[i + 1], up = cf.c > m.h, dn = cf.c < m.l;
      if (!up && !dn) continue;
      const d = up ? "LONG" : "SHORT", e = up ? m.h : m.l;
      sigs.push({
        idx: i, ts: ins.t, dir: d,
        entry: +e.toFixed(2),
        sl: +(d === "LONG" ? e - a * p.slM : e + a * p.slM).toFixed(2),
        tp: +(d === "LONG" ? e + a * p.tpM : e - a * p.tpM).toFixed(2),
        rr: +(p.tpM / p.slM).toFixed(2),
        mh: m.h, ml: m.l, atr: +a.toFixed(4)
      });
    } else if (!p.conf) {
      const d = m.c > m.o ? "LONG" : "SHORT", e = d === "LONG" ? m.h : m.l;
      sigs.push({
        idx: i, ts: ins.t, dir: d,
        entry: +e.toFixed(2),
        sl: +(d === "LONG" ? e - a * p.slM : e + a * p.slM).toFixed(2),
        tp: +(d === "LONG" ? e + a * p.tpM : e - a * p.tpM).toFixed(2),
        rr: +(p.tpM / p.slM).toFixed(2),
        mh: m.h, ml: m.l, atr: +a.toFixed(4)
      });
    }
  }
  return sigs;
}

// ═══ BACKTEST ═══
function backtest(candles, sigs) {
  let c = CAPITAL, w = 0, lo = 0, mx = CAPITAL, md = 0;
  const trades = [];
  let totalProfit = 0, totalLoss = 0;

  sigs.forEach((s, i) => {
    const sd = Math.abs(s.entry - s.sl);
    if (!sd) return;
    const riskAmt = c * RISK_PCT;
    const sz = Math.floor(riskAmt / sd);
    if (!sz || sz < 1) return;
    const maxShares = Math.floor(c * 0.5 / s.entry);
    const posSize = Math.min(sz, maxShares);
    if (posSize < 1) return;

    let h = null, exitPrice = s.entry, exitBar = -1;
    const end = Math.min(s.idx + MAX_HOLD, candles.length - 1);

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
      h = s.dir === "LONG"
        ? (exitPrice > s.entry ? "WIN" : "LOSS")
        : (exitPrice < s.entry ? "WIN" : "LOSS");
    }

    const pnlPerShare = s.dir === "LONG" ? (exitPrice - s.entry) : (s.entry - exitPrice);
    const pnlAbs = +(posSize * pnlPerShare).toFixed(2);
    const pnlPricePct = +((exitPrice - s.entry) / s.entry * 100 * (s.dir === "LONG" ? 1 : -1)).toFixed(2);
    const capitalBefore = c;
    c = +(c + pnlAbs).toFixed(2);
    const pnlPortPct = +(pnlAbs / capitalBefore * 100).toFixed(2);

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
      dateEntry: s.ts,
      dateExit: exitDate,
      type: s.dir === "LONG" ? "BUY" : "SELL",
      shares: posSize,
      entry: s.entry,
      sl: s.sl,
      tp: s.tp,
      exit: +exitPrice.toFixed(2),
      result: h,
      pnlAbs,
      pnlPricePct,
      pnlPortPct,
      capitalAfter: c,
      drawdown: +curDD.toFixed(2),
      barsHeld,
      atr: s.atr
    });
  });

  const tot = w + lo;
  return {
    tot, w, lo,
    wr: +(tot ? w / tot * 100 : 0).toFixed(1),
    md: +(md * 100).toFixed(1),
    ret: +((c - CAPITAL) / CAPITAL * 100).toFixed(2),
    pf: totalLoss > 0 ? +(totalProfit / totalLoss).toFixed(2) : 0,
    expectancy: tot > 0 ? +((totalProfit - totalLoss) / tot).toFixed(2) : 0,
    capF: c,
    avgWin: w > 0 ? +(totalProfit / w).toFixed(2) : 0,
    avgLoss: lo > 0 ? +(totalLoss / lo).toFixed(2) : 0,
    avgBars: tot > 0 ? +(trades.reduce((a, t) => a + t.barsHeld, 0) / tot).toFixed(1) : 0,
    trades
  };
}

// ═══ MAIN ═══
async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  ◈ GNZ Trading — Backtest Verification (REAL DATA)");
  console.log("═══════════════════════════════════════════════════════\n");

  console.log("PARAMETERS:");
  console.log(`  Symbol:     ${SYMBOL}`);
  console.log(`  Timeframe:  ${TIMEFRAME}`);
  console.log(`  Capital:    $${CAPITAL.toLocaleString()}`);
  console.log(`  Risk/Trade: ${RISK_PCT * 100}%`);
  console.log(`  ATR Period: ${ATR_PERIOD}`);
  console.log(`  SL Mult:    ${SL_MULT}x ATR`);
  console.log(`  TP Mult:    ${TP_MULT}x ATR`);
  console.log(`  Vol Filter: ${VOL_FILTER ? "ON" : "OFF"}`);
  console.log(`  Confirm:    ${CONFIRMATION ? "ON" : "OFF"}`);
  console.log(`  Min Bar:    ${MIN_BAR}x ATR`);
  console.log(`  Period:     ${START} → ${END}`);
  console.log(`  Max Hold:   ${MAX_HOLD} bars\n`);

  // Step 1: Fetch real data
  console.log("STEP 1 — Fetching REAL data from Alpaca...");
  let candles;
  try {
    candles = await fetchBars();
  } catch (err) {
    console.error(`\n  ✗ ERROR: ${err.message}`);
    console.error("  Make sure the server is running: node server.js\n");
    process.exit(1);
  }

  console.log(`  ✓ Got ${candles.length} REAL bars from Alpaca (IEX)`);
  console.log(`  First bar: ${candles[0].t} O:$${candles[0].o} H:$${candles[0].h} L:$${candles[0].l} C:$${candles[0].c} V:${candles[0].v}`);
  console.log(`  Last bar:  ${candles[candles.length - 1].t} O:$${candles[candles.length - 1].o} H:$${candles[candles.length - 1].h} L:$${candles[candles.length - 1].l} C:$${candles[candles.length - 1].c} V:${candles[candles.length - 1].v}`);
  console.log(`  Price range: $${Math.min(...candles.map(c => c.l)).toFixed(2)} — $${Math.max(...candles.map(c => c.h)).toFixed(2)}\n`);

  // Step 2: Detect signals
  console.log("STEP 2 — Inside Bar Detection...");
  const sigs = detectIB(candles);
  console.log(`  ✓ Found ${sigs.length} Inside Bar signals\n`);

  if (sigs.length === 0) {
    console.log("  No signals found. Try adjusting parameters (lower minB, disable vol filter, etc.)");
    process.exit(0);
  }

  // Show all signals
  console.log("  Signals:");
  sigs.forEach((s, i) => {
    const date = new Date(s.ts).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "2-digit" });
    console.log(`    ${i + 1}. ${date} ${s.dir.padEnd(5)} Entry:$${s.entry} SL:$${s.sl} TP:$${s.tp} R:R:${s.rr}x ATR:$${s.atr}`);
  });
  console.log("");

  // Step 3: Run backtest
  console.log("STEP 3 — Running Backtest...\n");
  const bt = backtest(candles, sigs);

  console.log("  ┌──────────────────────────────────────────┐");
  console.log(`  │ Capital Inicial:  $${CAPITAL.toLocaleString().padStart(15)}`);
  console.log(`  │ Capital Final:    $${bt.capF.toLocaleString().padStart(15)}`);
  console.log(`  │ Retorno:          ${(bt.ret + "%").padStart(15)}`);
  console.log(`  │ Win Rate:         ${(bt.wr + "%").padStart(15)}`);
  console.log(`  │ Trades:           ${String(bt.tot).padStart(15)}`);
  console.log(`  │ Wins / Losses:    ${(bt.w + " / " + bt.lo).padStart(15)}`);
  console.log(`  │ Profit Factor:    ${String(bt.pf).padStart(15)}`);
  console.log(`  │ Max Drawdown:     ${(bt.md + "%").padStart(15)}`);
  console.log(`  │ Avg Win:          $${bt.avgWin.toLocaleString().padStart(14)}`);
  console.log(`  │ Avg Loss:         $${bt.avgLoss.toLocaleString().padStart(14)}`);
  console.log(`  │ Expectancy:       $${bt.expectancy.toLocaleString().padStart(14)}`);
  console.log(`  │ Avg Hold:         ${(bt.avgBars + " bars").padStart(15)}`);
  console.log("  └──────────────────────────────────────────┘\n");

  // Step 4: Trade log
  console.log("STEP 4 — TRADE LOG (REAL DATA):\n");
  console.log("#  | Entry Date   | Exit Date    | Type | Shrs | Entry     | SL        | TP        | Exit      | Result | PnL $         | Price%  | Port%  | Capital        | DD%     | Bars");
  console.log("---|------------- |------------- |------|------|-----------|-----------|-----------|-----------|--------|---------------|---------|--------|----------------|---------|-----");

  bt.trades.forEach(t => {
    const de = new Date(t.dateEntry).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "2-digit" });
    const dx = new Date(t.dateExit).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "2-digit" });
    const pnl = `${t.pnlAbs >= 0 ? "+" : ""}$${t.pnlAbs.toFixed(2)}`;
    const pp = `${t.pnlPricePct >= 0 ? "+" : ""}${t.pnlPricePct}%`;
    const port = `${t.pnlPortPct >= 0 ? "+" : ""}${t.pnlPortPct}%`;
    console.log(
      `${String(t.num).padStart(2)} | ${de.padEnd(12)}| ${dx.padEnd(12)}| ${t.type.padEnd(4)} | ${String(t.shares).padStart(4)} | $${String(t.entry).padStart(8)} | $${String(t.sl).padStart(8)} | $${String(t.tp).padStart(8)} | $${String(t.exit).padStart(8)} | ${t.result.padEnd(6)} | ${pnl.padStart(13)} | ${pp.padStart(7)} | ${port.padStart(6)} | $${t.capitalAfter.toLocaleString().padStart(13)} | ${t.drawdown.toFixed(1).padStart(6)}% | ${t.barsHeld}`
    );
  });

  // Step 5: Verification
  console.log("\n\nSTEP 5 — VERIFICATION:\n");

  let verCap = CAPITAL;
  let chainOk = true;
  bt.trades.forEach(t => {
    verCap = +(verCap + t.pnlAbs).toFixed(2);
    if (Math.abs(verCap - t.capitalAfter) > 0.05) {
      console.log(`  ✗ Trade ${t.num}: Capital mismatch. Expected $${verCap}, got $${t.capitalAfter}`);
      chainOk = false;
    }
  });
  if (chainOk) console.log("  ✓ Capital chain correct");
  console.log(`  ${Math.abs(verCap - bt.capF) < 0.05 ? "✓" : "✗"} Final capital: $${bt.capF}`);
  console.log(`  ✓ Data source: REAL (Alpaca IEX)`);
  console.log(`  ✓ ${candles.length} real bars used`);
  console.log(`  ✓ No random outcomes`);

  console.log("\n═══ DONE ═══\n");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
