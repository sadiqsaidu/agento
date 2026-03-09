# Building Agento: Phantom for AI Agents on Solana

*How I built a zero-dependency agentic wallet service that gives AI agents autonomous access to Solana DeFi — swaps, limit orders, staking, lending, and more.*

---

> **TL;DR** — Agento is a wallet infrastructure layer that lets any AI agent (Claude, GPT, Gemini, local models) manage Solana wallets and execute DeFi operations through two interfaces: MCP (Model Context Protocol) and REST. No solana-agent-kit. No bloat. 8 source files, 209 npm packages, 18 tools.

---

## The Problem

AI agents are getting good at *reasoning*. They can plan multi-step tasks, call tools, and adapt to failures. But the moment you want an agent to interact with a blockchain, things fall apart.

The existing options are:

1. **solana-agent-kit** — a monolithic SDK that drags in 1,300+ npm packages, has constant ESM/CJS compatibility issues, and tries to do everything from NFT minting to Metaplex operations. If all you need is wallet management and DeFi, you're importing a small country.

2. **Build from scratch every time** — every new agent project re-implements wallet creation, transaction signing, and Jupiter integration. Copy-paste engineering across projects.

3. **Custodial APIs** — hand your keys to a third party. No thanks.

What I wanted was something that doesn't exist yet: a clean, focused wallet *service* that any agent can connect to — regardless of what LLM it's running or what framework it uses.

<!-- 📸 IMAGE: Screenshot of `npm ls` showing the small dependency tree (209 packages) vs SAK's 1300+ -->

---

## The Design: A Wallet Service, Not an SDK

The key insight is separating the **wallet infrastructure** from the **agent logic**.

Agento is not a library you import into your agent. It's a service your agent *connects to*. This matters because:

- **Any LLM works.** Claude, GPT-4, Gemini, Llama, whatever local model you're running. If it can call functions, it can use Agento.
- **Any framework works.** LangChain, Vercel AI SDK, AutoGPT, raw OpenAI function calling, or a 50-line Python script. It's just HTTP.
- **Keys stay isolated.** The agent process never holds private keys. The wallet service handles all cryptographic operations.
- **Multiple agents can share one service.** Deploy it once, point your agents at it.

Agento exposes the same 18 tools through two interfaces:

- **MCP (Model Context Protocol)** — stdio transport. Ideal for Claude Desktop and LangChain MCP adapters. The agent spawns Agento as a subprocess and communicates over stdin/stdout.
- **REST API** — standard HTTP. Works with literally anything. Create wallets, execute tools, stream events via SSE.

<!-- 📸 IMAGE: Diagram showing Agent → Agento (MCP or REST) → Solana, with the dual-interface clearly illustrated -->

---

## The Encrypted Keystore

This is the foundation everything else is built on. If the wallet storage isn't right, nothing else matters.

I adapted the **Ethereum Web3 Secret Storage V3** format for Solana. Each wallet is a JSON file encrypted with:

- **KDF:** scrypt with N=2¹⁸ (262,144), r=8, p=1 — deliberately expensive to make brute-force attacks impractical
- **Cipher:** AES-256-GCM with a random 12-byte IV
- **MAC:** Inherent in GCM's authentication tag — no separate HMAC needed

The flow:

1. Generate a Solana keypair (`Keypair.generate()`)
2. Derive a 32-byte encryption key from the user's password using scrypt
3. Encrypt the 64-byte secret key with AES-256-GCM
4. Store as `<uuid>.json` in the keystore directory

To unlock: reverse the process. Scrypt the password → AES-GCM decrypt → reconstruct the Keypair.

Here's what a wallet file looks like:

```json
{
  "version": 3,
  "id": "574a67d8-a1f2-4b3c-9e12-8f0a1b2c3d4e",
  "address": "6Rx57VKP...",
  "crypto": {
    "cipher": "aes-256-gcm",
    "cipherparams": { "iv": "a1b2c3d4e5f6a1b2c3d4e5f6" },
    "ciphertext": "...",
    "authtag": "...",
    "kdf": "scrypt",
    "kdfparams": {
      "dklen": 32,
      "n": 262144,
      "r": 8,
      "p": 1,
      "salt": "..."
    }
  },
  "created_at": "2026-03-06T09:27:45.604Z"
}
```

Why this approach over alternatives:

- **Why not just store the base58 key?** Because then a file system breach = total loss. With scrypt + AES-256-GCM, an attacker needs the password too.
- **Why scrypt over argon2?** Node.js `crypto` module ships scrypt natively — zero extra dependencies. Argon2 requires a native addon.
- **Why GCM over CBC?** GCM provides authenticated encryption. With CBC you need a separate HMAC step, and there's a class of padding oracle attacks. GCM handles integrity + confidentiality in one pass.

The entire keystore implementation is 175 lines.

<!-- 📸 IMAGE: Code snippet of the encrypt/decrypt functions, or a visual showing the KDF → AES-GCM → JSON flow -->

---

## The Tool System

Agento ships 18 tools organized into four categories:

### Wallet Management (10 tools)
`create_wallet` · `get_wallet_address` · `get_balance` · `get_token_balances` · `transfer` · `list_wallets` · `request_airdrop` · `import_wallet` · `export_wallet` · `delete_wallet`

### Jupiter Trading (5 tools)
`swap_tokens` · `fetch_token_price` · `create_limit_order` · `cancel_limit_orders` · `get_open_orders`

### Jupiter Staking (1 tool)
`stake_sol` — liquid-stake SOL → jupSOL

### Lulo Lending (2 tools)
`lend_asset` · `withdraw_lend` — aggregated lending across Kamino, Drift, MarginFi, Jupiter

Each tool is defined with a Zod schema for input validation, a description for the LLM, and an execute function:

```typescript
export const swapTokens: ToolDef = {
  name: "swap_tokens",
  description: "Swap tokens using Jupiter Exchange...",
  schema: z.object({
    outputMint: z.string(),
    inputAmount: z.number().positive(),
    inputMint: z.string().optional(),
    slippageBps: z.number().optional(),
  }),
  execute: async (input, ctx) => {
    // 1. Get quote from Jupiter
    // 2. Get swap transaction
    // 3. Sign with wallet keypair
    // 4. Submit to Solana
    // 5. Return signature
  },
};
```

The `ALL_TOOLS` array is the single source of truth. Both the MCP server and REST server iterate over it to register endpoints. Add a tool to the array, and it's instantly available on both interfaces.

### No solana-agent-kit

Every API call is direct HTTP. Jupiter quotes? `fetch()` to `api.jup.ag/swap/v1/quote`. Lulo deposits? `fetch()` to `api.flexlend.fi`. Token prices? DexScreener's free API with a Jupiter fallback.

The entire tool implementation is 584 lines — including every swap, limit order, staking, lending, transfer, and wallet management operation.

<!-- 📸 IMAGE: Terminal screenshot showing `npx @onetutuone/agento serve rest` starting with the 18 tools listed -->

---

## The Guardrails Engine

Giving an AI agent autonomous access to a wallet is terrifying without safety rails. Agento includes a guardrail engine that runs *before* every transactional operation.

The engine enforces 9 safety rules:

| Rule | What It Does | Default |
|------|-------------|---------|
| **Per-tx spending limit** | Blocks any single tx exceeding a SOL threshold | 1.0 SOL |
| **Daily spending limit** | Blocks when rolling 24h total would exceed limit | 5.0 SOL |
| **Balance floor** | Prevents wallet from dropping below a minimum (for fees) | 0.05 SOL |
| **Drain protection** | Blocks if a single tx moves >X% of total balance | 50% |
| **Rate limiting** | Max on-chain transactions per minute per wallet | 10/min |
| **Slippage cap** | Hard maximum slippage for swaps, regardless of agent request | 500 bps (5%) |
| **Token validation** | Only allows swaps involving Jupiter-verified tokens | Enabled |
| **Address blocklist** | Blocks transfers to known-bad addresses | Empty |
| **Address allowlist** | If set, only permits transfers to these addresses | Empty |

The critical thing: read-only tools (balance checks, price queries, listing wallets) bypass guardrails entirely. Only tools that move money get checked.

The guardrail config lives in `guardrails.json` at the project root:

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

When a guardrail blocks an action, the event is emitted with `status: "blocked"` so operators can see it in the dashboard and the CLI monitor. The response includes the rule name and a human-readable reason so the agent can understand *why* it was blocked and adjust.

The entire guardrails engine is 222 lines. No frameworks, no rule engines — just functions.

<!-- 📸 IMAGE: Dashboard screenshot showing a blocked event (yellow shield icon) alongside successful events -->

---

## The Event System & Real-Time Monitoring

Every tool execution — success, error, or blocked — emits an event through a central event bus. This powers three things:

1. **CLI Monitor** — `agento monitor` connects via SSE and live-tails events in your terminal
2. **Dashboard** — a built-in web dashboard at `/dashboard` with real-time updates
3. **Programmatic access** — `GET /events` returns a Server-Sent Events stream any client can consume

An event looks like:

```json
{
  "timestamp": "2026-03-09T04:06:35.295Z",
  "tool": "get_balance",
  "wallet": "e4acef41",
  "status": "success",
  "durationMs": 2491,
  "summary": "0 SOL",
  "source": "rest"
}
```

The event bus buffers the last 500 events, so when a new SSE client connects, it gets recent history immediately — no "staring at a blank screen" problem.

<!-- 📸 IMAGE: Side-by-side of the CLI monitor output (terminal with colored emoji) and the web dashboard -->

---

## The Dashboard

Agento ships with a built-in dark-themed dashboard inspired by Phantom wallet's aesthetic. It's a single HTML file (no build step, no React, no framework) served at `/dashboard` when you run the REST server.

Features:
- **Wallet sidebar** — lists all wallets with truncated addresses and creation dates
- **Stats bar** — live counters for success/blocked/errors/average response time
- **Activity feed** — real-time SSE-powered event stream with color-coded status icons
- **Connection indicator** — shows whether the SSE connection is active

The entire dashboard is ~345 lines of HTML + inline CSS + inline JS. It connects to the same `/events` SSE endpoint and `/wallets` REST endpoint that any agent would use.

Why a single HTML file? Because it gets bundled into the npm package and served from memory — zero static file serving complexity, zero build tooling, zero external CDN dependencies.

<!-- 📸 IMAGE: Full screenshot of the Agento dashboard showing wallets in the sidebar, stats bar, and live activity feed -->

---

## The CLI

Agento includes a CLI that ships as the `agento` binary when you install the npm package. It handles wallet management, server startup, and live monitoring.

```
   █████╗  ██████╗ ███████╗███╗   ██╗████████╗ ██████╗
  ██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝██╔═══██╗
  ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ██║   ██║
  ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ██║   ██║
  ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ╚██████╔╝
  ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝    ╚═════╝

  Agentic wallet infrastructure for AI agents on Solana
  v0.1.1
```

Three command groups:

- **`agento wallet`** — create, list, info, fund, import, export, delete wallets directly from the terminal
- **`agento serve rest`** — start the REST API server (includes dashboard)
- **`agento serve mcp`** — start the MCP stdio server for Claude Desktop
- **`agento monitor`** — live-tail agent activity from any running Agento instance (local or remote)

The `monitor` command is particularly useful in production: you can point it at a remote Agento deployment and watch agent activity in real-time:

```bash
agento monitor --host https://agento-8m72.onrender.com
```

<!-- 📸 IMAGE: Terminal screenshot of `agento help` showing the full CLI output with colored commands -->

---

## The Python Agent Demo

To prove Agento works with any language and framework, I built a standalone Python agent that connects to a live Agento deployment purely over HTTP.

The agent:

1. **Auto-discovers tools** — fetches `GET /tools` and converts them into OpenAI function-calling format
2. **Uses any LLM** — via OpenRouter (GPT-4o-mini by default, but any model works)
3. **Manages wallets autonomously** — creates wallets, requests airdrops, checks balances, executes swaps
4. **Supports interactive mode** — `python agent.py -i` drops you into a conversational loop with the agent

The entire agent is 190 lines of Python. No Agento-specific SDK — just `httpx` for HTTP and `openai` for LLM calls.

```bash
🌐 Agento: https://agento-8m72.onrender.com
🧠 Model:  openai/gpt-4o-mini
✅ Agento is reachable.
🔧 Discovered 18 tools.

🎯 Task: Create a new wallet, airdrop 2 SOL, then check the balance.

  🔧 create_wallet({})
  ✅ {"success":true,"result":{"wallet_id":"38ab230d-...","address":"3dWF..."}}
  📝 Active wallet → 38ab230d…
  🔧 request_airdrop({"amount": 2})
  ✅ {"success":true,"result":{"signature":"4Vu8...","amount":2}}
  🔧 get_balance({})
  ✅ {"success":true,"result":{"address":"3dWF...","balance_sol":2}}

🤖 Done! Created wallet 3dWF…, airdropped 2 SOL, balance confirmed at 2 SOL.
```

This is the whole point: **the agent doesn't know or care that Agento is written in TypeScript**. It just calls HTTP endpoints.

<!-- 📸 IMAGE: Terminal screenshot of the Python agent running through the wallet creation → airdrop → balance check flow -->

---

## Deployment

Agento is deployed on Render and published to npm:

- **Live API:** `https://agento-8m72.onrender.com`
- **npm:** `npx @onetutuone/agento`
- **Dashboard:** `https://agento-8m72.onrender.com/dashboard`

For self-hosting, it's a single command:

```bash
npx @onetutuone/agento serve rest
```

That installs the package, starts the REST server, opens the dashboard — done.

For Render/Railway/Fly.io, the `render.yaml` is included:

```yaml
services:
  - type: web
    name: agento
    runtime: node
    buildCommand: npm install && npm run build
    startCommand: npm start
    envVars:
      - key: SOLANA_RPC_URL
        value: https://api.devnet.solana.com
```

<!-- 📸 IMAGE: The Render dashboard showing the agento service running, or `curl` hitting the live health endpoint -->

---

## What I Learned

### 1. MCP is the future for agent tooling

The Model Context Protocol standardizes how AI agents discover and call tools. Instead of every agent framework having its own tool format, MCP provides one protocol that works across Claude, LangChain, and any future MCP-compatible agent. Building with both MCP and REST from day one means Agento works regardless of how the agent ecosystem evolves.

### 2. Direct API calls beat SDKs for focused use cases

solana-agent-kit tries to wrap everything — NFTs, Metaplex, Tensor, Tiplinks, token launching — into one SDK. If you only need DeFi operations, the overhead is absurd. Direct `fetch()` calls to Jupiter and Lulo APIs are simpler, more maintainable, and result in 209 packages instead of 1,300+.

### 3. Guardrails are not optional

The first time I let an agent autonomously swap tokens without any safety limits, it tried to swap my entire balance. Guardrails need to be first-class — not bolted on after. Drain protection, rate limiting, and spending caps should be in place before any agent gets wallet access.

### 4. Observability matters as much as functionality

If you can't see what your agents are doing, you can't trust them. The event system, CLI monitor, and dashboard aren't nice-to-haves — they're how you verify your agent isn't doing something catastrophically stupid at 3 AM.

---

## The Numbers

| Metric | Value |
|--------|-------|
| Source files | 8 |
| Lines of TypeScript | ~2,100 |
| npm dependencies | 209 packages |
| Tools | 18 |
| Guardrail rules | 9 |
| Keystore encryption | AES-256-GCM + scrypt |
| Build output | 117.8 kB unpacked |
| Interfaces | 2 (MCP + REST) |
| External APIs | Jupiter, Lulo/Flexlend, DexScreener |

---

## Try It

```bash
# Install and run
npx @onetutuone/agento serve rest

# Create a wallet
curl -X POST http://localhost:3000/wallets -H 'Content-Type: application/json' \
  -d '{"password": "my-secret"}'

# Check the dashboard
open http://localhost:3000/dashboard
```

Or hit the live deployment: [https://agento-8m72.onrender.com/dashboard](https://agento-8m72.onrender.com/dashboard)

**GitHub:** [github.com/sadiqsaidu/agento](https://github.com/sadiqsaidu/agento)
**npm:** [@onetutuone/agento](https://www.npmjs.com/package/@onetutuone/agento)

---

*Agento is MIT licensed. Built with TypeScript, Hono, @solana/web3.js, and zero regrets about not using solana-agent-kit.*
