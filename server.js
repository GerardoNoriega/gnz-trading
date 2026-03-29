/**
 * ◈ GNZ TRADING — Production Server
 * Serves React app + Alpaca API proxy
 */
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ─── Health ───
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'gnz-trading', timestamp: new Date().toISOString() });
});
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'gnz-trading', timestamp: new Date().toISOString() });
});

// ─── Alpaca Proxy ───
async function proxyRequest(targetBase, prefix, req, res) {
  const pathWithQuery = req.originalUrl.substring(prefix.length);
  const targetUrl = `${targetBase}${pathWithQuery}`;

  const headers = { 'Content-Type': 'application/json' };
  if (req.headers['apca-api-key-id']) headers['APCA-API-KEY-ID'] = req.headers['apca-api-key-id'];
  if (req.headers['apca-api-secret-key']) headers['APCA-API-SECRET-KEY'] = req.headers['apca-api-secret-key'];

  try {
    const fetchOptions = { method: req.method, headers };
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
      fetchOptions.body = JSON.stringify(req.body);
    }
    console.log(`[PROXY] ${req.method} ${targetUrl}`);
    const response = await fetch(targetUrl, fetchOptions);
    const contentType = response.headers.get('content-type');
    const data = contentType?.includes('json') ? await response.json() : await response.text();

    if (targetUrl.includes('/bars') && typeof data === 'object' && data.bars) {
      console.log(`  → ${data.bars.length} bars`);
    }
    res.status(response.status);
    if (typeof data === 'string') res.send(data); else res.json(data);
  } catch (error) {
    console.error(`[ERROR] ${targetUrl}:`, error.message);
    res.status(502).json({ error: 'Proxy error', message: error.message });
  }
}

app.all('/alpaca/*', (req, res) => proxyRequest('https://paper-api.alpaca.markets', '/alpaca', req, res));
app.all('/data/*', (req, res) => proxyRequest('https://data.alpaca.markets', '/data', req, res));

// ─── Serve React build ───
app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  ◈ GNZ TRADING Production Server');
  console.log('  ════════════════════════════════');
  console.log(`  ✓ Running on port ${PORT}`);
  console.log('  ✓ React app    → /');
  console.log('  ✓ Alpaca Trade → /alpaca/*');
  console.log('  ✓ Alpaca Data  → /data/*');
  console.log('');
});
