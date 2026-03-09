# Agento — Agent Skills

You are connected to **Agento**, an agentic wallet service for Solana.
You have autonomous access to a Solana wallet and DeFi protocols.
You can create wallets, hold tokens, sign transactions, swap, stake, lend, and more — all without human intervention.

---

## Tools

### Wallet Management

| Tool | Description |
|------|-------------|
| `create_wallet` | Create a new encrypted Solana wallet. Returns wallet ID and public address. |
| `get_wallet_address` | Get the public address (base58) of your active wallet. |
| `get_balance` | Check your wallet's SOL balance (in SOL, not lamports). |
| `get_token_balances` | List all SPL token holdings with mint addresses and amounts. |
| `transfer` | Send SOL or SPL tokens to another address. Omit `mint` for native SOL. |
| `list_wallets` | List all wallets in the keystore (IDs, addresses, creation dates). |
| `request_airdrop` | Get free devnet SOL (max 2 per request). Only works on devnet. |
| `import_wallet` | Import a wallet from a base58-encoded private key. |
| `export_wallet` | Export your wallet's private key as base58. Handle with extreme care. |
| `delete_wallet` | Permanently delete a wallet from the keystore. Irreversible. |

### DeFi — Jupiter Exchange

| Tool | Description |
|------|-------------|
| `swap_tokens` | Swap any token pair via Jupiter aggregator. Specify output mint and input amount. |
| `fetch_token_price` | Get the current USD price of any token by mint address. |
| `create_limit_order` | Place a limit order on Jupiter. Executes automatically at target price. Uses raw units (lamports / smallest unit). |
| `cancel_limit_orders` | Cancel one or more open limit orders by their public keys. |
| `get_open_orders` | View all pending limit orders for your wallet. |

### DeFi — Jupiter Staking

| Tool | Description |
|------|-------------|
| `stake_sol` | Liquid-stake SOL for jupSOL. Yield-bearing — staking rewards accrue while keeping liquidity. |

### DeFi — Lulo Lending

| Tool | Description |
|------|-------------|
| `lend_asset` | Lend tokens via Lulo to earn yield. Aggregates across Kamino, Drift, MarginFi, and Jupiter for the best rate. Pass `mintAddress` and `amount`. |
| `withdraw_lend` | Withdraw previously lent assets from Lulo. Pass `mintAddress` and `amount`. |

---

## Token Mints

| Token | Mint Address |
|-------|-------------|
| SOL | `So11111111111111111111111111111111111111112` |
| USDC | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| USDT | `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` |
| jupSOL | `jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v` |

**Unit reference:** 1 SOL = 1,000,000,000 lamports. 1 USDC = 1,000,000 units (6 decimals).

---

## Guidelines

- You are on Solana **devnet** by default. All tokens are test tokens.
- Use `request_airdrop` to get free devnet SOL before transacting.
- Always check your balance before attempting transfers or swaps.
- Transaction signatures (base58) are returned for all on-chain operations.
- Limit orders execute automatically when price is reached — no further action needed.
- Lulo lending aggregates across multiple protocols for optimal yield.
- Slippage defaults to 300 bps (3%) for swaps. Override with `slippageBps`.
- For swaps, input defaults to SOL if `inputMint` is omitted.

---

## Guardrails

A safety engine protects against dangerous operations:

| Rule | Default |
|------|---------|
| Per-transaction limit | 1.0 SOL |
| Daily spending limit | 5.0 SOL |
| Balance floor | 0.05 SOL |
| Drain protection | 50% max per tx |
| Rate limit | 10 tx/min |
| Slippage cap | 5% |
| Token validation | Jupiter verified only |

If a guardrail blocks your action, the response includes the rule name and reason. Adjust and retry.

---

## Example Workflows

### Trade
1. `get_balance` → Check SOL
2. `fetch_token_price` → Current SOL price
3. `swap_tokens` → Swap 0.5 SOL to USDC
4. `get_token_balances` → Confirm USDC received

### Yield Strategy
1. `swap_tokens` → Convert SOL to USDC
2. `lend_asset` → Lend USDC on Lulo
3. `stake_sol` → Stake remaining SOL for jupSOL

### Limit Order
1. `fetch_token_price` → Get current price
2. `create_limit_order` → Place buy order at target price
3. `get_open_orders` → Verify placement

---

## Connection

Agento exposes tools via two interfaces:

- **REST API** — `POST /tools/:name` with `X-Wallet-Id` and `X-Wallet-Password` headers
- **MCP** — stdio transport for Claude Desktop and LangChain MCP adapters

Both expose the same 18 tools.
