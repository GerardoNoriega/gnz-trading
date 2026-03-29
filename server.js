/**
 * ◈ GNZ Trading — Server v4
 * Alpaca Proxy + Telegram Approval Bot + AI Advisor
 */
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());

const pendingTrades = new Map();

app.get('/health', (req, res) => res.json({ status: 'ok', v: 4 }));

// ═══ TELEGRAM — Alert with Approve/Reject buttons ═══
app.post('/api/telegram/alert', async (req, res) => {
  const { token, chatId, trade } = req.body;
  if (!token || !chatId || !trade) return res.status(400).json({ error: 'Missing params' });
  const dir = trade.dir === "LONG" ? "🟢 LONG" : "🔴 SHORT";
  const msg = `🔔 *GNZ Trading — Nueva Señal*\n\n*${trade.sym}* — ${trade.strategy || "Signal"}\n${dir} @ *$${trade.entry}*\n\nSL: $${trade.sl} | TP: $${trade.tp}\nR:R: ${trade.rr}x\n\n_Toca un botón:_`;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: "✅ APROBAR", callback_data: `approve_${trade.id}` }, { text: "❌ RECHAZAR", callback_data: `reject_${trade.id}` }]] } })
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.description);
    pendingTrades.set(String(trade.id), { ...trade, messageId: d.result.message_id, token, chatId, status: 'pending' });
    console.log(`[TG] Alert: ${trade.sym} ${trade.dir}`);
    res.json({ ok: true, messageId: d.result.message_id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/telegram', async (req, res) => {
  const { token, chatId, message } = req.body;
  if (!token || !chatId || !message) return res.status(400).json({ error: 'Missing params' });
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'Markdown' }) });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/telegram/test', async (req, res) => {
  const { token, chatId } = req.body;
  if (!token || !chatId) return res.status(400).json({ error: 'Missing params' });
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, parse_mode: 'Markdown',
        text: '◈ *GNZ Trading v4*\n\n✓ Bot conectado\n✓ Alertas con botones Aprobar/Rechazar\n✓ Ejecución automática en Alpaca\n\n_Prueba los botones:_',
        reply_markup: { inline_keyboard: [[{ text: "✅ Test Aprobar", callback_data: "test_approve" }, { text: "❌ Test Rechazar", callback_data: "test_reject" }]] } }) });
    const d = await r.json();
    if (!d.ok) throw new Error(d.description);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══ TELEGRAM POLLING — Listen for button presses ═══
let lastUpdateId = 0, pollingActive = false;
let pollCfg = { token: null, aK: null, aS: null };

app.post('/api/telegram/start-polling', (req, res) => {
  const { token, alpacaKey, alpacaSecret } = req.body;
  if (!token) return res.status(400).json({ error: 'Missing token' });
  pollCfg = { token, aK: alpacaKey, aS: alpacaSecret };
  if (!pollingActive) { pollingActive = true; pollLoop(); console.log('[TG] Polling started'); }
  res.json({ ok: true });
});

app.post('/api/telegram/stop-polling', (req, res) => {
  pollingActive = false; console.log('[TG] Polling stopped'); res.json({ ok: true });
});

app.get('/api/trades/pending', (req, res) => {
  const t = []; pendingTrades.forEach((v, k) => t.push({ id: k, ...v })); res.json(t);
});

async function pollLoop() {
  while (pollingActive && pollCfg.token) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${pollCfg.token}/getUpdates?offset=${lastUpdateId + 1}&timeout=10&allowed_updates=["callback_query"]`);
      const d = await r.json();
      if (d.ok && d.result.length) {
        for (const u of d.result) { lastUpdateId = u.update_id; if (u.callback_query) await handleCB(u.callback_query); }
      }
    } catch (e) { console.error('[TG POLL ERR]', e.message); await new Promise(r => setTimeout(r, 5000)); }
  }
}

async function handleCB(cb) {
  const { data } = cb;
  const chatId = cb.message?.chat?.id, msgId = cb.message?.message_id, token = pollCfg.token;
  console.log(`[TG] Callback: ${data}`);

  // Answer callback
  try { await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ callback_query_id: cb.id }) }); } catch {}

  if (data === 'test_approve') { await editMsg(token, chatId, msgId, '✅ *Test aprobado* — En producción, ejecutaría la orden.'); return; }
  if (data === 'test_reject') { await editMsg(token, chatId, msgId, '❌ *Test rechazado* — Señal descartada.'); return; }

  const [action, ...idParts] = data.split('_');
  const tradeId = idParts.join('_');
  const trade = pendingTrades.get(tradeId);
  if (!trade) { await editMsg(token, chatId, msgId, '⚠️ Trade expirado.'); return; }

  if (action === 'approve') {
    trade.status = 'approved'; pendingTrades.set(tradeId, trade);
    const result = await execTrade(trade);
    await editMsg(token, chatId, msgId, result.ok
      ? `✅ *EJECUTADA*\n\n*${trade.sym}* ${trade.dir} @ $${trade.entry}\n${result.detail}\n\n_Alpaca Paper Trading_`
      : `⚠️ *Error*\n${result.error}`);
  } else {
    trade.status = 'rejected'; pendingTrades.set(tradeId, trade);
    await editMsg(token, chatId, msgId, `❌ *Rechazada* — ${trade.sym} ${trade.dir}`);
  }
}

async function editMsg(token, chatId, msgId, text) {
  try { await fetch(`https://api.telegram.org/bot${token}/editMessageText`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, message_id: msgId, text, parse_mode: 'Markdown' }) }); } catch {}
}

async function execTrade(trade) {
  if (!pollCfg.aK || !pollCfg.aS) return { ok: false, error: 'No Alpaca keys' };
  const side = trade.dir === "LONG" ? "buy" : "sell";
  const h = { 'APCA-API-KEY-ID': pollCfg.aK, 'APCA-API-SECRET-KEY': pollCfg.aS, 'Content-Type': 'application/json' };

  let qty = trade.shares || 1;
  if (!trade.shares || trade.shares === "auto") {
    try {
      const a = await (await fetch('https://paper-api.alpaca.markets/v2/account', { headers: h })).json();
      const bp = +a.buying_power, sd = Math.abs(trade.entry - trade.sl);
      qty = sd > 0 ? Math.floor(bp * 0.08 / sd) : 10;
      qty = Math.max(1, Math.min(qty, Math.floor(bp * 0.5 / trade.entry)));
    } catch { qty = 10; }
  }

  try {
    let body = { symbol: trade.sym, qty: String(qty), side, type: "limit", time_in_force: "day", limit_price: String(trade.entry), order_class: "bracket", stop_loss: { stop_price: String(trade.sl) }, take_profit: { limit_price: String(trade.tp) } };
    let r = await fetch('https://paper-api.alpaca.markets/v2/orders', { method: 'POST', headers: h, body: JSON.stringify(body) });
    if (!r.ok) {
      body = { symbol: trade.sym, qty: String(qty), side, type: "market", time_in_force: "day" };
      r = await fetch('https://paper-api.alpaca.markets/v2/orders', { method: 'POST', headers: h, body: JSON.stringify(body) });
    }
    if (!r.ok) return { ok: false, error: await r.text() };
    const o = await r.json();
    console.log(`[ALPACA] ${side} ${qty} ${trade.sym} — ${o.id}`);
    return { ok: true, detail: `${side.toUpperCase()} ${qty} shares\nID: ${o.id?.slice(0, 12)}` };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ═══ AI ADVISOR (with live Alpaca data) ═══
app.post('/api/ai/advisor', async (req, res) => {
  const { anthropicKey, alpacaKey, alpacaSecret, prompt } = req.body;
  if (!anthropicKey) return res.status(400).json({ error: 'Missing Anthropic key' });

  let ctx = "";
  if (alpacaKey && alpacaSecret) {
    const ah = { 'APCA-API-KEY-ID': alpacaKey, 'APCA-API-SECRET-KEY': alpacaSecret };
    try {
      const [accR, posR, ordR] = await Promise.all([
        fetch('https://paper-api.alpaca.markets/v2/account', { headers: ah }),
        fetch('https://paper-api.alpaca.markets/v2/positions', { headers: ah }),
        fetch('https://paper-api.alpaca.markets/v2/orders?status=all&limit=10', { headers: ah }),
      ]);
      const acc = await accR.json(), pos = await posR.json(), ord = await ordR.json();
      ctx = `\nCUENTA ALPACA EN VIVO:\nEquity: $${(+acc.equity).toLocaleString()} | Buying Power: $${(+acc.buying_power).toLocaleString()} | Cash: $${(+acc.cash).toLocaleString()}\n\nPOSICIONES (${Array.isArray(pos) ? pos.length : 0}):\n${Array.isArray(pos) && pos.length ? pos.map(p => `${p.symbol}: ${p.qty}@$${(+p.avg_entry_price).toFixed(2)} | Now:$${(+p.current_price).toFixed(2)} | PL:$${(+p.unrealized_pl).toFixed(2)} (${(+p.unrealized_plpc*100).toFixed(1)}%)`).join('\n') : 'Sin posiciones'}\n\nÓRDENES RECIENTES:\n${Array.isArray(ord) && ord.length ? ord.slice(0,5).map(o => `${o.side} ${o.qty||o.filled_qty} ${o.symbol} — ${o.status}`).join('\n') : 'Sin órdenes'}`;
    } catch (e) { ctx = `\nError Alpaca: ${e.message}`; }
  }

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514', max_tokens: 1500,
        system: `Eres el AI Advisor de GNZ Trading. Tienes datos en tiempo real de Alpaca. Targets: ETFs 40%, Crecimiento 30%, Poder 30%. Da sugerencias CONCRETAS en español. Incluye símbolo, cantidad, y acción exacta.${ctx}`,
        messages: [{ role: 'user', content: prompt || 'Analiza mi portafolio y sugiere rebalanceo.' }]
      })
    });
    const d = await r.json();
    res.json({ ok: true, response: d.content?.map(c => c.text || '').join('') || 'Error', hasLiveData: !!ctx });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══ ALPACA PROXY ═══
async function proxy(base, prefix, req, res) {
  const url = `${base}${req.originalUrl.substring(prefix.length)}`;
  const h = { 'Content-Type': 'application/json' };
  if (req.headers['apca-api-key-id']) h['APCA-API-KEY-ID'] = req.headers['apca-api-key-id'];
  if (req.headers['apca-api-secret-key']) h['APCA-API-SECRET-KEY'] = req.headers['apca-api-secret-key'];
  try {
    const opts = { method: req.method, headers: h };
    if (['POST','PUT','PATCH'].includes(req.method) && req.body) opts.body = JSON.stringify(req.body);
    console.log(`[PROXY] ${req.method} ${url}`);
    const r = await fetch(url, opts);
    const ct = r.headers.get('content-type');
    const d = ct?.includes('json') ? await r.json() : await r.text();
    if (url.includes('/bars') && typeof d === 'object' && d.bars) console.log(`  -> ${d.bars.length} bars`);
    res.status(r.status); typeof d === 'string' ? res.send(d) : res.json(d);
  } catch (e) { res.status(502).json({ error: e.message }); }
}
app.all('/alpaca/*', (req, res) => proxy('https://paper-api.alpaca.markets', '/alpaca', req, res));
app.all('/data/*', (req, res) => proxy('https://data.alpaca.markets', '/data', req, res));

app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  ◈ GNZ Trading v4 on port ${PORT}`);
  console.log('  ✓ Alpaca Proxy | ✓ Telegram Bot | ✓ AI Advisor | ✓ Trade Exec\n');
});
