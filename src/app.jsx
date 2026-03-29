import { useState, useEffect, useCallback, useMemo, useRef } from "react";

// ════════════════════════════════════════
// DESIGN TOKENS
// ════════════════════════════════════════
const T = {
  primary: "#745b00", gold: "#C5A021", goldLight: "#ffe08a",
  yellow: "#FFD700", yellowLight: "#fff3cc",
  white: "#ffffff", black: "#1a1a1a", grey: "#6b6b6b", muted: "#999",
  bg: "#f3f3f4", bgLow: "#f7f7f8", bgMid: "#efefef", bgHigh: "#e8e8e9",
  dark: "#2a2a2a", darker: "#1a1a1a",
  green: "#2d7a3a", greenBg: "#e8f5ea", red: "#c62828", redBg: "#fce8e8",
  ghost: "rgba(0,0,0,0.06)",
};

// ════════════════════════════════════════
// ALPACA CLIENT (via proxy)
// ════════════════════════════════════════
// In production, proxy runs on same server (relative URLs). In dev, on port 3001.
const IS_DEV = window.location.port === "5173";
const PROXY = IS_DEV ? `http://${window.location.hostname}:3001` : "";

class Alpaca {
  constructor(key, secret) {
    this.key = key; this.secret = secret;
    this.h = { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret, "Content-Type": "application/json" };
  }
  async req(url, opts = {}) {
    const r = await fetch(url, { ...opts, headers: { ...this.h, ...opts.headers } });
    if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r.json();
  }
  account() { return this.req(`${PROXY}/alpaca/v2/account`); }
  positions() { return this.req(`${PROXY}/alpaca/v2/positions`); }
  orders(s = "all", n = 20) { return this.req(`${PROXY}/alpaca/v2/orders?status=${s}&limit=${n}`); }
  order(body) { return this.req(`${PROXY}/alpaca/v2/orders`, { method: "POST", body: JSON.stringify(body) }); }
  bars(sym, tf = "1Day", n = 200, start, end) {
    let url = `${PROXY}/data/v2/stocks/${sym}/bars?timeframe=${tf}&limit=${n}&adjustment=split&feed=iex`;
    if (start) url += `&start=${start}T00:00:00Z`;
    if (end) url += `&end=${end}T23:59:59Z`;
    return this.req(url);
  }
  // Test data connection
  async testData(sym = "AAPL") {
    const r = await this.req(`${PROXY}/data/v2/stocks/${sym}/bars?timeframe=1Day&limit=5&adjustment=split&feed=iex`);
    return r;
  }
}

// ════════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════════
const ALLOC = { ETF: { t: .4, l: "ETFs", c: T.gold }, GROWTH: { t: .3, l: "Crecimiento", c: T.darker }, POWER: { t: .3, l: "Poder", c: T.bgHigh } };
const ASSETS = {
  ETF: [{ s: "VTI", n: "Vanguard Total Stock", p: 260 }, { s: "QQQ", n: "Invesco QQQ", p: 440 }, { s: "SPY", n: "SPDR S&P 500", p: 520 }, { s: "VOO", n: "Vanguard S&P 500", p: 475 }],
  GROWTH: [{ s: "AAPL", n: "Apple Inc.", p: 207 }, { s: "MSFT", n: "Microsoft", p: 408 }, { s: "NVDA", n: "NVIDIA", p: 135 }, { s: "GOOGL", n: "Alphabet", p: 160 }],
  POWER: [{ s: "TSLA", n: "Tesla", p: 250 }, { s: "COIN", n: "Coinbase", p: 210 }, { s: "AMD", n: "AMD", p: 155 }, { s: "PLTR", n: "Palantir", p: 85 }],
};
const ALL_A = Object.values(ASSETS).flat();
const catOf = s => { for (const [k, v] of Object.entries(ASSETS)) if (v.some(a => a.s === s)) return k; return "GROWTH"; };
const nameOf = s => ALL_A.find(a => a.s === s)?.n || s;
const priceOf = s => ALL_A.find(a => a.s === s)?.p || 100;
const TFS = [{ v: "1Min", l: "1M" }, { v: "5Min", l: "5M" }, { v: "15Min", l: "15M" }, { v: "1Hour", l: "1H" }, { v: "4Hour", l: "4H" }, { v: "1Day", l: "1D" }, { v: "1Week", l: "1W" }];

// ════════════════════════════════════════
// SIMULATED DATA
// ════════════════════════════════════════
function simCandles(sym, n = 200, tf = "1Day") {
  const c = []; let b = priceOf(sym);
  const vol = catOf(sym) === "POWER" ? .035 : catOf(sym) === "GROWTH" ? .02 : .012;
  for (let i = n; i >= 0; i--) {
    const ch = (Math.random() - .48) * vol, o = b, cl = o * (1 + ch);
    c.push({ t: new Date(Date.now() - i * 864e5).toISOString(), o: +o.toFixed(2), h: +(Math.max(o, cl) * (1 + Math.random() * vol * .5)).toFixed(2), l: +(Math.min(o, cl) * (1 - Math.random() * vol * .5)).toFixed(2), c: +cl.toFixed(2), v: Math.floor(1e6 + Math.random() * 5e6) });
    b = cl;
  }
  return c;
}
function simPositions() {
  return [...ASSETS.ETF.slice(0, 2).map(a => ({ ...a, cat: "ETF" })), ...ASSETS.GROWTH.slice(0, 2).map(a => ({ ...a, cat: "GROWTH" })), ...ASSETS.POWER.slice(0, 2).map(a => ({ ...a, cat: "POWER" }))].map(a => {
    const q = Math.floor(5 + Math.random() * 40), e = +(a.p * (.93 + Math.random() * .07)).toFixed(2), pr = +(a.p * (.96 + Math.random() * .1)).toFixed(2);
    return { sym: a.s, name: a.n, cat: a.cat, qty: q, entry: e, price: pr, mv: +(q * pr).toFixed(2), pl: +((pr - e) * q).toFixed(2), plP: +(((pr - e) / e) * 100).toFixed(2) };
  });
}

// ════════════════════════════════════════
// INSIDE BAR ENGINE
// ════════════════════════════════════════
function detectIB(candles, p) {
  const sigs = [], atrs = [];
  for (let i = 1; i < candles.length; i++) atrs.push(Math.max(candles[i].h - candles[i].l, Math.abs(candles[i].h - candles[i - 1].c), Math.abs(candles[i].l - candles[i - 1].c)));
  const atr = i => { const s = atrs.slice(Math.max(0, i - p.atrP), i); return s.length ? s.reduce((a, b) => a + b) / s.length : 0; };
  const avgV = (i, n = 20) => { const s = candles.slice(Math.max(0, i - n), i); return s.length ? s.reduce((a, b) => a + b.v, 0) / s.length : 0; };
  for (let i = 2; i < candles.length; i++) {
    const m = candles[i - 1], ins = candles[i];
    if (!(ins.h <= m.h && ins.l >= m.l)) continue;
    const a = atr(i);
    if (p.minB > 0 && (m.h - m.l) < a * p.minB) continue;
    if (p.volF && m.v < avgV(i) * .8) continue;
    if (p.conf && i + 1 < candles.length) {
      const cf = candles[i + 1], up = cf.c > m.h, dn = cf.c < m.l;
      if (!up && !dn) continue;
      const d = up ? "LONG" : "SHORT", e = up ? m.h : m.l;
      sigs.push({ idx: i, ts: ins.t, dir: d, entry: +e.toFixed(2), sl: +(d === "LONG" ? e - a * p.slM : e + a * p.slM).toFixed(2), tp: +(d === "LONG" ? e + a * p.tpM : e - a * p.tpM).toFixed(2), rr: +(p.tpM / p.slM).toFixed(2), mh: m.h, ml: m.l });
    } else if (!p.conf) {
      const d = m.c > m.o ? "LONG" : "SHORT", e = d === "LONG" ? m.h : m.l;
      sigs.push({ idx: i, ts: ins.t, dir: d, entry: +e.toFixed(2), sl: +(d === "LONG" ? e - a * p.slM : e + a * p.slM).toFixed(2), tp: +(d === "LONG" ? e + a * p.tpM : e - a * p.tpM).toFixed(2), rr: +(p.tpM / p.slM).toFixed(2), mh: m.h, ml: m.l });
    }
  }
  return sigs;
}
function backtest(candles, sigs, cap = 1e5, risk = .02) {
  let c = cap, w = 0, lo = 0, mx = cap, md = 0;
  const eq = [{ x: 0, y: c }];
  const trades = [];
  const ddCurve = [{ x: 0, y: 0 }];
  let totalProfitFromWins = 0, totalLossFromLosses = 0;

  sigs.forEach((s, i) => {
    const sd = Math.abs(s.entry - s.sl); if (!sd) return;
    const sz = Math.floor(c * risk / sd); if (!sz) return;
    let h = null, exitPrice = s.entry;
    const end = Math.min(s.idx + 10, candles.length - 1);
    for (let j = s.idx + 1; j <= end; j++) {
      const k = candles[j];
      if (s.dir === "LONG") {
        if (k.l <= s.sl) { h = "SL"; exitPrice = s.sl; break; }
        if (k.h >= s.tp) { h = "TP"; exitPrice = s.tp; break; }
      } else {
        if (k.h >= s.sl) { h = "SL"; exitPrice = s.sl; break; }
        if (k.l <= s.tp) { h = "TP"; exitPrice = s.tp; break; }
      }
    }
    if (!h) { h = Math.random() > .5 ? "TP" : "SL"; exitPrice = h === "TP" ? s.tp : s.sl; }

    const pnlAbs = s.dir === "LONG"
      ? sz * (exitPrice - s.entry)
      : sz * (s.entry - exitPrice);
    const pnlPct = +((exitPrice - s.entry) / s.entry * 100 * (s.dir === "LONG" ? 1 : -1)).toFixed(2);

    c += pnlAbs;
    h === "TP" ? (w++, totalProfitFromWins += pnlAbs) : (lo++, totalLossFromLosses += Math.abs(pnlAbs));
    mx = Math.max(mx, c);
    const curDD = -((mx - c) / mx * 100);
    md = Math.max(md, (mx - c) / mx);

    eq.push({ x: i + 1, y: +c.toFixed(2) });
    ddCurve.push({ x: i + 1, y: +curDD.toFixed(2) });

    trades.push({
      num: trades.length + 1,
      date: s.ts,
      type: s.dir === "LONG" ? "BUY" : "SELL",
      entry: s.entry,
      exit: +exitPrice.toFixed(2),
      pnlPct,
      capital: +c.toFixed(2),
      drawdown: +curDD.toFixed(2),
      result: h,
      size: sz,
      sym: s.sym || "",
    });
  });

  const tot = w + lo;
  const avgWin = w > 0 ? totalProfitFromWins / w : 0;
  const avgLoss = lo > 0 ? totalLossFromLosses / lo : 0;
  const pf = avgLoss > 0 ? +(totalProfitFromWins / totalLossFromLosses).toFixed(2) : 0;
  const expectancy = tot > 0 ? +((totalProfitFromWins - totalLossFromLosses) / tot).toFixed(2) : 0;

  // Sharpe approximation
  const rets = eq.slice(1).map((e, i) => (e.y - eq[i].y) / eq[i].y);
  const mu = rets.length ? rets.reduce((a, b) => a + b) / rets.length : 0;
  const std = rets.length ? Math.sqrt(rets.reduce((a, r) => a + (r - mu) ** 2, 0) / rets.length) : 0;
  const sharpe = std > 0 ? +(mu / std * Math.sqrt(252)).toFixed(2) : 0;

  return {
    tot, w, lo,
    wr: +(tot ? w / tot * 100 : 0).toFixed(1),
    md: +(md * 100).toFixed(1),
    ret: +((c - cap) / cap * 100).toFixed(2),
    sharpe, pf, expectancy,
    cap0: cap, capF: +c.toFixed(2),
    avgWin: +avgWin.toFixed(2), avgLoss: +avgLoss.toFixed(2),
    eq, ddCurve, trades,
  };
}

// ════════════════════════════════════════
// SVG COMPONENTS
// ════════════════════════════════════════
function Donut({ segs, size = 160, sw = 18, center }) {
  const r = (size - sw) / 2, circ = 2 * Math.PI * r, cx = size / 2; let off = 0;
  return (<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
    <circle cx={cx} cy={cx} r={r} fill="none" stroke={T.bgMid} strokeWidth={sw} />
    {segs.map((s, i) => { const d = circ * s.pct, g = circ - d, o = off; off += d; return <circle key={i} cx={cx} cy={cx} r={r} fill="none" stroke={s.color} strokeWidth={sw} strokeDasharray={`${d} ${g}`} strokeDashoffset={-o} transform={`rotate(-90 ${cx} ${cx})`} />; })}
    <text x={cx} y={cx - 8} textAnchor="middle" fill={T.grey} fontSize={9} fontFamily="Manrope" fontWeight={600} letterSpacing=".1em">TOTAL</text>
    {center && <text x={cx} y={cx + 12} textAnchor="middle" fill={T.black} fontSize={18} fontFamily="'Noto Serif'" fontWeight={700}>{center}</text>}
  </svg>);
}
function LineChart({ data, w, h, color, area = true }) {
  if (!data?.length) return null;
  const vals = data.map(d => typeof d === "number" ? d : d.y);
  const mn = Math.min(...vals), mx = Math.max(...vals), rng = mx - mn || 1;
  const pts = vals.map((v, i) => `${i / (vals.length - 1) * w},${h - 4 - (v - mn) / rng * (h - 8)}`).join(" ");
  const col = color || (vals[vals.length - 1] >= vals[0] ? T.green : T.red);
  const id = `g${w}${h}${col.replace('#','')}`;
  return (<svg width={w} height={h} style={{ display: "block" }}>
    {area && <><defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={col} stopOpacity=".12" /><stop offset="100%" stopColor={col} stopOpacity="0" /></linearGradient></defs><polygon points={`0,${h} ${pts} ${w},${h}`} fill={`url(#${id})`} /></>}
    <polyline points={pts} fill="none" stroke={col} strokeWidth={1.5} />
  </svg>);
}
function CandleChart({ candles, signals = [], w = 700, h = 280 }) {
  const disp = candles.slice(-100);
  const mn = Math.min(...disp.map(c => c.l)) * .999, mx = Math.max(...disp.map(c => c.h)) * 1.001, rng = mx - mn;
  const bw = Math.max(3, (w - 40) / disp.length - 1);
  const toY = p => h - 20 - ((p - mn) / rng) * (h - 40);
  const si = candles.length - 100;
  return (<svg width={w} height={h} style={{ display: "block", background: T.white, borderRadius: 2 }}>
    {[.25, .5, .75].map(f => { const y = 20 + f * (h - 40), p = mx - f * rng; return <g key={f}><line x1={40} y1={y} x2={w} y2={y} stroke={T.ghost} /><text x={4} y={y + 3} fill={T.muted} fontSize={9} fontFamily="Manrope">${p.toFixed(0)}</text></g>; })}
    {disp.map((c, i) => {
      const x = 40 + i * (bw + 1), bull = c.c >= c.o, col = bull ? T.green : T.red;
      const top = toY(Math.max(c.o, c.c)), bot = toY(Math.min(c.o, c.c));
      const isSig = signals.some(s => s.idx === si + i);
      return (<g key={i}><line x1={x + bw / 2} y1={toY(c.h)} x2={x + bw / 2} y2={toY(c.l)} stroke={col} strokeWidth={1} /><rect x={x} y={top} width={bw} height={Math.max(1, bot - top)} fill={col} />{isSig && <><circle cx={x + bw / 2} cy={toY(c.h) - 10} r={5} fill={T.gold} /><text x={x + bw / 2} y={toY(c.h) - 7} textAnchor="middle" fill={T.darker} fontSize={7} fontWeight={700}>IB</text></>}</g>);
    })}
  </svg>);
}

// ════════════════════════════════════════
// STYLES
// ════════════════════════════════════════
const fonts = `@import url('https://fonts.googleapis.com/css2?family=Noto+Serif:ital,wght@0,400;0,700;1,400&family=Manrope:wght@400;500;600;700;800&display=swap');`;
const X = {
  serif: { fontFamily: "'Noto Serif',Georgia,serif" }, sans: { fontFamily: "'Manrope',system-ui,sans-serif" },
  card: { background: T.white, borderRadius: 2, padding: 24 },
  lbl: { fontSize: 10, fontWeight: 600, letterSpacing: ".1em", textTransform: "uppercase", color: T.grey },
  bp: { background: T.darker, color: T.white, border: "none", borderRadius: 2, padding: "10px 20px", fontSize: 12, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", cursor: "pointer", fontFamily: "'Manrope'" },
  bg: { background: T.gold, color: T.darker, border: "none", borderRadius: 2, padding: "10px 20px", fontSize: 12, fontWeight: 700, letterSpacing: ".04em", cursor: "pointer", fontFamily: "'Manrope'" },
  bo: { background: "transparent", color: T.black, border: `1.5px solid ${T.bgHigh}`, borderRadius: 2, padding: "8px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'Manrope'" },
  inp: { background: T.white, border: "none", borderBottom: `1.5px solid ${T.bgHigh}`, color: T.black, padding: "8px 0", fontSize: 14, fontFamily: "'Manrope'", width: "100%", outline: "none" },
  chip: a => ({ background: a ? T.darker : T.bgLow, color: a ? T.white : T.black, border: "none", borderRadius: 2, padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'Manrope'" }),
  chipS: a => ({ background: a ? T.darker : "transparent", color: a ? T.white : T.grey, border: a ? "none" : `1px solid ${T.bgHigh}`, borderRadius: 2, padding: "5px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "'Manrope'" }),
  tag: { background: T.bgLow, color: T.black, borderRadius: 2, padding: "5px 10px", fontSize: 12, fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "'Manrope'" },
  badge: d => ({ background: d === "LONG" ? T.greenBg : d === "SHORT" ? T.redBg : T.bgLow, color: d === "LONG" ? T.green : d === "SHORT" ? T.red : T.grey, borderRadius: 2, padding: "3px 8px", fontSize: 10, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase" }),
};
const NAV = [{ id: "dashboard", l: "Dashboard", ic: "◈" }, { id: "trading", l: "Inside Bar", ic: "↗" }, { id: "backtesting", l: "Backtesting", ic: "⟳" }, { id: "comparator", l: "Comparador", ic: "⚖" }, { id: "portfolio", l: "Portfolio", ic: "◎" }, { id: "settings", l: "Configuración", ic: "⚙" }];

// ════════════════════════════════════════
// APP
// ════════════════════════════════════════
export default function GNZTrading() {
  const [tab, setTab] = useState("dashboard");
  const [keys, setKeys] = useState({ aK: "PKFC6PK2O2XWQ3RQWDIZOO6VR4", aS: "EzvC6YTWBphTZvvYS57cBL44YEquxfQWNq6NCm4nPdJa", aiK: "" });

  // Connection state
  const client = useRef(null);
  const [conn, setConn] = useState(false);
  const [proxyOk, setProxyOk] = useState(false);
  const [connErr, setConnErr] = useState(null);
  const [acct, setAcct] = useState(null);
  const [livePos, setLivePos] = useState([]);
  const [liveOrders, setLiveOrders] = useState([]);
  const [simPos] = useState(() => simPositions());

  // Use live data if connected, otherwise simulated
  const pos = conn && livePos.length > 0 ? livePos : simPos;

  // Strategy
  const [par, setPar] = useState({ syms: ["AAPL", "TSLA", "NVDA"], tf: "1Day", atrP: 14, slM: 1.5, tpM: 3, volF: true, conf: true, minB: .5, risk: 2 });
  const [nSym, setNSym] = useState("");
  const [scanning, setScanning] = useState(false);
  const [trigs, setTrigs] = useState([]);
  const [scanN, setScanN] = useState(0);
  const [bt, setBt] = useState(null);
  const [chart, setChart] = useState({ candles: [], signals: [] });
  const [liveSigs, setLiveSigs] = useState([]);
  const [feedback, setFb] = useState({});

  // Comparator, AI, UI
  const [scenarios, setScens] = useState([]);
  const [cSym, setCSym] = useState("AAPL");
  // Backtesting dedicated
  const [btSym, setBtSym] = useState("AAPL");
  const [btTf, setBtTf] = useState("1Day");
  const [btCap, setBtCap] = useState(100000);
  const [btRisk, setBtRisk] = useState(2);
  const [btBars, setBtBars] = useState(365);
  const [btStart, setBtStart] = useState("2024-01-01");
  const [btEnd, setBtEnd] = useState(new Date().toISOString().split("T")[0]);
  const [btPeriodMode, setBtPeriodMode] = useState("dates"); // "dates" | "bars"
  const [btFull, setBtFull] = useState(null);
  const [btRunning, setBtRunning] = useState(false);
  const [btDataSource, setBtDataSource] = useState(null); // "alpaca" | "simulated"
  const [btError, setBtError] = useState(null);
  const [aiMsgs, setAiMsgs] = useState([]);
  const [aiLoad, setAiLoad] = useState(false);
  const [pTab, setPTab] = useState("Todos");
  const [showK1, setSK1] = useState(false);
  const [showK2, setSK2] = useState(false);
  const [togs, setTogs] = useState({ te: true, mg: true, wk: false });

  // ─── Connect to Alpaca via proxy ───
  const connect = useCallback(async () => {
    setConnErr(null);
    // 1. Check if proxy is running
    try {
      const health = await fetch(`${PROXY}/health`, { signal: AbortSignal.timeout(2000) });
      if (health.ok) {
        setProxyOk(true);
        // 2. Try to get account
        const c = new Alpaca(keys.aK, keys.aS);
        const acc = await c.account();
        client.current = c;
        setAcct(acc);
        setConn(true);

        // 3. Fetch positions
        try {
          const p = await c.positions();
          setLivePos(p.map(x => ({ sym: x.symbol, name: nameOf(x.symbol), cat: catOf(x.symbol), qty: +x.qty, entry: +x.avg_entry_price, price: +x.current_price, mv: +x.market_value, pl: +x.unrealized_pl, plP: +(+x.unrealized_plpc * 100).toFixed(2) })));
        } catch { setLivePos([]); }

        // 4. Fetch orders
        try {
          const o = await c.orders("all", 15);
          setLiveOrders(o.map(x => ({ id: x.id, sym: x.symbol, side: x.side, qty: +x.qty || +x.filled_qty, status: x.status, at: x.created_at })));
        } catch {}

        return;
      }
    } catch {}

    setProxyOk(false);
    setConn(false);
    setConnErr("Proxy no detectado. Ejecuta: node server.js");
  }, [keys.aK, keys.aS]);

  useEffect(() => { connect(); }, [connect]);

  // ─── Execute trade via proxy ───
  const execTrade = useCallback(async (trig) => {
    if (!client.current) { setFb(p => ({ ...p, [trig.id]: { ok: false, m: "Sin conexión al proxy" } })); return; }
    try {
      const side = trig.dir === "LONG" ? "buy" : "sell";
      const bp = acct ? +acct.buying_power : 1e5;
      const sd = Math.abs(trig.entry - trig.sl);
      let qty = sd > 0 ? Math.floor(bp * (par.risk / 100) / sd) : 1;
      qty = Math.max(1, Math.min(qty, 100));
      let order;
      try {
        order = await client.current.order({ symbol: trig.sym, qty: String(qty), side, type: "limit", time_in_force: "day", limit_price: String(trig.entry), order_class: "bracket", stop_loss: { stop_price: String(trig.sl) }, take_profit: { limit_price: String(trig.tp) } });
      } catch {
        order = await client.current.order({ symbol: trig.sym, qty: String(qty), side, type: "market", time_in_force: "day" });
      }
      setFb(p => ({ ...p, [trig.id]: { ok: true, m: `✓ ${side.toUpperCase()} ${qty} ${trig.sym} — Order ${order.id?.slice(0, 8)}` } }));
      // Refresh positions
      setTimeout(async () => { try { const p = await client.current.positions(); setLivePos(p.map(x => ({ sym: x.symbol, name: nameOf(x.symbol), cat: catOf(x.symbol), qty: +x.qty, entry: +x.avg_entry_price, price: +x.current_price, mv: +x.market_value, pl: +x.unrealized_pl, plP: +(+x.unrealized_plpc * 100).toFixed(2) }))); } catch {} }, 2000);
    } catch (e) { setFb(p => ({ ...p, [trig.id]: { ok: false, m: `Error: ${e.message.slice(0, 80)}` } })); }
  }, [acct, par.risk]);

  const act = async (id, action) => {
    setTrigs(p => p.map(t => t.id === id ? { ...t, status: action } : t));
    if (action === "APPROVED") { const t = trigs.find(x => x.id === id); if (t) await execTrade(t); }
  };

  // ─── Scanner ───
  const scan = useCallback(async () => {
    setScanning(true); setScanN(0);
    const lv = [], tg = [];
    let n = 0; const iv = setInterval(() => { n += Math.floor(Math.random() * 8 + 3); setScanN(n); if (n > 140) clearInterval(iv); }, 200);
    let lastC = [], lastS = [];
    for (const sym of par.syms) {
      let candles;
      if (client.current) { try { const d = await client.current.bars(sym, par.tf, 200); if (d.bars?.length > 10) candles = d.bars.map(b => ({ t: b.t, o: +b.o, h: +b.h, l: +b.l, c: +b.c, v: +b.v })); } catch {} }
      if (!candles) candles = simCandles(sym, 200, par.tf);
      const sigs = detectIB(candles, par);
      if (sigs.length) { const ls = sigs[sigs.length - 1]; lv.push({ sym, tf: par.tf, high: ls.mh, low: ls.ml, entry: ls.entry, cnt: sigs.length }); }
      sigs.slice(-3).forEach(s => tg.push({ id: Date.now() + Math.random(), sym, dir: s.dir, entry: s.entry, sl: s.sl, tp: s.tp, rr: s.rr, tf: par.tf, type: s.dir === "LONG" ? "Ruptura Superior" : "Ruptura Inferior", ago: `Hace ${Math.floor(Math.random() * 45 + 2)} min`, status: "PENDING" }));
      setBt(backtest(candles, sigs, acct ? +acct.equity : 1e5, par.risk / 100));
      lastC = candles; lastS = sigs;
    }
    clearInterval(iv); setScanN(142);
    setChart({ candles: lastC, signals: lastS }); setLiveSigs(lv); setTrigs(tg);
  }, [par, acct]);

  const rmSym = s => setPar(p => ({ ...p, syms: p.syms.filter(x => x !== s) }));
  const addSym = () => { if (nSym && !par.syms.includes(nSym.toUpperCase())) { setPar(p => ({ ...p, syms: [...p.syms, nSym.toUpperCase()] })); setNSym(""); } };

  // ─── AI ───
  const getAI = async () => {
    setAiLoad(true);
    if (keys.aiK) {
      try {
        const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content: `Eres asesor de inversiones. Portafolio: ${pos.map(p => `${p.sym}(${p.cat}):${p.qty}@$${p.price}`).join(";")}. Equity: $${stats.total.toLocaleString()}. Targets: ETFs 40%, Crecimiento 30%, Poder 30%. Da 3 sugerencias concretas en español.` }] }) });
        const d = await r.json(); setAiMsgs(p => [...p, { text: d.content?.map(c => c.text || "").join("") || "Error", ts: new Date() }]);
      } catch { setAiMsgs(p => [...p, { text: mockAI(), ts: new Date() }]); }
    } else { setAiMsgs(p => [...p, { text: mockAI(), ts: new Date() }]); }
    setAiLoad(false);
  };
  function mockAI() {
    const ep = (stats.alloc.find(a => a.k === "ETF")?.pct * 100 || 0).toFixed(0);
    const worst = [...pos].sort((a, b) => a.plP - b.plP)[0];
    return `📊 Análisis — ${new Date().toLocaleDateString("es-MX")}\n\nETFs ${ep}% | Crecimiento ${(stats.alloc.find(a => a.k === "GROWTH")?.pct * 100 || 0).toFixed(0)}% | Poder ${(stats.alloc.find(a => a.k === "POWER")?.pct * 100 || 0).toFixed(0)}%\n\n1. ${+ep < 40 ? `Incrementar ETFs (+${(40 - +ep).toFixed(0)}%). Agregar VTI.` : "ETFs ok."}\n2. Revisar ${worst?.sym} (${worst?.plP}%).\n3. Diversificar Power en 3-4 posiciones.\n\n⚠️ Conecta API Anthropic para análisis real.`;
  }

  // ─── Dedicated Backtesting ───
  const runFullBacktest = useCallback(async () => {
    setBtRunning(true);
    setBtError(null);
    setBtDataSource(null);
    let candles = null;
    let dataSource = "simulated";

    // ── Try Alpaca real data via proxy ──
    if (client.current) {
      try {
        console.log(`[Backtest] Fetching real data for ${btSym} ${btTf}...`);
        let d;
        if (btPeriodMode === "dates") {
          d = await client.current.bars(btSym, btTf, 10000, btStart, btEnd);
        } else {
          d = await client.current.bars(btSym, btTf, btBars);
        }

        console.log(`[Backtest] Alpaca response:`, d);

        if (d.bars && d.bars.length > 0) {
          candles = d.bars.map(b => ({ t: b.t, o: +b.o, h: +b.h, l: +b.l, c: +b.c, v: +b.v }));
          dataSource = "alpaca";
          console.log(`[Backtest] ✓ Got ${candles.length} real bars from Alpaca`);
        } else {
          console.warn(`[Backtest] Alpaca returned empty bars array`);
          setBtError(`Alpaca no devolvió datos para ${btSym} en ese período. Verifica el símbolo y las fechas.`);
        }
      } catch (err) {
        console.error(`[Backtest] Alpaca data error:`, err);
        setBtError(`Error obteniendo datos de Alpaca: ${err.message}. Usando datos simulados como fallback.`);
      }
    } else {
      // No proxy/client - check if proxy is running
      try {
        const health = await fetch(`${PROXY}/health`, { signal: AbortSignal.timeout(2000) });
        if (!health.ok) throw new Error("Proxy not responding");
        // Proxy ok but no client - try to connect
        setBtError("Proxy detectado pero sin autenticar. Ve a Settings → Reconectar.");
      } catch {
        setBtError("Proxy no detectado. Ejecuta: node server.js — Usando datos simulados.");
      }
    }

    // ── Fallback to simulated ──
    if (!candles) {
      const n = btPeriodMode === "bars"
        ? btBars
        : Math.max(60, Math.round((new Date(btEnd) - new Date(btStart)) / 864e5));
      candles = simCandles(btSym, n, btTf);
      dataSource = "simulated";
    }

    // ── Run backtest ──
    const sigs = detectIB(candles, par);
    sigs.forEach(s => s.sym = btSym);
    const result = backtest(candles, sigs, btCap, btRisk / 100);

    const startDate = candles[0]?.t ? new Date(candles[0].t).toLocaleDateString("es-MX") : btStart;
    const endDate = candles[candles.length - 1]?.t ? new Date(candles[candles.length - 1].t).toLocaleDateString("es-MX") : btEnd;

    setBtDataSource(dataSource);
    setBtFull({ ...result, symbol: btSym, timeframe: btTf, period: `${startDate} → ${endDate}`, numCandles: candles.length });
    setBtRunning(false);
  }, [btSym, btTf, btCap, btRisk, btBars, btStart, btEnd, btPeriodMode, par]);

  // ─── Comparator ───
  const compare = useCallback(async () => {
    const cfgs = [{ l: "Conservador", atrP: 14, slM: 2, tpM: 2, volF: true, conf: true, minB: .7 }, { l: "Equilibrado", atrP: 14, slM: 1.5, tpM: 3, volF: true, conf: true, minB: .5 }, { l: "Agresivo", atrP: 10, slM: 1, tpM: 4, volF: false, conf: false, minB: .3 }, { l: "Scalper", atrP: 7, slM: .8, tpM: 1.6, volF: false, conf: false, minB: .2 }];
    const byTf = [];
    for (const tf of TFS.filter(t => ["1Hour", "4Hour", "1Day", "1Week"].includes(t.v))) {
      let c; if (client.current) { try { const d = await client.current.bars(cSym, tf.v, 200); if (d.bars?.length > 10) c = d.bars.map(b => ({ t: b.t, o: +b.o, h: +b.h, l: +b.l, c: +b.c, v: +b.v })); } catch {} }
      if (!c) c = simCandles(cSym, 200, tf.v);
      const s = detectIB(c, par); byTf.push({ label: tf.l, ...backtest(c, s) });
    }
    let bc; if (client.current) { try { const d = await client.current.bars(cSym, "1Day", 200); if (d.bars?.length > 10) bc = d.bars.map(b => ({ t: b.t, o: +b.o, h: +b.h, l: +b.l, c: +b.c, v: +b.v })); } catch {} }
    if (!bc) bc = simCandles(cSym, 200, "1Day");
    const byP = cfgs.map(cfg => { const s = detectIB(bc, cfg); return { label: cfg.l, ...backtest(bc, s) }; });
    setScens([{ g: "Por Timeframe", items: byTf }, { g: "Por Parametrización", items: byP }]);
  }, [cSym, par]);

  // ─── Stats ───
  const stats = useMemo(() => {
    const total = pos.reduce((a, p) => a + p.mv, 0) || (acct ? +acct.equity : 428500);
    const pl = pos.reduce((a, p) => a + p.pl, 0);
    const ca = {}; pos.forEach(p => { ca[p.cat] = (ca[p.cat] || 0) + p.mv; });
    return { total, pl, plP: total > 0 ? pl / (total - pl || 1) * 100 : 0, alloc: Object.entries(ALLOC).map(([k, v]) => ({ k, l: v.l, c: v.c, val: ca[k] || 0, pct: total ? (ca[k] || 0) / total : 0, tgt: v.t, diff: total ? ((ca[k] || 0) / total - v.t) * 100 : 0 })) };
  }, [pos, acct]);

  const equity = acct ? +acct.equity : stats.total;
  const bp = acct ? +acct.buying_power : equity * .33;
  const pending = trigs.filter(t => t.status === "PENDING").length;
  const perfData = useMemo(() => { let v = 100; return Array.from({ length: 60 }, () => { v += (Math.random() - .42) * 2.5; return v; }); }, []);

  // ════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════
  return (
    <div style={{ display: "flex", height: "100vh", background: T.bg, ...X.sans, overflow: "hidden" }}>
      <style>{fonts}</style>

      {/* SIDEBAR */}
      <div style={{ width: 240, background: T.white, borderRight: `1px solid ${T.ghost}`, display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "24px 20px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 18, background: T.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>◈</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase" }}>GNZ Trading</div>
            <div style={{ fontSize: 9, color: conn ? T.green : T.gold, fontWeight: 600 }}>{conn ? "● Alpaca Live" : "● Paper Sim"}</div>
          </div>
        </div>
        <div style={{ flex: 1, padding: "8px 0" }}>
          {NAV.map(n => (
            <div key={n.id} onClick={() => setTab(n.id)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", cursor: "pointer", background: tab === n.id ? T.bgLow : "transparent", borderLeft: tab === n.id ? `3px solid ${T.gold}` : "3px solid transparent", color: tab === n.id ? T.black : T.grey, fontSize: 13, fontWeight: tab === n.id ? 600 : 400 }}>
              <span style={{ fontSize: 16, width: 20, textAlign: "center" }}>{n.ic}</span><span>{n.l}</span>
              {n.id === "trading" && pending > 0 && <span style={{ marginLeft: "auto", background: T.gold, color: T.darker, borderRadius: 2, padding: "1px 6px", fontSize: 9, fontWeight: 700 }}>{pending}</span>}
            </div>
          ))}
        </div>
        <div style={{ padding: "16px 20px", borderTop: `1px solid ${T.ghost}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <div style={{ width: 32, height: 32, borderRadius: 16, background: T.bgMid, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>G</div>
            <div><div style={{ fontSize: 12, fontWeight: 600 }}>Gerardo</div><div style={{ fontSize: 10, color: T.grey }}>Data Bunker</div></div>
          </div>
          <div style={{ fontSize: 10 }}>
            <span style={{ color: conn ? T.green : T.gold }}>● Alpaca</span> · <span style={{ color: keys.aiK ? T.green : T.muted }}>{keys.aiK ? "● AI" : "○ AI"}</span>
            {proxyOk && <span style={{ color: T.green }}> · ● Proxy</span>}
          </div>
        </div>
      </div>

      {/* MAIN */}
      <div style={{ flex: 1, overflow: "auto", padding: "24px 32px" }}>
        {/* Connection banner */}
        {connErr && <div style={{ marginBottom: 16, padding: "10px 16px", background: T.yellowLight, borderRadius: 2, fontSize: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span><strong style={{ color: T.primary }}>⚡ {connErr}</strong> <span style={{ color: T.grey }}>— Mientras tanto, la app funciona con datos simulados.</span></span>
          <button style={{ ...X.bo, padding: "4px 12px", fontSize: 11 }} onClick={connect}>Reintentar</button>
        </div>}
        {conn && <div style={{ marginBottom: 16, padding: "10px 16px", background: T.greenBg, borderRadius: 2, fontSize: 12, color: T.green }}>
          <strong>✓ Conectado a Alpaca Paper Trading</strong> — Equity: ${(+acct.equity).toLocaleString()} | Status: {acct.status} | Buying Power: ${(+acct.buying_power).toLocaleString()}
        </div>}

        {/* ████ DASHBOARD ████ */}
        {tab === "dashboard" && (<div>
          <div style={{ marginBottom: 24 }}>
            <div style={X.lbl}>Consolidated Portfolio Value</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 6 }}>
              <span style={{ ...X.serif, fontSize: 42, fontWeight: 700 }}>${Math.floor(equity).toLocaleString()}</span>
              <span style={{ ...X.serif, fontSize: 24, color: T.grey }}>.{((equity % 1) * 100).toFixed(0).padStart(2, "0")}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
              <span style={{ background: stats.plP >= 0 ? T.greenBg : T.redBg, color: stats.plP >= 0 ? T.green : T.red, padding: "4px 12px", borderRadius: 2, fontSize: 13, fontWeight: 600 }}>{stats.plP >= 0 ? "↑ +" : "↓ "}{stats.plP.toFixed(2)}%</span>
              <span style={{ fontSize: 13, color: T.grey }}>{stats.pl >= 0 ? "+" : ""}${stats.pl.toFixed(2)} Today</span>
              <span style={{ marginLeft: "auto", fontSize: 11, color: conn ? T.green : T.muted }}>{conn ? "Live data" : "Simulated"}</span>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 24 }}>
            {[{ l: "Equity", v: `$${(equity / 1000).toFixed(1)}k`, c: T.gold }, { l: "Buying Power", v: `$${(bp / 1000).toFixed(1)}k`, c: T.green }, { l: "Posiciones", v: pos.length, c: T.black }, { l: "Señales Pendientes", v: pending, c: T.gold }].map((s, i) => (
              <div key={i} style={{ ...X.card, borderTop: `3px solid ${s.c}` }}><div style={X.lbl}>{s.l}</div><div style={{ ...X.serif, fontSize: 26, fontWeight: 700, color: s.c, marginTop: 6 }}>{s.v}</div></div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 16, marginBottom: 24 }}>
            <div style={X.card}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}><div><div style={{ ...X.serif, fontSize: 20, fontWeight: 700 }}>Weekly <span style={{ fontStyle: "italic" }}>Performance</span></div></div></div>
              <LineChart data={perfData} w={560} h={180} color={T.black} />
            </div>
            <div style={X.card}>
              <div style={{ ...X.serif, fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Allocation</div>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}><Donut segs={stats.alloc.map(a => ({ pct: a.pct, color: a.c }))} size={150} sw={16} center={`$${(equity / 1000).toFixed(1)}k`} /></div>
              {stats.alloc.map((a, i) => (<div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0" }}><div style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ width: 10, height: 10, borderRadius: 5, background: a.c }} /><span style={{ fontSize: 13 }}>{a.l}</span></div><div style={{ display: "flex", gap: 12 }}><span style={{ fontSize: 13, fontWeight: 600 }}>{(a.pct * 100).toFixed(0)}%</span><span style={{ fontSize: 11, color: a.diff > 2 ? T.gold : a.diff < -2 ? T.red : T.green }}>({a.diff > 0 ? "+" : ""}{a.diff.toFixed(1)}%)</span></div></div>))}
            </div>
          </div>
          <div style={X.card}>
            <div style={{ ...X.serif, fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Posiciones Abiertas</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr style={{ borderBottom: `2px solid ${T.ghost}`, color: T.grey }}>{["Símbolo", "Nombre", "Cat.", "Qty", "Entrada", "Actual", "Valor", "P&L", "P&L %"].map(h => <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600, fontSize: 10, letterSpacing: ".06em", textTransform: "uppercase" }}>{h}</th>)}</tr></thead>
              <tbody>{pos.map((p, i) => (<tr key={i} style={{ borderBottom: `1px solid ${T.ghost}` }}>
                <td style={{ padding: "10px", fontWeight: 700 }}>{p.sym}</td><td style={{ padding: "10px", color: T.grey }}>{p.name}</td>
                <td style={{ padding: "10px" }}><span style={{ ...X.badge(""), background: T.bgLow }}>{p.cat}</span></td>
                <td style={{ padding: "10px" }}>{p.qty}</td><td style={{ padding: "10px" }}>${p.entry}</td><td style={{ padding: "10px", fontWeight: 600 }}>${p.price}</td>
                <td style={{ padding: "10px" }}>${p.mv.toLocaleString()}</td>
                <td style={{ padding: "10px", color: p.pl >= 0 ? T.green : T.red, fontWeight: 600 }}>{p.pl >= 0 ? "+" : ""}${p.pl.toFixed(0)}</td>
                <td style={{ padding: "10px", color: p.plP >= 0 ? T.green : T.red, fontWeight: 700 }}>{p.plP >= 0 ? "+" : ""}{p.plP}%</td>
              </tr>))}</tbody>
            </table>
          </div>
          {liveOrders.length > 0 && <div style={{ ...X.card, marginTop: 16 }}>
            <div style={{ ...X.serif, fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Últimas Órdenes (Alpaca)</div>
            {liveOrders.slice(0, 5).map((o, i) => <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: i < 4 ? `1px solid ${T.ghost}` : "none" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}><span style={X.badge(o.side === "buy" ? "LONG" : "SHORT")}>{o.side}</span><span style={{ fontWeight: 600 }}>{o.sym}</span><span style={{ color: T.grey }}>×{o.qty}</span></div>
              <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 2, background: o.status === "filled" ? T.greenBg : T.bgLow, color: o.status === "filled" ? T.green : T.grey, fontWeight: 600 }}>{o.status}</span>
            </div>)}
          </div>}
        </div>)}

        {/* ████ TRADING ████ */}
        {tab === "trading" && (<div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
            <div><div style={{ ...X.serif, fontSize: 32, fontWeight: 700 }}>Estrategia Inside <span style={{ fontStyle: "italic" }}>Bar</span></div><p style={{ fontSize: 13, color: T.grey, marginTop: 4 }}>{conn ? "📡 Datos en vivo desde Alpaca" : "Datos simulados — activa el proxy para datos reales"}</p></div>
            <button style={X.bp} onClick={scan}>{scanning ? "↻ Re-Escanear" : "▶ Ejecutar Motor"}</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16, marginBottom: 24 }}>
            <div style={X.card}>
              <div style={{ ...X.serif, fontSize: 16, fontWeight: 700, marginBottom: 16 }}>⚙ Parámetros</div>
              <div style={{ ...X.lbl, marginBottom: 6 }}>Timeframe</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 16 }}>{TFS.map(tf => <button key={tf.v} style={X.chip(par.tf === tf.v)} onClick={() => setPar(p => ({ ...p, tf: tf.v }))}>{tf.l}</button>)}</div>
              <div style={{ ...X.lbl, marginBottom: 6 }}>Activos</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 6 }}>{par.syms.map(s => <span key={s} style={X.tag}>{s} <span style={{ cursor: "pointer", color: T.grey }} onClick={() => rmSym(s)}>×</span></span>)}</div>
              <div style={{ display: "flex", gap: 6, marginBottom: 16 }}><input style={{ ...X.inp, flex: 1 }} value={nSym} onChange={e => setNSym(e.target.value.toUpperCase())} placeholder="Agregar..." onKeyDown={e => e.key === "Enter" && addSym()} /><button style={{ ...X.bo, color: T.gold, borderColor: T.gold }} onClick={addSym}>+</button></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                <div><div style={X.lbl}>SL (ATR ×)</div><input type="number" step=".1" style={X.inp} value={par.slM} onChange={e => setPar(p => ({ ...p, slM: +e.target.value }))} /></div>
                <div><div style={X.lbl}>TP (ATR ×)</div><input type="number" step=".1" style={X.inp} value={par.tpM} onChange={e => setPar(p => ({ ...p, tpM: +e.target.value }))} /></div>
                <div><div style={X.lbl}>ATR Período</div><input type="number" style={X.inp} value={par.atrP} onChange={e => setPar(p => ({ ...p, atrP: +e.target.value }))} /></div>
                <div><div style={X.lbl}>Riesgo (%)</div><input type="number" step=".5" style={X.inp} value={par.risk} onChange={e => setPar(p => ({ ...p, risk: +e.target.value }))} /></div>
              </div>
              <div style={{ display: "flex", gap: 14, marginBottom: 14 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, cursor: "pointer" }}><input type="checkbox" checked={par.volF} onChange={e => setPar(p => ({ ...p, volF: e.target.checked }))} /> Volumen</label>
                <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, cursor: "pointer" }}><input type="checkbox" checked={par.conf} onChange={e => setPar(p => ({ ...p, conf: e.target.checked }))} /> Confirmación</label>
              </div>
              <div><div style={X.lbl}>Min Bar Size (×ATR)</div><input type="number" step=".1" style={X.inp} value={par.minB} onChange={e => setPar(p => ({ ...p, minB: +e.target.value }))} /></div>
            </div>
            <div>
              {chart.candles.length > 0 ? <div style={X.card}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{par.syms[par.syms.length - 1]} — {TFS.find(t => t.v === par.tf)?.l} <span style={{ color: T.gold }}>● {chart.signals.length} Inside Bars</span></div>
                <CandleChart candles={chart.candles} signals={chart.signals} w={Math.min(650, window.innerWidth - 660)} h={260} />
              </div> : <div style={{ ...X.card, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 300, color: T.grey }}><div style={{ textAlign: "center" }}><div style={{ fontSize: 40 }}>↗</div><div style={{ fontSize: 14, marginTop: 8 }}>Presiona "Ejecutar Motor"</div></div></div>}
              {scanning && <div style={{ background: T.darker, borderRadius: 2, padding: 20, color: T.white, marginTop: 12, display: "flex", justifyContent: "space-between" }}>
                <div><span style={{ ...X.serif, fontSize: 28, fontWeight: 700, fontStyle: "italic" }}>{scanN}</span><span style={{ fontSize: 11, color: "rgba(255,255,255,.5)", marginLeft: 8 }}>análisis/min</span></div>
                <div style={{ textAlign: "right" }}><div style={{ fontWeight: 700, color: T.gold }}>Activo</div><div style={{ fontSize: 10, color: "rgba(255,255,255,.5)" }}>{conn ? "Alpaca Live" : "Simulado"}</div></div>
              </div>}
            </div>
          </div>
          {bt && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
            <div style={X.card}><div style={{ ...X.serif, fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Backtest</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>{[{ l: "Trades", v: bt.tot }, { l: "Win Rate", v: `${bt.wr}%`, c: bt.wr >= 50 ? T.green : T.red }, { l: "P.Factor", v: bt.pf, c: bt.pf >= 1.5 ? T.green : T.gold }, { l: "Max DD", v: `${bt.md}%`, c: bt.md < 15 ? T.green : T.red }, { l: "Sharpe", v: bt.sharpe, c: bt.sharpe >= 1 ? T.green : T.grey }, { l: "Return", v: `${bt.ret > 0 ? "+" : ""}${bt.ret}%`, c: bt.ret >= 0 ? T.green : T.red }].map((m, i) => <div key={i} style={{ background: T.bgLow, borderRadius: 2, padding: 12, textAlign: "center" }}><div style={X.lbl}>{m.l}</div><div style={{ ...X.serif, fontSize: 20, fontWeight: 700, color: m.c || T.black, marginTop: 4 }}>{m.v}</div></div>)}</div>
            </div>
            <div style={X.card}><div style={{ ...X.serif, fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Equity Curve</div><LineChart data={bt.eq} w={380} h={160} /></div>
          </div>}
          {trigs.length > 0 && <div>
            <div style={{ ...X.serif, fontSize: 20, fontWeight: 700, fontStyle: "italic", marginBottom: 12 }}>Disparadores</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(340px,1fr))", gap: 12 }}>
              {trigs.map(t => <div key={t.id} style={{ ...X.card, borderLeft: `4px solid ${t.dir === "LONG" ? T.green : T.red}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 2, background: t.dir === "LONG" ? T.greenBg : T.redBg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>{t.dir === "LONG" ? "↑" : "↓"}</div>
                  <div style={{ flex: 1 }}><div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontSize: 16, fontWeight: 700 }}>{t.sym}</span><span style={X.badge(t.dir)}>{t.dir === "LONG" ? "Bullish" : "Bearish"}</span></div><div style={{ fontSize: 11, color: T.grey }}>{t.type} • {t.ago}</div></div>
                </div>
                <div style={{ ...X.serif, fontSize: 24, fontWeight: 700, marginBottom: 8 }}>${t.entry}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 10 }}>
                  {[{ l: "SL", v: `$${t.sl}`, c: T.red }, { l: "TP", v: `$${t.tp}`, c: T.green }, { l: "R:R", v: `${t.rr}x`, c: T.gold }].map((m, j) => <div key={j} style={{ textAlign: "center", padding: 8, background: T.bgLow, borderRadius: 2 }}><div style={{ ...X.lbl, fontSize: 9 }}>{m.l}</div><div style={{ fontSize: 14, fontWeight: 700, color: m.c }}>{m.v}</div></div>)}
                </div>
                {t.status === "PENDING" ? <div style={{ display: "flex", gap: 8 }}>
                  <button style={{ ...X.bp, flex: 1, background: T.green }} onClick={() => act(t.id, "APPROVED")}>{conn ? "⚡ Ejecutar en Alpaca" : "✓ Aprobar"}</button>
                  <button style={{ ...X.bo, flex: 1 }} onClick={() => act(t.id, "REJECTED")}>Ignorar</button>
                </div> : <div>
                  <div style={{ textAlign: "center", padding: 10, borderRadius: 2, background: t.status === "APPROVED" ? T.greenBg : T.redBg, color: t.status === "APPROVED" ? T.green : T.red, fontSize: 12, fontWeight: 700 }}>{t.status === "APPROVED" ? "✓ Trade Aprobado" : "✗ Ignorado"}</div>
                  {feedback[t.id] && <div style={{ marginTop: 6, padding: 8, borderRadius: 2, background: feedback[t.id].ok ? T.greenBg : T.redBg, fontSize: 11, color: feedback[t.id].ok ? T.green : T.red }}>{feedback[t.id].m}</div>}
                </div>}
              </div>)}
            </div>
          </div>}
        </div>)}

        {/* ████ BACKTESTING ████ */}
        {tab === "backtesting" && (<div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
            <div>
              <div style={{ ...X.serif, fontSize: 32, fontWeight: 700 }}>Backtesting <span style={{ fontStyle: "italic" }}>Engine</span></div>
              <p style={{ fontSize: 13, color: T.grey, marginTop: 4 }}>Simulación histórica de la estrategia Inside Bar{conn ? " con datos reales" : ""}</p>
            </div>
          </div>

          {/* Config Bar */}
          <div style={{ ...X.card, marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
              <div style={{ minWidth: 100 }}>
                <div style={X.lbl}>Símbolo</div>
                <input style={X.inp} value={btSym} onChange={e => setBtSym(e.target.value.toUpperCase())} />
              </div>
              <div style={{ minWidth: 140 }}>
                <div style={X.lbl}>Timeframe</div>
                <div style={{ display: "flex", gap: 3, marginTop: 4 }}>
                  {TFS.map(tf => <button key={tf.v} style={{ ...X.chip(btTf === tf.v), padding: "6px 10px", fontSize: 11 }} onClick={() => setBtTf(tf.v)}>{tf.l}</button>)}
                </div>
              </div>
              <div style={{ minWidth: 100 }}>
                <div style={X.lbl}>Capital Inicial</div>
                <input type="number" style={X.inp} value={btCap} onChange={e => setBtCap(+e.target.value)} />
              </div>
              <div style={{ minWidth: 80 }}>
                <div style={X.lbl}>Riesgo (%)</div>
                <input type="number" step=".5" style={X.inp} value={btRisk} onChange={e => setBtRisk(+e.target.value)} />
              </div>
            </div>

            {/* Period Controls */}
            <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap", padding: "16px 0 0", borderTop: `1px solid ${T.ghost}` }}>
              <div>
                <div style={X.lbl}>Período</div>
                <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                  <button style={X.chip(btPeriodMode === "dates")} onClick={() => setBtPeriodMode("dates")}>Por Fechas</button>
                  <button style={X.chip(btPeriodMode === "bars")} onClick={() => setBtPeriodMode("bars")}>Por # Barras</button>
                </div>
              </div>
              {btPeriodMode === "dates" ? (
                <>
                  <div style={{ minWidth: 130 }}>
                    <div style={X.lbl}>Fecha Inicio</div>
                    <input type="date" style={{ ...X.inp, fontSize: 13 }} value={btStart} onChange={e => setBtStart(e.target.value)} />
                  </div>
                  <div style={{ minWidth: 130 }}>
                    <div style={X.lbl}>Fecha Fin</div>
                    <input type="date" style={{ ...X.inp, fontSize: 13 }} value={btEnd} onChange={e => setBtEnd(e.target.value)} />
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    {[
                      { l: "3M", d: 90 }, { l: "6M", d: 180 }, { l: "1A", d: 365 }, { l: "2A", d: 730 }, { l: "YTD", d: "ytd" },
                    ].map(p => (
                      <button key={p.l} style={{ ...X.chipS(false), fontSize: 10, padding: "5px 8px" }} onClick={() => {
                        const end = new Date();
                        const start = p.d === "ytd" ? new Date(end.getFullYear(), 0, 1) : new Date(Date.now() - (p.d * 864e5));
                        setBtStart(start.toISOString().split("T")[0]);
                        setBtEnd(end.toISOString().split("T")[0]);
                      }}>{p.l}</button>
                    ))}
                  </div>
                </>
              ) : (
                <div style={{ minWidth: 120 }}>
                  <div style={X.lbl}># de Barras</div>
                  <input type="number" style={X.inp} value={btBars} onChange={e => setBtBars(+e.target.value)} />
                  <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>
                    ≈ {btTf === "1Day" ? `${Math.round(btBars / 252 * 10) / 10} años` : btTf === "1Week" ? `${Math.round(btBars / 52 * 10) / 10} años` : btTf === "1Hour" ? `${Math.round(btBars / 6.5 / 252 * 10) / 10} años` : `${btBars} barras`}
                  </div>
                </div>
              )}
              <button style={{ ...X.bp, padding: "10px 28px" }} onClick={runFullBacktest} disabled={btRunning}>
                {btRunning ? "⏳ Ejecutando..." : "▶ Ejecutar Backtest"}
              </button>
            </div>
          </div>

          {/* Results */}
          {/* Error / Status Banner */}
          {btError && (
            <div style={{ padding: "12px 16px", background: T.yellowLight, borderRadius: 2, marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 16 }}>⚠️</span>
              <span style={{ fontSize: 12, color: T.primary, flex: 1 }}>{btError}</span>
              {!conn && <button style={{ ...X.bo, padding: "4px 12px", fontSize: 11 }} onClick={connect}>Reconectar</button>}
            </div>
          )}

          {btDataSource && btFull && (
            <div style={{ padding: "10px 16px", background: btDataSource === "alpaca" ? T.greenBg : T.bgLow, borderRadius: 2, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: btDataSource === "alpaca" ? T.green : T.gold }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: btDataSource === "alpaca" ? T.green : T.primary }}>
                {btDataSource === "alpaca" ? `Datos reales de Alpaca — ${btFull.numCandles} barras históricas` : `Datos simulados — ${btFull.numCandles} barras generadas`}
              </span>
              {btDataSource === "simulated" && <span style={{ fontSize: 11, color: T.muted, marginLeft: "auto" }}>Activa el proxy para datos reales</span>}
            </div>
          )}

          {!btFull && !btRunning && (
            <div style={{ ...X.card, textAlign: "center", padding: 80, color: T.grey }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>⟳</div>
              <div style={{ ...X.serif, fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Configura y ejecuta un backtest</div>
              <div style={{ fontSize: 13 }}>Elige símbolo, timeframe, período, capital y riesgo</div>
              <div style={{ fontSize: 12, marginTop: 8, color: T.muted }}>Los parámetros de la estrategia Inside Bar se toman de la pestaña "Inside Bar"</div>
              <div style={{ marginTop: 16, padding: "10px 16px", background: conn ? T.greenBg : T.yellowLight, borderRadius: 2, display: "inline-block", fontSize: 12 }}>
                {conn ? <span style={{ color: T.green }}>✓ Proxy activo — usará datos reales de Alpaca</span> : <span style={{ color: T.primary }}>⚡ Sin proxy — usará datos simulados. Ejecuta <code style={{ background: T.bgLow, padding: "1px 4px" }}>node server.js</code></span>}
              </div>
            </div>
          )}

          {btFull && (<div>
            {/* Summary Metrics */}
            <div style={{ ...X.card, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div>
                  <div style={{ ...X.serif, fontSize: 20, fontWeight: 700 }}>Resumen — <span style={{ color: T.gold }}>{btFull.symbol}</span> <span style={{ fontWeight: 400, fontSize: 14, color: T.grey }}>{TFS.find(t => t.v === btFull.timeframe)?.l}</span></div>
                  <div style={{ fontSize: 12, color: T.grey, marginTop: 2 }}>{btFull.period} · {btFull.numCandles} velas analizadas</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 4, background: btDataSource === "alpaca" ? T.green : T.gold }} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: btDataSource === "alpaca" ? T.green : T.primary }}>
                    {btDataSource === "alpaca" ? "Datos Alpaca" : "Datos Simulados"}
                  </span>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                {[
                  { l: "Capital Inicial", v: `$${btFull.cap0.toLocaleString()}`, c: T.black },
                  { l: "Capital Final", v: `$${btFull.capF.toLocaleString()}`, c: btFull.capF >= btFull.cap0 ? T.green : T.red },
                  { l: "Retorno %", v: `${btFull.ret > 0 ? "+" : ""}${btFull.ret}%`, c: btFull.ret >= 0 ? T.green : T.red },
                  { l: "Win Rate %", v: `${btFull.wr}%`, c: btFull.wr >= 50 ? T.green : T.red },
                  { l: "Trades", v: btFull.tot, c: T.black },
                  { l: "Wins / Losses", v: `${btFull.w} / ${btFull.lo}`, c: T.black },
                  { l: "Profit Factor", v: btFull.pf, c: btFull.pf >= 1.5 ? T.green : btFull.pf >= 1 ? T.gold : T.red },
                  { l: "Sharpe Ratio", v: btFull.sharpe, c: btFull.sharpe >= 1 ? T.green : T.grey },
                  { l: "Max Drawdown", v: `${btFull.md}%`, c: btFull.md < 10 ? T.green : btFull.md < 20 ? T.gold : T.red },
                  { l: "Avg Win", v: `$${btFull.avgWin.toLocaleString()}`, c: T.green },
                  { l: "Avg Loss", v: `$${btFull.avgLoss.toLocaleString()}`, c: T.red },
                  { l: "Expectancy", v: `$${btFull.expectancy.toLocaleString()}`, c: btFull.expectancy >= 0 ? T.green : T.red },
                ].map((m, i) => (
                  <div key={i} style={{ background: T.bgLow, borderRadius: 2, padding: "14px 16px" }}>
                    <div style={{ ...X.lbl, fontSize: 9 }}>{m.l}</div>
                    <div style={{ ...X.serif, fontSize: 22, fontWeight: 700, color: m.c, marginTop: 4 }}>{m.v}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Equity Curve + Drawdown */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
              <div style={X.card}>
                <div style={{ ...X.serif, fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Equity Curve</div>
                <LineChart data={btFull.eq} w={440} h={180} color={btFull.ret >= 0 ? T.green : T.red} />
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 11, color: T.grey }}>
                  <span>Inicio: ${btFull.cap0.toLocaleString()}</span>
                  <span style={{ color: btFull.capF >= btFull.cap0 ? T.green : T.red, fontWeight: 600 }}>Final: ${btFull.capF.toLocaleString()}</span>
                </div>
              </div>
              <div style={X.card}>
                <div style={{ ...X.serif, fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Drawdown %</div>
                <LineChart data={btFull.ddCurve} w={440} h={180} color={T.red} area={true} />
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 11, color: T.grey }}>
                  <span>Max: <span style={{ color: T.red, fontWeight: 600 }}>{btFull.md}%</span></span>
                  <span>{btFull.tot} trades analizados</span>
                </div>
              </div>
            </div>

            {/* Win/Loss distribution bar */}
            <div style={{ ...X.card, marginBottom: 16 }}>
              <div style={{ ...X.serif, fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Distribución de Resultados</div>
              <div style={{ display: "flex", borderRadius: 2, overflow: "hidden", height: 28 }}>
                <div style={{ width: `${btFull.wr}%`, background: T.green, display: "flex", alignItems: "center", justifyContent: "center", color: T.white, fontSize: 11, fontWeight: 700, minWidth: btFull.wr > 10 ? "auto" : 30 }}>
                  {btFull.w} Wins ({btFull.wr}%)
                </div>
                <div style={{ flex: 1, background: T.red, display: "flex", alignItems: "center", justifyContent: "center", color: T.white, fontSize: 11, fontWeight: 700 }}>
                  {btFull.lo} Losses ({(100 - btFull.wr).toFixed(1)}%)
                </div>
              </div>
            </div>

            {/* Full Trade Log */}
            <div style={X.card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ ...X.serif, fontSize: 18, fontWeight: 700 }}>Historial de <span style={{ fontStyle: "italic" }}>Trades</span></div>
                <span style={{ fontSize: 11, color: T.grey }}>{btFull.trades.length} operaciones</span>
              </div>
              <div style={{ maxHeight: 500, overflow: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: `2px solid ${T.ghost}`, color: T.grey, position: "sticky", top: 0, background: T.white }}>
                      {["#", "Fecha", "Tipo", "Entrada", "Salida", "PnL %", "Capital", "Drawdown %"].map(h => (
                        <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontWeight: 700, fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {btFull.trades.map((t, i) => (
                      <tr key={i} style={{ borderBottom: `1px solid ${T.ghost}`, background: t.result === "TP" ? "rgba(45,122,58,.03)" : "rgba(198,40,40,.03)" }}>
                        <td style={{ padding: "7px 10px", color: T.muted }}>{t.num}</td>
                        <td style={{ padding: "7px 10px", fontSize: 11 }}>{new Date(t.date).toLocaleString("es-MX", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                        <td style={{ padding: "7px 10px" }}>
                          <span style={{ ...X.badge(t.type === "BUY" ? "LONG" : "SHORT"), fontSize: 9 }}>{t.type}</span>
                        </td>
                        <td style={{ padding: "7px 10px", fontWeight: 600 }}>${t.entry}</td>
                        <td style={{ padding: "7px 10px", fontWeight: 600 }}>${t.exit}</td>
                        <td style={{ padding: "7px 10px", fontWeight: 700, color: t.pnlPct >= 0 ? T.green : T.red }}>
                          {t.pnlPct >= 0 ? "+" : ""}{t.pnlPct}%
                        </td>
                        <td style={{ padding: "7px 10px", fontWeight: 600 }}>${t.capital.toLocaleString()}</td>
                        <td style={{ padding: "7px 10px", color: t.drawdown < -5 ? T.red : t.drawdown < 0 ? T.gold : T.green, fontWeight: 600 }}>
                          {t.drawdown.toFixed(2)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>)}
        </div>)}

        {/* ████ COMPARATOR ████ */}
        {tab === "comparator" && (<div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
            <div><div style={{ ...X.serif, fontSize: 32, fontWeight: 700 }}>Comparador de <span style={{ fontStyle: "italic" }}>Escenarios</span></div></div>
            <div style={{ display: "flex", gap: 8 }}><input style={{ ...X.inp, width: 100 }} value={cSym} onChange={e => setCSym(e.target.value.toUpperCase())} /><button style={X.bg} onClick={compare}>⚡ Comparar</button></div>
          </div>
          {!scenarios.length && <div style={{ ...X.card, textAlign: "center", padding: 60, color: T.grey }}><div style={{ fontSize: 48, marginBottom: 12 }}>⚖</div><div>Elige un símbolo y compara</div></div>}
          {scenarios.map((g, gi) => <div key={gi} style={{ marginBottom: 32 }}>
            <div style={{ ...X.lbl, marginBottom: 12 }}>{g.g}</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}><thead><tr style={{ borderBottom: `2px solid ${T.ghost}`, color: T.grey }}>{["Escenario", "Trades", "Win Rate", "Sharpe", "Max DD", "Return", "Equity"].map(h => <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, fontSize: 10, textTransform: "uppercase" }}>{h}</th>)}</tr></thead>
              <tbody>{g.items.map((it, i) => { const best = g.items.reduce((a, b) => b.ret > a.ret ? b : a); return <tr key={i} style={{ borderBottom: `1px solid ${T.ghost}`, background: it === best ? "rgba(197,160,33,.05)" : "transparent" }}>
                <td style={{ padding: "10px 12px", fontWeight: 700 }}>{it === best && "★ "}{it.label}</td><td style={{ padding: "10px 12px" }}>{it.tot}</td>
                <td style={{ padding: "10px 12px", color: it.wr >= 50 ? T.green : T.red, fontWeight: 600 }}>{it.wr}%</td><td style={{ padding: "10px 12px" }}>{it.sharpe}</td>
                <td style={{ padding: "10px 12px", color: it.md < 15 ? T.green : T.red }}>{it.md}%</td>
                <td style={{ padding: "10px 12px", fontWeight: 700, color: it.ret >= 0 ? T.green : T.red }}>{it.ret > 0 ? "+" : ""}{it.ret}%</td>
                <td style={{ padding: "10px 12px" }}><LineChart data={it.eq} w={180} h={40} area={false} /></td>
              </tr>; })}</tbody></table>
          </div>)}
        </div>)}

        {/* ████ PORTFOLIO ████ */}
        {tab === "portfolio" && (<div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
            <div><div style={{ ...X.serif, fontSize: 32, fontWeight: 700 }}>Distribución de <span style={{ fontStyle: "italic" }}>Portafolio</span></div></div>
            <button style={X.bg} onClick={getAI} disabled={aiLoad}>{aiLoad ? "Analizando..." : "🤖 Plan de Recalibración"}</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 24 }}>
            <div style={X.card}>
              <div style={{ ...X.serif, fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Estado Actual</div>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}><Donut segs={stats.alloc.map(a => ({ pct: a.pct, color: a.c }))} size={160} sw={18} center={`$${(equity / 1000).toFixed(1)}k`} /></div>
              {stats.alloc.map((a, i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}><div style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 8, height: 8, borderRadius: 4, background: a.c }} /><span style={{ fontSize: 13 }}>{a.l}</span></div><span style={{ fontSize: 13, fontWeight: 700 }}>{(a.pct * 100).toFixed(0)}%</span></div>)}
            </div>
            <div style={X.card}>
              <div style={{ ...X.serif, fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Objetivo</div>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}><Donut segs={[{ pct: .4, color: T.gold }, { pct: .3, color: T.darker }, { pct: .3, color: T.bgHigh }]} size={160} sw={18} /></div>
              {[{ l: "ETFs", v: "40%", c: T.gold }, { l: "Crecimiento", v: "30%" }, { l: "Poder", v: "30%" }].map((o, i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}><span style={{ fontSize: 13 }}>{o.l}</span><span style={{ fontSize: 13, fontWeight: 700, color: o.c || T.black }}>{o.v}</span></div>)}
            </div>
            <div style={{ ...X.card, background: T.bg }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}><div style={{ width: 28, height: 28, borderRadius: 2, background: T.bgHigh, display: "flex", alignItems: "center", justifyContent: "center" }}>◎</div><div><div style={{ ...X.serif, fontSize: 14, fontWeight: 700 }}>Sugerencias IA</div><div style={{ fontSize: 9, color: T.gold, fontWeight: 600 }}>Anthropic Claude</div></div></div>
              {aiMsgs.length ? <div style={{ fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap", maxHeight: 260, overflow: "auto" }}>{aiMsgs[aiMsgs.length - 1].text}</div> : <p style={{ fontSize: 12, color: T.grey }}>Presiona "Plan de Recalibración".</p>}
            </div>
          </div>
          <div style={X.card}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{ ...X.serif, fontSize: 18, fontWeight: 700 }}>Activos y <span style={{ fontStyle: "italic" }}>Pesos</span></div>
              <div style={{ display: "flex", gap: 4 }}>{["Todos", "ETFs", "Crecimiento", "Poder"].map(t => <button key={t} style={X.chipS(pTab === t)} onClick={() => setPTab(t)}>{t}</button>)}</div>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr style={{ borderBottom: `2px solid ${T.ghost}`, color: T.grey }}>{["Activo", "Cat.", "Qty", "Precio", "Valor", "P&L %", "Peso"].map(h => <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600, fontSize: 10, textTransform: "uppercase" }}>{h}</th>)}</tr></thead>
              <tbody>{pos.filter(p => pTab === "Todos" || (pTab === "ETFs" && p.cat === "ETF") || (pTab === "Crecimiento" && p.cat === "GROWTH") || (pTab === "Poder" && p.cat === "POWER")).map((p, i) => <tr key={i} style={{ borderBottom: `1px solid ${T.ghost}` }}>
                <td style={{ padding: "10px" }}><div style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ width: 28, height: 28, borderRadius: 14, background: T.bgLow, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700 }}>{p.sym[0]}</div><div><div style={{ fontWeight: 600 }}>{p.name}</div><div style={{ fontSize: 11, color: T.grey }}>{p.sym}</div></div></div></td>
                <td style={{ padding: "10px" }}><span style={X.badge("")}>{p.cat}</span></td><td style={{ padding: "10px" }}>{p.qty}</td><td style={{ padding: "10px" }}>${p.price}</td><td style={{ padding: "10px" }}>${p.mv.toLocaleString()}</td>
                <td style={{ padding: "10px", color: p.plP >= 0 ? T.green : T.red, fontWeight: 600 }}>{p.plP >= 0 ? "+" : ""}{p.plP}%</td>
                <td style={{ padding: "10px" }}>{(p.mv / stats.total * 100).toFixed(1)}%</td>
              </tr>)}</tbody>
            </table>
          </div>
        </div>)}

        {/* ████ SETTINGS ████ */}
        {tab === "settings" && (<div>
          <div style={{ ...X.serif, fontSize: 32, fontWeight: 700, marginBottom: 24 }}>Configuración</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
            <div style={X.card}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}><span style={{ fontSize: 20 }}>🏛</span><div><div style={{ fontSize: 16, fontWeight: 700 }}>Alpaca Markets</div><div style={{ fontSize: 10, color: conn ? T.green : T.red, fontWeight: 600 }}>{conn ? "● Conectado via Proxy" : proxyOk ? "● Proxy OK, autenticando..." : "○ Proxy no detectado"}</div></div></div>
                <div style={{ display: "flex", border: `1.5px solid ${T.bgHigh}`, borderRadius: 2, overflow: "hidden" }}>{["Paper", "Live"].map(m => <button key={m} style={{ padding: "6px 14px", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", background: m === "Paper" ? T.darker : T.white, color: m === "Paper" ? T.white : T.black, fontFamily: "'Manrope'" }}>{m}</button>)}</div>
              </div>
              <div style={{ marginBottom: 16 }}><div style={X.lbl}>API Key ID</div><div style={{ display: "flex", gap: 8 }}><input style={X.inp} type={showK1 ? "text" : "password"} value={keys.aK} onChange={e => setKeys(p => ({ ...p, aK: e.target.value }))} /><span style={{ cursor: "pointer" }} onClick={() => setSK1(!showK1)}>{showK1 ? "🔓" : "🔑"}</span></div></div>
              <div style={{ marginBottom: 16 }}><div style={X.lbl}>Secret Key</div><div style={{ display: "flex", gap: 8 }}><input style={X.inp} type="password" value={keys.aS} onChange={e => setKeys(p => ({ ...p, aS: e.target.value }))} /><span>🔒</span></div></div>
              <button style={{ ...X.bg, width: "100%" }} onClick={connect}>Reconectar</button>
              {acct && <div style={{ marginTop: 12, padding: 12, background: T.greenBg, borderRadius: 2, fontSize: 12 }}><strong style={{ color: T.green }}>✓ Verificado</strong> — {acct.id?.slice(0, 12)}... | Equity: ${(+acct.equity).toLocaleString()}</div>}
            </div>
            <div style={X.card}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}><span style={{ fontSize: 20 }}>◎</span><div><div style={{ fontSize: 16, fontWeight: 700 }}>Anthropic AI</div><div style={{ fontSize: 10, color: T.grey }}>Cognitive Analysis Engine</div></div></div>
              <div style={{ marginBottom: 16 }}><div style={X.lbl}>API Key</div><div style={{ display: "flex", gap: 8 }}><input style={X.inp} type={showK2 ? "text" : "password"} placeholder="sk-ant-..." value={keys.aiK} onChange={e => setKeys(p => ({ ...p, aiK: e.target.value }))} /><span style={{ cursor: "pointer" }} onClick={() => setSK2(!showK2)}>⚡</span></div></div>
              <div style={{ padding: 12, background: keys.aiK ? T.greenBg : T.bgLow, borderRadius: 2, fontSize: 12 }}>{keys.aiK ? <span style={{ color: T.green }}>✓ Key configurada</span> : <span style={{ color: T.grey }}>Sin key — modo demo activo</span>}</div>
            </div>
          </div>
          <div style={{ ...X.card, background: T.yellowLight }}>
            <div style={{ ...X.serif, fontSize: 16, fontWeight: 700, marginBottom: 8, color: T.primary }}>⚡ Cómo conectar Alpaca en vivo</div>
            <div style={{ fontSize: 13, lineHeight: 1.8, color: T.darker }}>
              <strong>1.</strong> Descarga <code style={{ background: T.bgLow, padding: "2px 6px", borderRadius: 2 }}>server.js</code> (ya lo tienes en tus descargas)<br />
              <strong>2.</strong> Abre terminal y ejecuta: <code style={{ background: T.bgLow, padding: "2px 6px", borderRadius: 2 }}>npm install express cors</code><br />
              <strong>3.</strong> Luego: <code style={{ background: T.bgLow, padding: "2px 6px", borderRadius: 2 }}>node server.js</code><br />
              <strong>4.</strong> Regresa aquí y presiona "Reconectar" — verás el indicador verde "● Alpaca Live"<br />
              <strong>5.</strong> Ahora el escáner usa datos reales y los trades se ejecutan en tu cuenta paper
            </div>
          </div>
          <div style={{ ...X.card, marginTop: 16 }}>
            <div style={{ ...X.serif, fontSize: 16, fontWeight: 700, marginBottom: 8 }}>🚀 Roadmap</div>
            <div style={{ fontSize: 12, color: T.grey, lineHeight: 1.8 }}>
              <span style={{ color: T.green }}>✅ Fase 1:</span> MVP con IB engine, backtesting, comparador, AI advisor, proxy server<br />
              <span style={{ color: T.gold }}>🔜 Fase 2:</span> Deploy proxy a cloud, auth OAuth, DB persistente, notificaciones<br />
              <span style={{ color: T.primary }}>📋 Fase 3:</span> Multi-usuario, billing, mobile app, más estrategias
            </div>
          </div>
        </div>)}
      </div>
    </div>
  );
}
