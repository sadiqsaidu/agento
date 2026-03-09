# Building Agento: What If Your AI Agent Had Its Own Wallet?

*I built a wallet service that gives AI agents autonomous access to Solana DeFi — encrypted keystores, swaps, staking, lending, guardrails, and real-time monitoring. Here's exactly how it works.*

---

> **TL;DR** — Agento is a local wallet infrastructure layer that lets any AI agent (Claude, GPT, Gemini, local models) create wallets, sign transactions, and execute DeFi operations on Solana. It exposes 18 tools through REST and MCP, uses AES-256-GCM encrypted storage, and ships with a guardrail engine so your agent can't drain itself. 8 source files. No solana-agent-kit.

---

## The Problem Nobody's Really Solving

AI agents can reason, plan, and call tools. But what happens when you want an agent to *hold money* and *make financial decisions*?

The options today are bad:

**Option 1: solana-agent-kit.** A monolithic SDK that pulls in 1,300+ npm packages, has persistent ESM/CJS compatibility issues, and bundles everything from NFT minting to Metaplex. If all you need is wallets and DeFi, you're importing a freight train to carry a briefcase.

**Option 2: Build from scratch.** Every agent project re-implements wallet creation, transaction signing, Jupiter integration. The same 500 lines of boilerplate, copied between repos, each with its own subtle bugs.

**Option 3: Custodial APIs.** Hand your keys to a third party and hope for the best. In crypto. Not ideal.

What I wanted was something that doesn't exist: a clean, focused wallet *service* that any agent can talk to, regardless of which LLM or framework it uses. Something you clone, run, and point your agents at.

So I built Agento.

<!-- 📸 IMAGE: Architecture diagram showing the separation — Agent (LangGraph/Claude/any LLM) → Agento (REST/MCP) → Solana Blockchain + Jupiter + Lulo. Show the "wall" between agent logic and wallet infrastructure. -->

---

## The Core Idea: Separate Wallet From Agent

Most agent-wallet projects conflate two things: the intelligence layer (LLM, reasoning, planning) and the wallet layer (keys, signing, transactions). Agento splits them cleanly.

Agento is not a library you `import` into your agent. It's a **service** your agent connects to. This separation buys you several things:

- **Any LLM works.** Claude, GPT-4o, Gemini, Llama, DeepSeek — if it can call functions, it can use Agento. Switch models without touching wallet code.
- **Any framework works.** LangChain, LangGraph, Vercel AI SDK, raw OpenAI function calls, or a 30-line script. It's HTTP.
- **Keys stay isolated.** The agent process never sees private keys. The wallet service handles all cryptography. A compromised agent can't exfiltrate keys because it never had them.
- **Multiple agents, one service.** Three agents can each have their own wallet, all managed by one Agento instance. Each authenticates with its own wallet ID and password.

Agento exposes 18 tools through two interfaces:

- **REST API** — standard HTTP via Hono. `POST /tools/:name` with wallet credentials in headers. Works with any language.
- **MCP (Model Context Protocol)** — stdio transport for Claude Desktop and native MCP clients. Same tools, different wire format.

<!-- 📸 IMAGE: Terminal screenshot of Agento starting up — the ASCII banner, 18 tools listed, REST server ready on port 3000. -->

---

## How the Encrypted Keystore Works

If the wallet storage isn't right, nothing else matters. This is the foundation.

I adapted the **Ethereum Web3 Secret Storage V3** format for Solana. It's a battle-tested standard from Ethereum (used by MetaMask, Geth, and every major wallet), transplanted to work with Solana's Ed25519 keypairs. Each wallet becomes a JSON file encrypted with:

- **KDF:** scrypt with N=2¹⁸ (262,144 iterations), r=8, p=1 — deliberately expensive. At these parameters, deriving one key takes ~200ms on modern hardware. An attacker trying to brute-force passwords processes maybe 5 guesses per second per core.
- **Cipher:** AES-256-GCM with a random 12-byte IV.
- **Authentication:** GCM's built-in authentication tag — no separate HMAC needed.

The lifecycle of a wallet:

```
Create:  Keypair.generate() → scrypt(password, salt) → AES-GCM encrypt → UUID.json
Unlock:  Read UUID.json → scrypt(password, salt) → AES-GCM decrypt → Keypair
```

A stored wallet looks like this:

```json
{
  "version": 3,
  "id": "574a67d8-a1f2-4b3c-9e12-8f0a1b2c3d4e",
  "address": "6Rx57VKPkj3...",
  "crypto": {
    "cipher": "aes-256-gcm",
    "cipherparams": { "iv": "a1b2c3d4e5f6a1b2c3d4e5f6" },
    "ciphertext": "...",
    "authtag": "...",
    "kdf": "scrypt",
    "kdfparams": {
      "dklen": 32, "n": 262144, "r": 8, "p": 1,
      "salt": "..."
    }
  },
  "created_at": "2025-01-15T09:27:45.604Z"
}
```

Some deliberate design choices:

**Why not just store the base58 key?** A file system breach = total loss. With scrypt + AES-256-GCM, an attacker who reads the file still needs the password.

**Why scrypt over argon2?** Node.js ships `scryptSync` natively in the `crypto` module. Zero extra dependencies. Argon2 would require a native C addon, complicating installs. For our use case (wallet encryption, not high-traffic auth), scrypt with N=2¹⁸ is more than sufficient.

**Why GCM over CBC?** GCM is *authenticated encryption* — it handles confidentiality and integrity in one pass. CBC requires a separate HMAC step, and there's an entire class of padding oracle attacks that GCM sidesteps entirely.

The entire keystore — create, import, unlock, list, delete, export — is 175 lines of TypeScript.

<!-- 📸 IMAGE: Visual diagram of the encryption flow: Password → scrypt (with salt) → Derived Key → AES-256-GCM (with IV) → Encrypted Wallet File. Show the components flowing left to right. -->

---

## 18 Tools, Zero SDK Dependencies

Agento ships 18 tools organized into four categories:

### Wallet Management (10 tools)
`create_wallet` · `get_wallet_address` · `get_balance` · `get_token_balances` · `transfer` · `list_wallets` · `request_airdrop` · `import_wallet` · `export_wallet` · `delete_wallet`

### Jupiter Trading (5 tools)
`swap_tokens` · `fetch_token_price` · `create_limit_order` · `cancel_limit_orders` · `get_open_orders`

### Jupiter Staking (1 tool)
`stake_sol` — liquid-stake SOL into jupSOL (yield-bearing)

### Lulo Lending (2 tools)
`lend_asset` · `withdraw_lend` — aggregated yield across Kamino, Drift, MarginFi, and Jupiter

Every tool follows the same pattern — a Zod schema for input validation, a description the LLM reads, and an execute function:

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
    // 1. Get quote from Jupiter API
    // 2. Build swap transaction
    // 3. Sign with wallet keypair
    // 4. Submit to Solana
    // 5. Return transaction signature
  },
};
```

The `ALL_TOOLS` array is the **single source of truth**. Both the MCP server and REST server iterate over it to register endpoints. Add a tool to the array → instantly available on both interfaces. No duplication, no registration boilerplate.

### Why No solana-agent-kit?

Every external API call is a direct `fetch()`. Jupiter quotes go to `api.jup.ag/swap/v1/quote`. Lulo deposits go to `api.flexlend.fi`. Token prices hit DexScreener's free API with Jupiter as a fallback.

No wrapper SDKs. No abstraction layers. When Jupiter changes an API endpoint, you update one URL string — not an npm dependency tree.

The entire tool implementation is 584 lines. That covers every swap, limit order, staking, lending, transfer, and wallet operation Agento supports.

<!-- 📸 IMAGE: Code editor screenshot showing the tools.ts file — the clean structure of a ToolDef with name, schema, and execute function. Focus on the swap_tokens tool as a representative example. -->

---

## The Guardrails Engine: Why Agents Need Safety Rails

Here's what happened the first time I gave an agent autonomous wallet access without guardrails: it tried to swap my entire balance in one transaction. Agents optimize for completing tasks. They don't have a natural sense of "maybe I shouldn't move all the money at once."

Agento's guardrail engine runs **before** every transactional operation. Read-only tools (balance checks, price queries, listing wallets) bypass it entirely — no point adding latency to a read.

Nine rules, all configurable:

| Rule | What It Catches | Default |
|------|----------------|---------|
| **Per-tx spending limit** | Single transaction too large | 1.0 SOL |
| **Daily spending limit** | Rolling 24h total exceeded | 5.0 SOL |
| **Balance floor** | Would leave wallet too empty for fees | 0.05 SOL |
| **Drain protection** | Single tx moving too much of total balance | 50% max |
| **Rate limiting** | Too many transactions too fast | 10/min |
| **Slippage cap** | Swap slippage too high (front-run risk) | 5% (500 bps) |
| **Token validation** | Swap involves unverified token | Jupiter verified only |
| **Address blocklist** | Transfer to known-bad address | Empty |
| **Address allowlist** | Transfer to non-approved address | Empty (disabled) |

The configuration lives in `guardrails.json`:

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

When a guardrail blocks an action, three things happen:

1. The tool returns an error with the **rule name** and **human-readable reason** — so the agent can understand *why* and adjust.
2. An event is emitted with `status: "blocked"` — so the operator sees it in the monitor and dashboard.
3. The transaction is logged in the in-memory ledger — so future guardrail checks (daily totals, rate limits) have accurate data.

The entire guardrails engine is 222 lines. No rule engine frameworks. Just functions.

<!-- 📸 IMAGE: Terminal showing a guardrail in action — agent tries to swap too much, gets a "drain_protection" denial, then retries with a smaller amount and succeeds. Show the colored CLI monitor output. -->

---

## Real-Time Monitoring: Watching Your Agent Think

Every tool execution — success, error, or blocked — emits an event through a central event bus. This is how you watch what your agents are doing.

An event looks like:

```json
{
  "timestamp": "2025-01-15T04:06:35.295Z",
  "tool": "swap_tokens",
  "wallet": "e4acef41",
  "status": "success",
  "durationMs": 2491,
  "summary": "Swapped 0.5 → sig:4Vu8kZ2…",
  "source": "rest"
}
```

Three ways to consume events:

**1. CLI Monitor** — `npx agento monitor` connects via SSE and live-tails events with color-coded status and emoji. Green checkmarks for success, red crosses for errors, yellow shields for guardrail blocks.

**2. Web Dashboard** — a built-in dark-themed dashboard at `/dashboard` with live activity feed, wallet sidebar, and stats counters. Single HTML file, no build step, no React.

**3. Programmatic** — `GET /events` returns a standard Server-Sent Events stream. Build your own monitoring on top.

The event bus buffers the last 500 events, so new clients get recent history immediately instead of staring at a blank screen.

<!-- 📸 IMAGE: Side-by-side screenshot — left: terminal running `agento monitor` with colored events streaming. Right: the web dashboard showing the same events in the activity feed with wallet sidebar visible. -->

---

## The CLI: ASCII Art and All

Agento ships with a full CLI. It handles wallet management, server startup, and live monitoring from the terminal.

```
   █████╗  ██████╗ ███████╗███╗   ██╗████████╗ ██████╗
  ██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝██╔═══██╗
  ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ██║   ██║
  ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ██║   ██║
  ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ╚██████╔╝
  ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝    ╚═════╝
```

Commands:

- **`agento wallet create/list/info/fund/import/export/delete`** — manage wallets from the terminal
- **`agento serve rest`** — start the REST API (includes dashboard at `/dashboard`)
- **`agento serve mcp`** — start the MCP stdio server for Claude Desktop
- **`agento monitor`** — live-tail events from any running Agento instance

The wallet commands let you set everything up before an agent ever connects. Create wallets, fund them with devnet SOL, verify balances — all from the command line. Then start the server and let the agent take over.

<!-- 📸 IMAGE: Terminal screenshot of `agento wallet list` showing 2-3 wallets with addresses and creation dates, followed by `agento serve rest` starting up. -->

---

## Demo: A LangGraph Agent Running DeFi Operations

Talk is cheap. Here's what it looks like when an actual AI agent uses Agento.

The demo agent is built with LangGraph and connects to Agento over REST. It auto-discovers available tools by fetching `GET /tools`, wraps them into a single `agento` function-calling tool, and lets the LLM decide what to do.

```
🎯 Task: Check my SOL balance and the current price of SOL

  🔧 agento({ tool: "get_balance", params: {} })
  ✅ 2.0 SOL

  🔧 agento({ tool: "fetch_token_price", params: { mint: "So11..." } })
  ✅ $178.45 (dexscreener)

🤖 Your wallet holds 2.0 SOL, worth approximately $356.90 at the current price.
```

The multi-agent demo goes further: three agents (Trader, Staker, Lender) each with their own wallet, running in parallel via `Promise.all()`. The Trader swaps SOL for USDC. The Staker converts SOL to jupSOL. The Lender swaps to USDC and lends it on Lulo for yield. Each agent reasons independently, uses different DeFi protocols, and all run against one Agento instance.

<!-- 📸 IMAGE: Terminal showing the multi-agent demo running — three agents starting in parallel, each performing their DeFi operations with tool calls and results visible. -->

---

## How an Agent Discovers Tools

Agento includes a `SKILLS.md` file — a Markdown document that describes every tool, common token mints, guardrail rules, and example workflows in a format LLMs can parse naturally.

But agents can also discover tools programmatically. `GET /tools` returns the full tool registry:

```bash
curl http://localhost:3000/tools | jq '.tools[].name'
```

```
"create_wallet"
"get_wallet_address"
"get_balance"
...
"lend_asset"
"withdraw_lend"
```

The demo agents use this approach: fetch the tool list at startup, construct a generic tool caller, and let the LLM figure out which tools to invoke based on the task. No hardcoded tool definitions in the agent code.

This means if you add a new tool to Agento, every connected agent picks it up automatically on next startup. No agent code changes needed.

---

## What Makes This Different

A few things I think are worth highlighting:

### 1. The Keystore Is Actually Secure

Most agent-wallet projects store private keys in plaintext, environment variables, or at best base64. Agento uses production-grade encryption (scrypt + AES-256-GCM) based on a standard that secures millions of Ethereum wallets. It's the same encryption you'd use for a human wallet — because an agent's money is just as real.

### 2. Guardrails Are First-Class, Not Afterthoughts

The guardrail engine isn't a plugin or a wrapper. It's wired into the tool execution pipeline — every transactional tool passes through it before the transaction hits the blockchain. You can't accidentally bypass it. This is the difference between "we added safety" and "safety is structural."

### 3. Framework Agnostic by Design

Agento doesn't care what LLM you use or what framework your agent is built with. LangChain, LangGraph, Vercel AI SDK, raw OpenAI function calls, a bash script with `curl` — if it can make HTTP requests, it can use Agento. This was a deliberate choice: wallet infrastructure should outlive any particular AI framework.

### 4. Observable by Default

Every tool call, every success, every failure, every guardrail block — all emitted as structured events in real-time. The CLI monitor, web dashboard, and SSE stream aren't add-ons. They're built into the core. If you can't watch your agent in real-time, you're not ready for autonomous operations.

### 5. Minimal by Choice

8 source files. ~2,100 lines of TypeScript. No solana-agent-kit. No wrapper SDKs. Every API call is a direct `fetch()`. When something breaks, you can read the entire codebase in an afternoon and find the issue. Simplicity is a feature.

---

## The Numbers

| Metric | Value |
|--------|-------|
| Source files | 8 |
| Lines of TypeScript | ~2,100 |
| Tools | 18 |
| Guardrail rules | 9 |
| Keystore encryption | AES-256-GCM + scrypt (N=2¹⁸) |
| Interfaces | 2 (REST + MCP) |
| External APIs | Jupiter, Lulo/Flexlend, DexScreener |
| Frameworks required | None (agents use any) |

---

## Try It

```bash
git clone https://github.com/sadiqsaidu/agento.git
cd agento
npm install && npm run build

# Create a wallet and start the server
npx agento wallet create -p my-secret
npx agento serve rest

# In another terminal — watch the agent
npx agento monitor
```

Point your agent at `http://localhost:3000` and let it discover tools, create wallets, and start trading.

**GitHub:** [github.com/sadiqsaidu/agento](https://github.com/sadiqsaidu/agento)

---

*Agento is MIT licensed. Built with TypeScript, Hono, @solana/web3.js, and the belief that AI agents deserve wallet infrastructure as good as what humans get.*
