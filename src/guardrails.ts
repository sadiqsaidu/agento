import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { solBalance } from "./wallet.js";
import type { Config } from "./config.js";

// ── Config ──

export interface GuardrailConfig {
  enabled: boolean;
  spendingLimits: { perTransactionSol: number; dailyTotalSol: number };
  balanceFloorSol: number;
  maxSlippageBps: number;
  drainProtection: { maxPercentPerTx: number };
  rateLimit: { maxPerMinute: number };
  tokenValidation: { onlyVerifiedTokens: boolean };
  addressRules: { allowlist: string[]; blocklist: string[]; flagUnknown: boolean };
}

const DEFAULTS: GuardrailConfig = {
  enabled: true,
  spendingLimits: { perTransactionSol: 1.0, dailyTotalSol: 5.0 },
  balanceFloorSol: 0.05,
  maxSlippageBps: 500,
  drainProtection: { maxPercentPerTx: 50 },
  rateLimit: { maxPerMinute: 10 },
  tokenValidation: { onlyVerifiedTokens: true },
  addressRules: { allowlist: [], blocklist: [], flagUnknown: false },
};

let _config: GuardrailConfig | null = null;

export function loadGuardrailConfig(configDir?: string): GuardrailConfig {
  if (_config) return _config;

  const paths = [
    configDir && join(configDir, "guardrails.json"),
    join(process.cwd(), "guardrails.json"),
  ].filter(Boolean) as string[];

  for (const p of paths) {
    if (existsSync(p)) {
      try {
        _config = merge(DEFAULTS, JSON.parse(readFileSync(p, "utf-8"))) as GuardrailConfig;
        console.error(`🛡️  Guardrails loaded from ${p}`);
        return _config;
      } catch {}
    }
  }

  _config = { ...DEFAULTS };
  console.error("🛡️  Guardrails using defaults");
  return _config;
}

// ── Result ──

export interface GuardrailResult {
  allowed: boolean;
  rule: string | null;
  reason: string;
  warnings: string[];
}

const allow = (warnings: string[] = []): GuardrailResult =>
  ({ allowed: true, rule: null, reason: "ok", warnings });

const deny = (rule: string, reason: string): GuardrailResult =>
  ({ allowed: false, rule, reason, warnings: [] });

// ── Transaction ledger ──

interface TxRecord { timestamp: number; walletId: string; amountSol: number; tool: string }

const ledger: TxRecord[] = [];

export function recordTransaction(walletId: string, amountSol: number, tool: string): void {
  ledger.push({ timestamp: Date.now(), walletId, amountSol, tool });
  if (ledger.length > 10_000) ledger.splice(0, ledger.length - 10_000);
}

function recentTxs(walletId: string, windowMs: number): TxRecord[] {
  const cutoff = Date.now() - windowMs;
  return ledger.filter((r) => r.walletId === walletId && r.timestamp >= cutoff);
}

// ── Verified token cache ──

let verifiedMints: Set<string> | null = null;
let verifiedAt = 0;

async function getVerifiedMints(): Promise<Set<string>> {
  if (verifiedMints && Date.now() - verifiedAt < 3_600_000) return verifiedMints;
  try {
    const res = await fetch("https://tokens.jup.ag/tokens?tags=verified");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const tokens = (await res.json()) as Array<{ address: string }>;
    verifiedMints = new Set(tokens.map((t) => t.address));
    verifiedAt = Date.now();
    return verifiedMints;
  } catch {
    return verifiedMints ?? new Set();
  }
}

// ── Which tools need checking ──

export const TRANSACTIONAL_TOOLS = new Set([
  "transfer", "swap_tokens", "create_limit_order",
  "cancel_limit_orders", "stake_sol", "lend_asset", "withdraw_lend",
]);

const SOL_MINT = "So11111111111111111111111111111111111111112";

// ── Main check ──

export async function checkGuardrails(
  tool: string,
  input: Record<string, any>,
  walletId: string,
  config: Config,
  walletAddress: string,
): Promise<GuardrailResult> {
  const gc = loadGuardrailConfig();
  if (!gc.enabled) return allow();

  const warnings: string[] = [];
  const amountSol = extractSolAmount(tool, input);

  // Rate limit
  const lastMin = recentTxs(walletId, 60_000);
  if (lastMin.length >= gc.rateLimit.maxPerMinute)
    return deny("rate_limit", `${lastMin.length}/${gc.rateLimit.maxPerMinute} txs/min exceeded. Wait and retry.`);

  // Per-tx spending limit
  if (gc.spendingLimits.perTransactionSol > 0 && amountSol > gc.spendingLimits.perTransactionSol)
    return deny("spending_limit_per_tx", `Transaction amount (${amountSol} SOL) exceeds per-transaction limit of ${gc.spendingLimits.perTransactionSol} SOL.`);

  // Daily spending limit
  if (gc.spendingLimits.dailyTotalSol > 0) {
    const dailySpent = recentTxs(walletId, 86_400_000).reduce((s, r) => s + r.amountSol, 0);
    if (dailySpent + amountSol > gc.spendingLimits.dailyTotalSol)
      return deny("spending_limit_daily", `Daily spend would reach ${(dailySpent + amountSol).toFixed(4)} SOL (limit: ${gc.spendingLimits.dailyTotalSol} SOL).`);
  }

  // Balance floor + drain protection (single RPC call)
  if (amountSol > 0 && (gc.balanceFloorSol > 0 || gc.drainProtection.maxPercentPerTx > 0)) {
    try {
      const balance = await solBalance(walletAddress, config.SOLANA_RPC_URL);
      if (gc.balanceFloorSol > 0 && balance - amountSol < gc.balanceFloorSol)
        return deny("balance_floor", `Would leave ${(balance - amountSol).toFixed(4)} SOL, below floor of ${gc.balanceFloorSol} SOL. Balance: ${balance.toFixed(4)} SOL.`);
      if (gc.drainProtection.maxPercentPerTx > 0 && balance > 0) {
        const pct = (amountSol / balance) * 100;
        if (pct > gc.drainProtection.maxPercentPerTx)
          return deny("drain_protection", `Would move ${pct.toFixed(1)}% of balance (max ${gc.drainProtection.maxPercentPerTx}%).`);
      }
    } catch {
      warnings.push("Could not verify balance (RPC error).");
    }
  }

  // Slippage cap
  if (tool === "swap_tokens" && gc.maxSlippageBps > 0 && (input.slippageBps ?? 0) > gc.maxSlippageBps)
    return deny("slippage_cap", `Slippage ${input.slippageBps} bps exceeds max of ${gc.maxSlippageBps} bps.`);

  // Token validation
  if (gc.tokenValidation.onlyVerifiedTokens) {
    const mints = extractMints(tool, input);
    if (mints.length > 0) {
      const verified = await getVerifiedMints();
      if (verified.size > 0) {
        for (const m of mints) {
          if (!verified.has(m))
            return deny("unverified_token", `Token ${m} is not on Jupiter's verified list.`);
        }
      }
    }
  }

  // Address rules (transfers)
  if (tool === "transfer" && input.to) {
    const dest: string = input.to;
    if (gc.addressRules.blocklist.includes(dest))
      return deny("address_blocklist", `Destination ${dest} is blocklisted.`);
    if (gc.addressRules.allowlist.length > 0 && !gc.addressRules.allowlist.includes(dest))
      return deny("address_allowlist", `Destination ${dest} is not on the allowlist.`);
    if (gc.addressRules.flagUnknown && gc.addressRules.allowlist.length === 0)
      warnings.push(`Transfer to unknown address ${dest.slice(0, 12)}…`);
  }

  return allow(warnings);
}

// ── Extractors ──

function extractSolAmount(tool: string, input: Record<string, any>): number {
  switch (tool) {
    case "transfer": return !input.mint ? input.amount ?? 0 : 0;
    case "swap_tokens": return (!input.inputMint || input.inputMint === SOL_MINT) ? input.inputAmount ?? 0 : 0;
    case "stake_sol": return input.amount ?? 0;
    default: return 0;
  }
}

function extractMints(tool: string, input: Record<string, any>): string[] {
  switch (tool) {
    case "swap_tokens": return [input.inputMint || SOL_MINT, input.outputMint].filter(Boolean);
    case "create_limit_order": return [input.inputMint, input.outputMint].filter(Boolean);
    default: return [];
  }
}

// ── Utils ──

function merge(target: any, source: any): any {
  const out = { ...target };
  for (const k of Object.keys(source)) {
    out[k] = (source[k] && typeof source[k] === "object" && !Array.isArray(source[k]) && target[k] && typeof target[k] === "object" && !Array.isArray(target[k]))
      ? merge(target[k], source[k])
      : source[k];
  }
  return out;
}
