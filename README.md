# ◈ GNZ Trading

Portfolio management & Inside Bar trading strategy platform with Alpaca Paper Trading integration and AI advisor.

## Deploy to Railway

1. Push this repo to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Select `gnz-trading` → Deploy
4. Done. Your URL: `https://gnz-trading-production.up.railway.app`

## Local Development

```bash
npm install
npm run build
npm start
# Open http://localhost:3000
```

## Features
- Dashboard with portfolio overview
- Inside Bar strategy engine with full parametrization
- Backtesting with real Alpaca historical data
- Scenario comparator (by timeframe & config)
- AI Portfolio Advisor (Claude API)
- Trade execution on Alpaca Paper Trading
