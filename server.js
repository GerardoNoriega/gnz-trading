const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'gnz-trading-v3' }));

// Telegram
app.post('/api/telegram', async (req, res) => {
  const { token, chatId, message } = req.body;
  if (!token || !chatId || !message) return res.status(400).json({ error: 'Missing params' });
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'Markdown' })
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.description || 'Telegram error');
    console.log(`[TELEGRAM] Sent to ${chatId}`);
    res.json(d);
  } catch (e) { console.error('[TELEGRAM ERR]', e.message); res.status(500).json({ error: e.message }); }
});
app.post('/api/telegram/test', async (req, res) => {
  const { token, chatId } = req.body;
  if (!token || !chatId) return res.status(400).json({ error: 'Missing params' });
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: '◈ *GNZ Trading* — Notificaciones activas ✓\n\nRecibirás alertas cuando el escáner detecte señales de trading.', parse_mode: 'Markdown' })
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.description);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Alpaca Proxy
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
  } catch (e) { console.error(`[ERR] ${url}:`, e.message); res.status(502).json({ error: e.message }); }
}
app.all('/alpaca/*', (req, res) => proxy('https://paper-api.alpaca.markets', '/alpaca', req, res));
app.all('/data/*', (req, res) => proxy('https://data.alpaca.markets', '/data', req, res));

app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));
app.listen(PORT, '0.0.0.0', () => console.log(`GNZ Trading v3 on port ${PORT}`));
