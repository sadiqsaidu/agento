# Agento — Agent Skills

You are connected to **Agento**, an agentic wallet service for Solana.
Agento gives you autonomous access to a Solana wallet and DeFi protocols.
You can create wallets, hold tokens, sign transactions, swap, stake, lend, and more — all without human intervention.

---

## Available Tools

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
| `create_limit_order` | Place a limit order on Jupiter. Executes automatically at target price. |
| `cancel_limit_orders` | Cancel one or more open limit orders by their public keys. |
| `get_open_orders` | View all pending limit orders for your wallet. |

### DeFi — Jupiter Staking

| Tool | Description |
|------|-------------|
| `stake_sol` | Liquid-stake SOL for jupSOL. jupSOL is yield-bearing — you earn staking rewards while keeping liquidity. |

### DeFi — Lulo Lending

| Tool | Description |
|------|-------------|
| `lend_asset` | Lend tokens via Lulo to earn yield. Lulo aggregates across Kamino, Drift, MarginFi, and Jupiter for the best rate. |
| `withdraw_lend` | Withdraw previously lent assets from Lulo. |

---

## Common Token Mints (Solana)

| Token | Mint Address |
|-------|-------------|
| SOL | `So11111111111111111111111111111111111111112` |
| USDC | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| USDT | `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` |
| jupSOL | `jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v` |

---

## Usage Notes

- You are operating on Solana **devnet** by default. All tokens are test tokens with no real value.
- Use `request_airdrop` to fund your wallet with devnet SOL before attempting any transactions.
- Always check your balance before attempting transfers or swaps to avoid failures.
- Transaction signatures (base58 strings) are returned for all on-chain operations — use these for verification on a block explorer.
- Limit orders on Jupiter execute automatically when the market price reaches your target — no further action needed after placement.
- Lulo lending aggregates across multiple lending protocols to find the optimal yield. Deposited funds can be withdrawn at any time.
- When swapping tokens, you only need to specify the output mint and input amount. Input defaults to SOL unless specified.
- Slippage tolerance defaults to 300 basis points (3%) for swaps. You can override this with the `slippageBps` parameter.

---

## Example Workflows

### Fund Wallet & Trade
1. `request_airdrop` → Get 1 SOL on devnet
2. `get_balance` → Verify the airdrop landed
3. `fetch_token_price` (SOL mint) → Check current SOL price
4. `swap_tokens` → Swap 0.5 SOL to USDC
5. `get_token_balances` → Confirm USDC received

### Yield Strategy
1. `swap_tokens` → Convert some SOL to USDC
2. `lend_asset` → Lend USDC on Lulo for yield
3. `stake_sol` → Stake remaining SOL for jupSOL (staking yield)

### Limit Order Trading
1. `fetch_token_price` → Get current price of target token
2. `create_limit_order` → Place a buy order at a lower price
3. `get_open_orders` → Verify the order was placed
4. *(order executes automatically when price is reached)*

### Portfolio Monitoring
1. `get_balance` → Check SOL balance
2. `get_token_balances` → List all token holdings
3. `fetch_token_price` for each token → Get USD values
4. Compute total portfolio value

---

## Connection Methods

Agento exposes tools via two interfaces:

- **MCP (Model Context Protocol)** — stdio transport, ideal for Claude Desktop and LangChain MCP adapters
- **REST API** — HTTP interface, works with any agent framework (LangChain, Vercel AI SDK, AutoGPT, custom agents)

Both interfaces expose the exact same set of tools.
