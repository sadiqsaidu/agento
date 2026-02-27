/**
 * Wallet Manager — bridges encrypted keystore to Solana Connection + Keypair
 *
 * No SAK dependency. Just @solana/web3.js + @solana/spl-token.
 */

import {
  Keypair,
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { Keystore } from "./keystore.js";
import type { Config } from "./config.js";

/** Minimal wallet context — everything a tool needs to transact */
export interface WalletCtx {
  keypair: Keypair;
  connection: Connection;
  publicKey: PublicKey;
}

// Cached contexts per wallet ID
const cache = new Map<string, WalletCtx>();

export function createKeystore(config: Config): Keystore {
  return new Keystore(config.KEYSTORE_DIR);
}

export function getWalletCtx(
  walletId: string,
  password: string,
  keystore: Keystore,
  config: Config,
): WalletCtx {
  const cached = cache.get(walletId);
  if (cached) return cached;

  const keypair = keystore.unlock(walletId, password);
  const connection = new Connection(config.SOLANA_RPC_URL, "confirmed");
  const ctx: WalletCtx = {
    keypair,
    connection,
    publicKey: keypair.publicKey,
  };
  cache.set(walletId, ctx);
  return ctx;
}

export function evictWalletCtx(walletId: string): void {
  cache.delete(walletId);
}

/** SOL balance (in SOL, not lamports) */
export async function solBalance(
  address: string,
  rpcUrl: string,
): Promise<number> {
  const conn = new Connection(rpcUrl, "confirmed");
  const lamports = await conn.getBalance(new PublicKey(address));
  return lamports / LAMPORTS_PER_SOL;
}

/** All SPL token accounts for a wallet */
export async function tokenBalances(
  connection: Connection,
  owner: PublicKey,
): Promise<Array<{ mint: string; amount: string; decimals: number; uiAmount: number }>> {
  const [spl, spl2022] = await Promise.all([
    connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
    connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }),
  ]);

  return [...spl.value, ...spl2022.value]
    .map((a) => {
      const info = a.account.data.parsed?.info;
      if (!info) return null;
      return {
        mint: info.mint as string,
        amount: info.tokenAmount?.amount as string,
        decimals: info.tokenAmount?.decimals as number,
        uiAmount: info.tokenAmount?.uiAmount as number,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null && Number(x.amount) > 0);
}
