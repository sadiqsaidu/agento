# Agento

**Agentic wallet infrastructure for AI agents on Solana.**

Agento is a wallet service that gives AI agents autonomous access to Solana DeFi — swapping tokens on Jupiter, placing limit orders, liquid staking SOL, lending via Lulo, and more. Any AI agent (Claude, GPT, Gemini, local models) can connect via **MCP** or **REST** and start transacting.

**Zero bloat.** No solana-agent-kit. Just `@solana/web3.js`, `@solana/spl-token`, and direct HTTP calls to Jupiter/Lulo APIs. 8 source files, 209 npm packages total.

---

## Features

### 18 Tools

| Category | Tools |
|----------|-------|
| **Wallet** | `create_wallet` · `get_wallet_address` · `get_balance` · `get_token_balances` · `transfer` · `list_wallets` · `request_airdrop` · `import_wallet` · `export_wallet` · `delete_wallet` |
| **Jupiter Trading** | `swap_tokens` · `fetch_token_price` · `create_limit_order` · `cancel_limit_orders` · `get_open_orders` |
| **Jupiter Staking** | `stake_sol` (SOL → jupSOL) |
| **Lulo Lending** | `lend_asset` · `withdraw_lend` |

### Dual Interface

- **MCP (Model Context Protocol)** — stdio transport for Claude Desktop, LangChain MCP adapters
- **REST API** — HTTP interface for any agent framework (LangChain, Vercel AI SDK, AutoGPT, custom agents, Python, etc.)

Both interfaces expose the exact same 18 tools.

### Encrypted Keystore

- **AES-256-GCM** encryption with **scrypt** KDF (N=2¹⁸, r=8, p=1)
- Ethereum Web3 Secret Storage V3 format adapted for Solana
- Keys never leave the encrypted keystore unless unlocked with a password
- No private keys held in memory longer than needed

### Guardrails Engine

9 configurable safety rules enforced on every transactional operation:

| Rule | Default |
|------|---------|
| Per-transaction spending limit | 1.0 SOL |
| Daily spending limit (rolling 24h) | 5.0 SOL |
| Balance floor (reserve for fees) | 0.05 SOL |
| Drain protection (max % per tx) | 50% |
| Rate limiting (txs per minute) | 10/min |
| Slippage cap | 500 bps (5%) |
| Token validation (Jupiter verified only) | Enabled |
| Address blocklist | Configurable |
| Address allowlist | Configurable |

Configure via `guardrails.json` at the project root.

### Real-Time Monitoring

- **Dashboard** — built-in dark-themed web dashboard at `/dashboard` with live SSE activity feed
- **CLI Monitor** — `agento monitor` live-tails events in your terminal
- **SSE Endpoint** — `GET /events` streams events to any client

### CLI

```
agento wallet create --password <pw>     Create encrypted wallet
agento wallet list                       List all wallets
agento wallet info <id> --password <pw>  Balance + token info
agento wallet fund <id> --password <pw>  Airdrop 1 devnet SOL
agento serve rest                        Start REST API + dashboard
agento serve mcp --wallet <id>           Start MCP server (stdio)
agento monitor                           Live-tail agent activity
```

---

## Quick Start

### Prerequisites

- **Node.js ≥ 22**
- A Solana RPC URL (default: devnet)

### Option 1: npm (recommended)

```bash
# Run directly with npx
npx @onetutuone/agento serve rest

# Or install globally
npm install -g @onetutuone/agento
agento serve rest
```

Open [http://localhost:3000/dashboard](http://localhost:3000/dashboard) to see the dashboard.

### Option 2: From Source

```bash
git clone https://github.com/sadiqsaidu/agento.git
cd agento
npm install
cp .env.example .env   # Edit with your keys
npm run build
npm start
```

### Create Your First Wallet

```bash
# Via CLI
agento wallet create --password my-secret

# Via REST
curl -X POST http://localhost:3000/wallets \
  -H 'Content-Type: application/json' \
  -d '{"password": "my-secret"}'
```

### Fund It (Devnet)

```bash
# Via CLI
agento wallet fund <wallet-id> --password my-secret

# Via REST
curl -X POST http://localhost:3000/tools/request_airdrop \
  -H 'Content-Type: application/json' \
  -H 'X-Wallet-Id: <wallet-id>' \
  -H 'X-Wallet-Password: my-secret' \
  -d '{"amount": 2}'
```

---

## Configuration

### Environment Variables

Create a `.env` file (or set environment variables):

```env
SOLANA_RPC_URL=https://api.devnet.solana.com   # Solana RPC endpoint
REST_PORT=3000                                  # REST server port
KEYSTORE_DIR=./wallets                          # Where encrypted wallets are stored
JUPITER_API_KEY=                                # Optional: free tier at portal.jup.ag
OPENROUTER_API_KEY=sk-or-v1-...                # For demo agent only
```

### Guardrails

Edit `guardrails.json` to customize safety limits:

```json
{
  "enabled": true,
  "spendingLimits": {
    "perTransactionSol": 1.0,
    "dailyTotalSol": 5.0
  },
  "balanceFloorSol": 0.05,
  "drainProtection": { "maxPercentPerTx": 50 },
  "rateLimit": { "maxPerMinute": 10 },
  "maxSlippageBps": 500,
  "tokenValidation": { "onlyVerifiedTokens": true },
  "addressRules": {
    "allowlist": [],
    "blocklist": [],
    "flagUnknown": false
  }
}
```

Read-only tools (balance, price, list) bypass guardrails. Only transactional tools (transfer, swap, stake, lend) are checked.

---

## REST API Reference

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/tools` | List all available tools |
| `POST` | `/tools/:name` | Execute a tool (body = tool input JSON) |
| `POST` | `/wallets` | Create a new wallet |
| `GET` | `/wallets` | List all wallets |
| `GET` | `/events` | Server-Sent Events stream |
| `GET` | `/dashboard` | Web dashboard |

### Authentication

Tool execution requires wallet credentials via headers:

```
X-Wallet-Id: <wallet-uuid>
X-Wallet-Password: <password>
```

### Examples

**Check balance:**
```bash
curl -X POST http://localhost:3000/tools/get_balance \
  -H 'Content-Type: application/json' \
  -H 'X-Wallet-Id: 574a67d8-...' \
  -H 'X-Wallet-Password: my-secret' \
  -d '{}'
```

**Fetch SOL price:**
```bash
curl -X POST http://localhost:3000/tools/fetch_token_price \
  -H 'Content-Type: application/json' \
  -d '{"mint": "So11111111111111111111111111111111111111112"}'
```

**Swap SOL → USDC:**
```bash
curl -X POST http://localhost:3000/tools/swap_tokens \
  -H 'Content-Type: application/json' \
  -H 'X-Wallet-Id: 574a67d8-...' \
  -H 'X-Wallet-Password: my-secret' \
  -d '{"outputMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "inputAmount": 0.5}'
```

**Stream events:**
```bash
curl -N http://localhost:3000/events
```

---

## MCP Server (Claude Desktop / LangChain)

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "agento": {
      "command": "npx",
      "args": ["@onetutuone/agento", "serve", "mcp", "--wallet", "<wallet-id>", "--password", "<password>"],
      "env": {
        "SOLANA_RPC_URL": "https://api.devnet.solana.com"
      }
    }
  }
}
```

### From Source

```bash
WALLET_ID=<id> WALLET_PASSWORD=<pw> npx tsx src/mcp.ts
```

---

## Python Agent Example

A standalone Python agent demo is included in `examples/python-agent/`. It connects to any Agento REST deployment, auto-discovers all 18 tools, and lets an LLM manage wallets autonomously.

```bash
cd examples/python-agent
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # Add your OPENROUTER_API_KEY

# Default task
python agent.py

# Custom task
python agent.py "swap 0.1 SOL for USDC"

# Interactive mode
python agent.py -i
```

The agent auto-discovers tools from the live API — no Agento SDK required. Just HTTP.

```
🌐 Agento: https://agento-8m72.onrender.com
🧠 Model:  openai/gpt-4o-mini
✅ Agento is reachable.
🔧 Discovered 18 tools.

🎯 Task: Create a new wallet, airdrop 2 SOL, then check the balance.

  🔧 create_wallet({})
  ✅ {"success":true,"result":{"wallet_id":"38ab230d-...","address":"3dWF..."}}
  🔧 request_airdrop({"amount": 2})
  ✅ {"success":true,"result":{"signature":"4Vu8...","amount":2}}
  🔧 get_balance({})
  ✅ {"success":true,"result":{"address":"3dWF...","balance_sol":2}}

🤖 Done! Created wallet, airdropped 2 SOL, balance confirmed.
```

---

## LangChain Agent Example

A LangChain + OpenRouter demo agent is included in `demo/agent.ts`:

```bash
# Set WALLET_ID in .env first
npx tsx demo/agent.ts "Show my wallet address, check the balance, and fetch the SOL price"
```

---

## Hosted Deployment

A live instance is running on Render:

- **API:** `https://agento-8m72.onrender.com`
- **Dashboard:** `https://agento-8m72.onrender.com/dashboard`
- **Health:** `https://agento-8m72.onrender.com/health`

Point any agent at the hosted URL to start using it immediately:

```bash
# Python
AGENTO_URL=https://agento-8m72.onrender.com python agent.py

# CLI monitor
agento monitor --host https://agento-8m72.onrender.com
```

### Self-Hosting

A `render.yaml` is included for one-click Render deployment. Works on any platform that runs Node.js:

```bash
# Render / Railway / Fly.io
npm install && npm run build && npm start

# Docker (bring your own Dockerfile)
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY dist/ dist/
COPY guardrails.json .
CMD ["npm", "start"]
```

---

## Project Structure

```
agento/
├── src/
│   ├── cli.ts          # CLI with ASCII banner (wallet/serve/monitor commands)
│   ├── config.ts       # Env validation (Zod)
│   ├── keystore.ts     # AES-256-GCM encrypted wallet storage
│   ├── wallet.ts       # Keypair + Connection manager
│   ├── tools.ts        # 18 tool definitions (Jupiter, Lulo, wallet ops)
│   ├── guardrails.ts   # 9 safety rules engine
│   ├── events.ts       # Event bus + SSE broadcasting
│   ├── mcp.ts          # MCP server (stdio transport)
│   ├── rest.ts         # REST server (Hono) + dashboard
│   └── dashboard.html  # Built-in web dashboard
├── demo/
│   └── agent.ts        # LangChain ReAct demo agent
├── examples/
│   └── python-agent/   # Standalone Python agent demo
├── guardrails.json     # Safety rule configuration
├── SKILLS.md           # Agent-facing tool documentation
├── DEEP_DIVE.md        # Technical deep dive
├── render.yaml         # Render deployment config
├── package.json
└── tsconfig.json
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22, TypeScript (strict, ESM) |
| Solana | @solana/web3.js, @solana/spl-token |
| DeFi | Jupiter REST API (swap, limit orders, staking), Lulo/Flexlend (lending), DexScreener (prices) |
| MCP | @modelcontextprotocol/sdk (stdio transport) |
| REST | Hono + @hono/node-server |
| Encryption | Node.js crypto (scrypt + AES-256-GCM) |
| Validation | Zod |
| Python Demo | openai + httpx (OpenRouter) |

---

## Common Token Mints

| Token | Mint Address |
|-------|-------------|
| SOL | `So11111111111111111111111111111111111111112` |
| USDC | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| USDT | `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` |
| jupSOL | `jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v` |

---

## License

MIT
