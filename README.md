# Agento — Phantom for AI Agents

**An agentic wallet service that gives AI agents autonomous access to Solana DeFi.**

Agento provides a dual-interface wallet service (MCP + REST) that any AI agent can connect to and use for on-chain DeFi operations — swapping tokens on Jupiter, placing limit orders, liquid staking SOL, lending via Lulo, and more.

> Built for the [Superteam DeFi Developer Challenge — Agentic Wallets for AI Agents](https://earn.superteam.fun)

---

## Architecture

```
┌─────────────────────────────────────┐
│         AI Agent (any LLM)          │
│   Claude / GPT / Gemini / local     │
└──────────┬───────────┬──────────────┘
           │ MCP       │ REST
           │ (stdio)   │ (HTTP)
           ▼           ▼
┌─────────────────────────────────────┐
│          A G E N T O                │
│                                     │
│  ┌───────────┐  ┌────────────────┐  │
│  │  Keystore │  │   14 Tools     │  │
│  │ AES-256   │  │                │  │
│  │  scrypt   │  │ • Wallet Mgmt  │  │
│  │  GCM      │  │ • Jupiter Swap │  │
│  └───────────┘  │ • Limit Orders │  │
│                 │ • Staking      │  │
│                 │ • Lulo Lending  │  │
│                 └────────────────┘  │
│                       │             │
│              @solana/web3.js        │
│              @solana/spl-token      │
│              Jupiter REST API       │
│              Lulo REST API          │
└──────────────────┬──────────────────┘
                   │
                   ▼
           Solana (devnet/mainnet)
```

**Zero bloat**: No solana-agent-kit. Just `@solana/web3.js`, `@solana/spl-token`, and direct HTTP calls to Jupiter/Lulo APIs. 209 packages total (vs 1300+ with SAK).

---

## Features

| Category | Tools |
|----------|-------|
| **Wallet** | `create_wallet` · `get_wallet_address` · `get_balance` · `get_token_balances` · `transfer` · `list_wallets` |
| **Jupiter Trading** | `swap_tokens` · `fetch_token_price` · `create_limit_order` · `cancel_limit_orders` · `get_open_orders` |
| **Jupiter Staking** | `stake_sol` (SOL → jupSOL) |
| **Lulo Lending** | `lend_asset` · `withdraw_lend` |

### Security

- **AES-256-GCM** encryption with **scrypt** KDF (N=2¹⁸, r=8, p=1)
- Ethereum Web3 Secret Storage V3 format adapted for Solana
- Keys never leave the encrypted keystore unless unlocked with a password
- No private keys in memory longer than needed

---

## Quick Start

### Prerequisites

- **Node.js ≥ 22** (required for ESM compatibility)
- A Solana RPC URL (default: devnet)

### Setup

```bash
git clone https://github.com/yourusername/agento.git
cd agento
cp .env.example .env

# Edit .env with your keys
npm install
```

### `.env` Configuration

```env
SOLANA_RPC_URL=https://api.devnet.solana.com
OPENROUTER_API_KEY=sk-or-v1-...      # For demo agent only
OPENROUTER_MODEL=openai/gpt-oss-120b:free
JUPITER_API_KEY=                       # Optional: free tier at portal.jup.ag
REST_PORT=3000
KEYSTORE_DIR=./wallets
```

---

## Usage

### REST Server

```bash
npx tsx src/rest.ts
# 🚀 Agento REST server listening on http://localhost:3000
```

**Create a wallet:**
```bash
curl -X POST http://localhost:3000/wallets \
  -H 'Content-Type: application/json' \
  -d '{"password": "my-secret-password"}'

# {"success":true,"id":"574a67d8-...","address":"6Rx57VKP..."}
```

**Check balance:**
```bash
curl -X POST http://localhost:3000/tools/get_balance \
  -H 'Content-Type: application/json' \
  -H 'X-Wallet-Id: 574a67d8-...' \
  -H 'X-Wallet-Password: my-secret-password' \
  -d '{}'
```

**Fetch SOL price:**
```bash
curl -X POST http://localhost:3000/tools/fetch_token_price \
  -H 'Content-Type: application/json' \
  -d '{"mint": "So11111111111111111111111111111111111111112"}'

# {"success":true,"result":{"mint":"So11...","price_usd":85.56,"source":"dexscreener"}}
```

**Swap SOL → USDC:**
```bash
curl -X POST http://localhost:3000/tools/swap_tokens \
  -H 'Content-Type: application/json' \
  -H 'X-Wallet-Id: 574a67d8-...' \
  -H 'X-Wallet-Password: my-secret-password' \
  -d '{"outputMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "inputAmount": 0.5}'
```

### MCP Server (for Claude Desktop, LangChain, etc.)

```bash
# Standalone (for testing):
WALLET_ID=<id> WALLET_PASSWORD=<pw> npx tsx src/mcp.ts

# Claude Desktop config (claude_desktop_config.json):
{
  "mcpServers": {
    "agento": {
      "command": "npx",
      "args": ["tsx", "/path/to/agento/src/mcp.ts"],
      "env": {
        "WALLET_ID": "<your-wallet-id>",
        "WALLET_PASSWORD": "<your-password>"
      }
    }
  }
}
```

### Demo Agent (LangChain + OpenRouter)

```bash
# First create a wallet and set WALLET_ID in .env
npx tsx demo/agent.ts "Show my wallet address, check the balance, and fetch the prices of SOL and USDC"
```

If OpenRouter returns `429`, set `OPENROUTER_MODEL` in `.env` to another model available on your account and retry.

---

## REST API Reference

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/tools` | List all available tools |
| POST | `/tools/:name` | Execute a tool (body = tool input JSON) |
| POST | `/wallets` | Create a new wallet |
| GET | `/wallets` | List all wallets |

**Headers for tool execution:**
- `X-Wallet-Id` — wallet UUID from keystore
- `X-Wallet-Password` — password to unlock the wallet

---

## Project Structure

```
agento/
├── src/
│   ├── config.ts      # Env validation (Zod)
│   ├── keystore.ts    # AES-256-GCM encrypted wallet storage
│   ├── wallet.ts      # Keypair + Connection manager
│   ├── tools.ts       # 14 tool definitions (Jupiter, Lulo, wallet ops)
│   ├── mcp.ts         # MCP server (stdio transport)
│   └── rest.ts        # REST server (Hono)
├── demo/
│   └── agent.ts       # LangChain ReAct demo agent
├── wallets/           # Encrypted keystore files (gitignored)
├── package.json
└── tsconfig.json
```

**6 source files. That's it.**

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22, TypeScript, ESM |
| Solana | @solana/web3.js, @solana/spl-token |
| DeFi | Jupiter REST API (swap, limit orders, staking), Lulo/Flexlend API (lending) |
| MCP | @modelcontextprotocol/sdk (stdio transport) |
| REST | Hono + @hono/node-server |
| Crypto | Node.js crypto (scrypt + AES-256-GCM) |
| Demo | @langchain/openai + @langchain/langgraph + OpenRouter |

---

## License

MIT
