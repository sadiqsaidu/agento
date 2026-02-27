/**
 * Tool definitions — all operations Agento exposes via MCP + REST.
 *
 * Each tool calls Solana RPC / Jupiter / Lulo APIs directly —
 * no solana-agent-kit dependency. Clean, minimal, zero ESM/CJS issues.
 */

import { z } from "zod";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddress,
  getMint,
} from "@solana/spl-token";
import type { Keystore } from "./keystore.js";
import type { Config } from "./config.js";
import {
  getWalletCtx,
  solBalance,
  tokenBalances,
  type WalletCtx,
} from "./wallet.js";

// ── Constants ──

const SOL_MINT = "So11111111111111111111111111111111111111112";
const JUP_API = "https://api.jup.ag";
const JUP_LIMIT = "https://api.jup.ag/limit/v2";
const JUP_STAKE_BLINK =
  "https://worker.jup.ag/blinks/swap/So11111111111111111111111111111111111111112/jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v";
const LULO_DEPOSIT = "https://api.flexlend.fi/generate/account/deposit?priorityFee=50000";
const LULO_WITHDRAW_BLINK = "https://lulo.dial.to/api/actions/withdraw";

// ── Types ──

export interface ToolContext {
  keystore: Keystore;
  config: Config;
  walletId: string;
  password: string;
}

export interface ToolDef<T = any> {
  name: string;
  description: string;
  schema: z.ZodType<T>;
  execute: (input: T, ctx: ToolContext) => Promise<Record<string, any>>;
}

// ── Helpers ──

function w(ctx: ToolContext): WalletCtx {
  return getWalletCtx(ctx.walletId, ctx.password, ctx.keystore, ctx.config);
}

/** Build headers for Jupiter API calls (includes API key if configured) */
function jupHeaders(ctx: ToolContext): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (ctx.config.JUPITER_API_KEY) h["x-api-key"] = ctx.config.JUPITER_API_KEY;
  return h;
}

/** Sign + send a versioned transaction */
async function signAndSend(wc: WalletCtx, tx: VersionedTransaction): Promise<string> {
  tx.sign([wc.keypair]);
  const sig = await wc.connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  const bh = await wc.connection.getLatestBlockhash();
  await wc.connection.confirmTransaction(
    { signature: sig, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight },
    "confirmed",
  );
  return sig;
}

/** Sign + send a legacy transaction */
async function signAndSendLegacy(wc: WalletCtx, tx: Transaction): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await wc.connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = wc.publicKey;
  tx.sign(wc.keypair);
  const sig = await wc.connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  await wc.connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  return sig;
}

// ═══════════════════════════════════════════════════════
//  WALLET MANAGEMENT
// ═══════════════════════════════════════════════════════

export const createWallet: ToolDef = {
  name: "create_wallet",
  description:
    "Create a new Solana wallet. Generates a keypair, encrypts it with AES-256-GCM, and stores it in the local keystore. Returns the wallet ID and public address.",
  schema: z.object({}),
  execute: async (_input, ctx) => {
    const { id, address } = ctx.keystore.create(ctx.password);
    return { wallet_id: id, address, network: "devnet" };
  },
};

export const getWalletAddress: ToolDef = {
  name: "get_wallet_address",
  description: "Get the Solana public address of the currently active wallet.",
  schema: z.object({}),
  execute: async (_input, ctx) => {
    const wc = w(ctx);
    return { address: wc.publicKey.toBase58() };
  },
};

export const getBalance: ToolDef = {
  name: "get_balance",
  description: "Get the SOL balance of the current wallet in SOL (not lamports).",
  schema: z.object({}),
  execute: async (_input, ctx) => {
    const wc = w(ctx);
    const address = wc.publicKey.toBase58();
    const balance = await solBalance(address, ctx.config.SOLANA_RPC_URL);
    return { address, balance_sol: balance };
  },
};

export const getTokenBalancesTool: ToolDef = {
  name: "get_token_balances",
  description:
    "Get all SPL token balances for the current wallet, including token mint addresses and amounts.",
  schema: z.object({}),
  execute: async (_input, ctx) => {
    const wc = w(ctx);
    const balances = await tokenBalances(wc.connection, wc.publicKey);
    return { balances };
  },
};

export const transferTool: ToolDef = {
  name: "transfer",
  description:
    "Transfer SOL or an SPL token to another address. For SOL, omit the mint parameter. Returns the transaction signature.",
  schema: z.object({
    to: z.string().describe("Destination wallet address (base58)"),
    amount: z.number().positive().describe("Amount to transfer"),
    mint: z.string().optional().describe("SPL token mint address. Omit for native SOL transfer."),
  }),
  execute: async (input, ctx) => {
    const wc = w(ctx);
    const to = new PublicKey(input.to);

    if (!input.mint) {
      // Native SOL transfer
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: wc.publicKey,
          toPubkey: to,
          lamports: Math.floor(input.amount * LAMPORTS_PER_SOL),
        }),
      );
      const sig = await signAndSendLegacy(wc, tx);
      return { signature: sig, to: input.to, amount: input.amount };
    }

    // SPL token transfer
    const mint = new PublicKey(input.mint);
    const fromAta = await getAssociatedTokenAddress(mint, wc.publicKey);
    const toAta = await getAssociatedTokenAddress(mint, to);
    const tx = new Transaction();

    // Create destination ATA if it doesn't exist
    try {
      await getAccount(wc.connection, toAta);
    } catch {
      tx.add(createAssociatedTokenAccountInstruction(wc.publicKey, toAta, to, mint));
    }

    const mintInfo = await getMint(wc.connection, mint);
    const rawAmount = Math.floor(input.amount * 10 ** mintInfo.decimals);
    tx.add(createTransferInstruction(fromAta, toAta, wc.publicKey, rawAmount));

    const sig = await signAndSendLegacy(wc, tx);
    return { signature: sig, to: input.to, amount: input.amount };
  },
};

export const requestAirdrop: ToolDef = {
  name: "request_airdrop",
  description:
    "Request an airdrop of 2 SOL from the devnet faucet. Only works on devnet/testnet.",
  schema: z.object({}),
  execute: async (_input, ctx) => {
    const wc = w(ctx);
    const sig = await wc.connection.requestAirdrop(wc.publicKey, 2 * LAMPORTS_PER_SOL);
    const bh = await wc.connection.getLatestBlockhash();
    await wc.connection.confirmTransaction(
      { signature: sig, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight },
      "confirmed",
    );
    return { signature: sig, amount_sol: 2 };
  },
};

export const listWallets: ToolDef = {
  name: "list_wallets",
  description:
    "List all wallets stored in the encrypted keystore. Returns IDs, addresses, and creation dates.",
  schema: z.object({}),
  execute: async (_input, ctx) => {
    const wallets = ctx.keystore.list();
    return { wallets, count: wallets.length };
  },
};

// ═══════════════════════════════════════════════════════
//  JUPITER — SWAP (via REST API)
// ═══════════════════════════════════════════════════════

export const swapTokens: ToolDef = {
  name: "swap_tokens",
  description:
    "Swap tokens using Jupiter Exchange. Specify the output token mint and the input amount in human-readable units. Defaults to swapping from SOL.",
  schema: z.object({
    outputMint: z.string().describe("Mint address of the token to receive"),
    inputAmount: z.number().positive().describe("Amount of input token to swap (human units)"),
    inputMint: z.string().optional().describe("Mint address of input token (default: SOL)"),
    slippageBps: z.number().optional().describe("Slippage tolerance in basis points (default: 300)"),
  }),
  execute: async (input, ctx) => {
    const wc = w(ctx);
    const inMint = input.inputMint || SOL_MINT;
    const slippage = input.slippageBps || 300;

    // Figure out decimals for the input token
    let decimals = 9; // SOL default
    if (inMint !== SOL_MINT) {
      const mintInfo = await getMint(wc.connection, new PublicKey(inMint));
      decimals = mintInfo.decimals;
    }
    const scaledAmount = Math.floor(input.inputAmount * 10 ** decimals);

    // 1. Get quote
    const quoteUrl = `${JUP_API}/swap/v1/quote?inputMint=${inMint}&outputMint=${input.outputMint}&amount=${scaledAmount}&slippageBps=${slippage}&swapMode=ExactIn`;
    const quoteRes = await fetch(quoteUrl, { headers: jupHeaders(ctx) });
    if (!quoteRes.ok) throw new Error(`Jupiter quote failed: ${await quoteRes.text()}`);
    const quoteResponse = await quoteRes.json();

    // 2. Get swap transaction
    const swapRes = await fetch(`${JUP_API}/swap/v1/swap`, {
      method: "POST",
      headers: jupHeaders(ctx),
      body: JSON.stringify({
        userPublicKey: wc.publicKey.toBase58(),
        quoteResponse,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: {
            maxLamports: 5_000_000,
            priorityLevel: "medium",
          },
        },
      }),
    });
    if (!swapRes.ok) throw new Error(`Jupiter swap failed: ${await swapRes.text()}`);
    const { swapTransaction } = (await swapRes.json()) as { swapTransaction: string };

    // 3. Deserialize, sign, send
    const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, "base64"));
    const { blockhash } = await wc.connection.getLatestBlockhash();
    tx.message.recentBlockhash = blockhash;
    const sig = await signAndSend(wc, tx);

    return {
      signature: sig,
      input_amount: input.inputAmount,
      input_mint: inMint,
      output_mint: input.outputMint,
      output_amount: quoteResponse.outAmount,
    };
  },
};

export const fetchTokenPrice: ToolDef = {
  name: "fetch_token_price",
  description: "Fetch the current USD price of a token. Use the full mint address, e.g. SOL = So11111111111111111111111111111111111111112, USDC = EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v.",
  schema: z.object({
    mint: z.string().describe("Token mint address (base58). SOL mint is So11111111111111111111111111111111111111112"),
  }),
  execute: async (input, ctx) => {
    // Try Jupiter Price API if we have an API key
    if (ctx.config.JUPITER_API_KEY) {
      const res = await fetch(`${JUP_API}/price/v2?ids=${input.mint}`, {
        headers: jupHeaders(ctx),
      });
      if (res.ok) {
        const data = (await res.json()) as { data: Record<string, { price: number }> };
        const price = data.data[input.mint]?.price;
        if (price) return { mint: input.mint, price_usd: price, source: "jupiter" };
      }
    }

    // Fallback: DexScreener (free, no API key)
    const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${input.mint}`);
    if (!res.ok) throw new Error(`Price fetch failed: ${await res.text()}`);
    const pairs = (await res.json()) as Array<{ priceUsd?: string }>;
    const price = pairs?.[0]?.priceUsd;
    if (!price) throw new Error("Price data not available for this token.");
    return { mint: input.mint, price_usd: parseFloat(price), source: "dexscreener" };
  },
};

// ═══════════════════════════════════════════════════════
//  JUPITER — LIMIT ORDERS
// ═══════════════════════════════════════════════════════

export const createLimitOrder: ToolDef = {
  name: "create_limit_order",
  description:
    "Create a limit order on Jupiter. Specify input/output mints and amounts in raw (smallest) units. The order executes automatically when the price target is reached.",
  schema: z.object({
    inputMint: z.string().describe("Mint of the token you are selling"),
    outputMint: z.string().describe("Mint of the token you want to buy"),
    makingAmount: z.string().describe("Amount of input token (raw/smallest units as string)"),
    takingAmount: z.string().describe("Desired output token amount (raw/smallest units as string)"),
  }),
  execute: async (input, ctx) => {
    const wc = w(ctx);
    const wallet = wc.publicKey.toBase58();

    const res = await fetch(`${JUP_LIMIT}/createOrder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inputMint: input.inputMint,
        outputMint: input.outputMint,
        maker: wallet,
        payer: wallet,
        params: {
          makingAmount: input.makingAmount,
          takingAmount: input.takingAmount,
        },
      }),
    });
    if (!res.ok) throw new Error(`Limit order failed: ${await res.text()}`);
    const data = (await res.json()) as { tx: string; order: string };

    const tx = VersionedTransaction.deserialize(Buffer.from(data.tx, "base64"));
    const sig = await signAndSend(wc, tx);
    return { signature: sig, order: data.order, success: true };
  },
};

export const cancelLimitOrders: ToolDef = {
  name: "cancel_limit_orders",
  description: "Cancel one or more open limit orders on Jupiter by their order public keys.",
  schema: z.object({
    orders: z.array(z.string()).describe("Array of order public keys to cancel"),
  }),
  execute: async (input, ctx) => {
    const wc = w(ctx);
    const res = await fetch(`${JUP_LIMIT}/cancelOrders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        maker: wc.publicKey.toBase58(),
        orders: input.orders,
      }),
    });
    if (!res.ok) throw new Error(`Cancel orders failed: ${await res.text()}`);
    const data = (await res.json()) as { txs: string[] };

    const signatures: string[] = [];
    for (const txBase64 of data.txs) {
      const tx = VersionedTransaction.deserialize(Buffer.from(txBase64, "base64"));
      signatures.push(await signAndSend(wc, tx));
    }
    return { signatures, success: true };
  },
};

export const getOpenOrders: ToolDef = {
  name: "get_open_orders",
  description: "Get all currently open Jupiter limit orders for this wallet.",
  schema: z.object({}),
  execute: async (_input, ctx) => {
    const wc = w(ctx);
    const res = await fetch(`${JUP_LIMIT}/openOrders?wallet=${wc.publicKey.toBase58()}`);
    if (!res.ok) throw new Error(`Get orders failed: ${await res.text()}`);
    const orders = await res.json();
    return { orders, count: Array.isArray(orders) ? orders.length : 0 };
  },
};

// ═══════════════════════════════════════════════════════
//  JUPITER — STAKING (jupSOL)
// ═══════════════════════════════════════════════════════

export const stakeSol: ToolDef = {
  name: "stake_sol",
  description:
    "Liquid-stake SOL via Jupiter to receive jupSOL. This is a yield-bearing liquid staking token.",
  schema: z.object({
    amount: z.number().positive().describe("Amount of SOL to stake"),
  }),
  execute: async (input, ctx) => {
    const wc = w(ctx);
    const res = await fetch(`${JUP_STAKE_BLINK}/${input.amount}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account: wc.publicKey.toBase58() }),
    });
    if (!res.ok) throw new Error(`jupSOL staking failed: ${await res.text()}`);
    const data = (await res.json()) as { transaction: string };

    const tx = VersionedTransaction.deserialize(Buffer.from(data.transaction, "base64"));
    const { blockhash } = await wc.connection.getLatestBlockhash();
    tx.message.recentBlockhash = blockhash;
    const sig = await signAndSend(wc, tx);
    return { signature: sig, amount: input.amount, token: "jupSOL" };
  },
};

// ═══════════════════════════════════════════════════════
//  LULO — LENDING
// ═══════════════════════════════════════════════════════

export const lendAsset: ToolDef = {
  name: "lend_asset",
  description:
    "Lend an asset via Lulo/Flexlend to earn yield. Lulo aggregates across lending protocols (Kamino, Drift, MarginFi, Jupiter) for the best rate.",
  schema: z.object({
    amount: z.number().positive().describe("Amount to lend"),
    mintAddress: z.string().describe("Mint address of the token to lend (e.g. USDC mint)"),
  }),
  execute: async (input, ctx) => {
    const wc = w(ctx);
    const wallet = wc.publicKey.toBase58();

    const res = await fetch(LULO_DEPOSIT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-wallet-pubkey": wallet,
      },
      body: JSON.stringify({
        owner: wallet,
        mintAddress: input.mintAddress,
        depositAmount: input.amount.toString(),
      }),
    });
    if (!res.ok) throw new Error(`Lulo deposit failed: ${await res.text()}`);
    const { data: { transactionMeta } } = (await res.json()) as {
      data: { transactionMeta: Array<{ transaction: string }> };
    };

    const tx = VersionedTransaction.deserialize(
      Buffer.from(transactionMeta[0]!.transaction, "base64"),
    );
    const { blockhash } = await wc.connection.getLatestBlockhash();
    tx.message.recentBlockhash = blockhash;
    const sig = await signAndSend(wc, tx);
    return { signature: sig, amount: input.amount, mint: input.mintAddress };
  },
};

export const withdrawLend: ToolDef = {
  name: "withdraw_lend",
  description: "Withdraw a previously lent asset from Lulo.",
  schema: z.object({
    amount: z.number().positive().describe("Amount to withdraw"),
    mintAddress: z.string().describe("Mint address of the token to withdraw"),
  }),
  execute: async (input, ctx) => {
    const wc = w(ctx);
    const res = await fetch(
      `${LULO_WITHDRAW_BLINK}/${input.mintAddress}/${input.amount}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: wc.publicKey.toBase58() }),
      },
    );
    if (!res.ok) throw new Error(`Lulo withdraw failed: ${await res.text()}`);
    const data = (await res.json()) as { transaction: string };

    const tx = VersionedTransaction.deserialize(Buffer.from(data.transaction, "base64"));
    const { blockhash } = await wc.connection.getLatestBlockhash();
    tx.message.recentBlockhash = blockhash;
    const sig = await signAndSend(wc, tx);
    return { signature: sig, amount: input.amount, mint: input.mintAddress };
  },
};

// ═══════════════════════════════════════════════════════
//  REGISTRY
// ═══════════════════════════════════════════════════════

export const ALL_TOOLS: ToolDef[] = [
  // Wallet
  createWallet,
  getWalletAddress,
  getBalance,
  getTokenBalancesTool,
  transferTool,
  requestAirdrop,
  listWallets,
  // Jupiter — Trading
  swapTokens,
  fetchTokenPrice,
  createLimitOrder,
  cancelLimitOrders,
  getOpenOrders,
  // Jupiter — Staking
  stakeSol,
  // Lulo — Lending
  lendAsset,
  withdrawLend,
];
