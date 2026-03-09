# Agento

**Agentic wallet infrastructure for AI agents on Solana.**

Agento gives AI agents autonomous access to Solana wallets and DeFi — creating wallets, signing transactions, swapping tokens, staking, lending, and placing limit orders. Any AI agent connects via **REST** or **MCP** and starts transacting. No human intervention required.

Built with `@solana/web3.js`, `@solana/spl-token`, and direct API calls to Jupiter and Lulo. No solana-agent-kit. 8 source files, ~2,100 lines of TypeScript.

<!-- 📸 Screenshot: terminal showing `agento serve rest` startup with the ASCII banner -->

---

## Features

**18 DeFi Tools** — wallet management, Jupiter swaps, limit orders, liquid staking (jupSOL), and Lulo lending.

**Encrypted Keystore** — AES-256-GCM + scrypt. Ethereum Web3 Secret Storage V3 adapted for Solana. Keys never leave the encrypted store unless unlocked with a password.

**Guardrails Engine** — 9 safety rules (spending limits, drain protection, rate limiting, slippage caps, token validation) enforced on every transaction. Configurable via `guardrails.json`.

**Dual Interface** — REST API and MCP (Model Context Protocol) expose the same 18 tools. Any LLM, any framework.

**Real-Time Monitoring** — live dashboard at `/dashboard`, CLI monitor via `agento monitor`, and SSE event stream.

**Multi-Agent Ready** — each agent gets its own wallet. Run multiple agents independently against one Agento instance.

---

## Quick Start

```bash
git clone https://github.com/sadiqsaidu/agento.git
cd agento
npm install
cp .env.example .env
npm run build
```

### Create a wallet and fund it

```bash
npx agento wallet create --password my-secret
npx agento wallet fund <wallet-id> --password my-secret
```

<!-- 📸 Screenshot: terminal output of wallet create + fund commands -->

### Start the server

```bash
npx agento serve rest
```

Open [http://localhost:3000/dashboard](http://localhost:3000/dashboard) to see the dashboard.

<!-- 📸 Screenshot: dashboard in the browser -->

### Monitor agent activity

In a separate terminal:

```bash
npx agento monitor
```

<!-- 📸 Screenshot: CLI monitor with live events -->

---

## CLI Reference

```
agento wallet create  --password <pw>       Create encrypted wallet
agento wallet list                          List all wallets
agento wallet info    <id> --password <pw>  Balance + token info
agento wallet fund    <id> --password <pw>  Airdrop 1 devnet SOL
agento wallet import  <key> --password <pw> Import base58 private key
agento wallet export  <id> --password <pw>  Export private key
agento wallet delete  <id>                  Remove wallet

agento serve rest  [--port 3000]            Start REST API + dashboard
agento serve mcp   --wallet <id> --password <pw>  Start MCP server (stdio)

agento monitor [--host http://localhost:3000]  Live-tail agent activity
```

---

## Connecting an Agent

Agento is a service your agent connects to — not a library you import. Your agent reads the tools from `SKILLS.md` (or `GET /tools`) and calls `POST /tools/:name` with wallet credentials in headers.

### REST API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/tools` | List all 18 tools |
| `POST` | `/tools/:name` | Execute a tool |
| `POST` | `/wallets` | Create wallet |
| `GET` | `/wallets` | List wallets |
| `GET` | `/events` | SSE event stream |
| `GET` | `/dashboard` | Web dashboard |

**Authentication** — every tool call requires:

```
X-Wallet-Id: <wallet-uuid>
X-Wallet-Password: <password>
```

**Example — check balance:**

```bash
curl -X POST http://localhost:3000/tools/get_balance \
  -H 'Content-Type: application/json' \
  -H 'X-Wallet-Id: <wallet-id>' \
  -H 'X-Wallet-Password: my-secret' \
  -d '{}'
```

**Example — swap SOL for USDC:**

```bash
curl -X POST http://localhost:3000/tools/swap_tokens \
  -H 'Content-Type: application/json' \
  -H 'X-Wallet-Id: <wallet-id>' \
  -H 'X-Wallet-Password: my-secret' \
  -d '{"outputMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "inputAmount": 0.1}'
```

### MCP (Claude Desktop)

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "agento": {
      "command": "node",
      "args": ["<path-to-agento>/dist/src/mcp.js"],
      "env": {
        "SOLANA_RPC_URL": "https://api.devnet.solana.com",
        "WALLET_ID": "<wallet-id>",
        "WALLET_PASSWORD": "<password>"
      }
    }
  }
}
```

---

## Demo: Single Agent

A LangGraph agent that tests all DeFi features — swaps, staking, limit orders, and lending.

```bash
# 1. Add to your .env:
#    WALLET_ID=<your-wallet-id>
#    WALLET_PASSWORD=<your-password>
#    OPENROUTER_API_KEY=<your-key>

# 2. Start the server
npx agento serve rest

# 3. Run the agent (separate terminal)
npm run demo
```

The agent auto-discovers all 18 tools and runs through:
1. Balance & price checks
2. Swap SOL → USDC
3. Stake SOL → jupSOL
4. Place a limit order, then cancel it
5. Lend USDC on Lulo, then withdraw

<!-- 📸 Screenshot: demo agent terminal output showing the test results -->

---

## Demo: Multiple Agents

Three agents, each with their own wallet, running DeFi strategies in parallel:

- **Trader** — swaps SOL for USDC
- **Staker** — stakes SOL for jupSOL
- **Lender** — swaps SOL → USDC → lends on Lulo

```bash
# 1. Create 3 wallets
npx agento wallet create --password pw1
npx agento wallet create --password pw2
npx agento wallet create --password pw3

# 2. Fund each wallet (~2 SOL each)
npx agento wallet fund <id1> --password pw1
npx agento wallet fund <id1> --password pw1
npx agento wallet fund <id2> --password pw2
npx agento wallet fund <id2> --password pw2
npx agento wallet fund <id3> --password pw3
npx agento wallet fund <id3> --password pw3

# 3. Add to .env:
#    AGENT1_WALLET_ID=<id1>
#    AGENT1_PASSWORD=pw1
#    AGENT2_WALLET_ID=<id2>
#    AGENT2_PASSWORD=pw2
#    AGENT3_WALLET_ID=<id3>
#    AGENT3_PASSWORD=pw3
#    OPENROUTER_API_KEY=<your-key>

# 4. Run
npx agento serve rest       # Terminal 1
npx agento monitor          # Terminal 2
npm run demo:multi           # Terminal 3
```

Watch all three agents' activity appear simultaneously in the monitor and dashboard.

<!-- 📸 Screenshot: agento monitor showing interleaved events from all 3 agents -->

---

## Guardrails

Safety rules enforced on every transaction. Configure in `guardrails.json`:

| Rule | Default |
|------|---------|
| Per-transaction limit | 1.0 SOL |
| Daily spending limit | 5.0 SOL |
| Balance floor | 0.05 SOL |
| Drain protection | 50% max per tx |
| Rate limit | 10 tx/min |
| Slippage cap | 500 bps (5%) |
| Token validation | Jupiter verified only |
| Address blocklist/allowlist | Configurable |

Read-only tools bypass guardrails. Only transactional tools are checked.

---

## Project Structure

```
agento/
├── src/
│   ├── cli.ts          # CLI (wallet, serve, monitor commands)
│   ├── config.ts       # Environment config (Zod)
│   ├── keystore.ts     # AES-256-GCM encrypted wallet storage
│   ├── wallet.ts       # Keypair + Connection manager
│   ├── tools.ts        # 18 tool definitions
│   ├── guardrails.ts   # 9 safety rules engine
│   ├── events.ts       # Event bus + SSE broadcasting
│   ├── mcp.ts          # MCP server (stdio)
│   ├── rest.ts         # REST server (Hono)
│   └── dashboard.html  # Web dashboard
├── demo/
│   ├── agent.ts        # Single-agent demo
│   └── multi-agent.ts  # Multi-agent demo
├── guardrails.json     # Safety configuration
├── SKILLS.md           # Agent-readable tool documentation
├── DEEP_DIVE.md        # Technical deep dive
└── .env.example        # Environment template
```

## Common Token Mints

| Token | Mint |
|-------|------|
| SOL | `So11111111111111111111111111111111111111112` |
| USDC | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| USDT | `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` |
| jupSOL | `jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v` |

---

## License

MIT
