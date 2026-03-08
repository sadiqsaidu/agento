/**
 * Event Bus — tracks and broadcasts tool execution events
 *
 * Powers the CLI monitor and REST SSE endpoint. Both REST and MCP servers
 * emit events here so a human operator can observe agent activity in real-time.
 */

import { EventEmitter } from "node:events";

// ── Types ──

export interface ToolEvent {
  timestamp: string;
  tool: string;
  wallet: string; // first 8 chars of wallet ID, or "none"
  status: "success" | "error" | "blocked";
  durationMs: number;
  summary: string;
  /** Which guardrail rule blocked the action (only when status=blocked). */
  blockedBy?: string;
  source: "rest" | "mcp";
}

// ── Bus ──

const bus = new EventEmitter();
bus.setMaxListeners(50);

const recent: ToolEvent[] = [];
const MAX_RECENT = 500;

/** Emit a tool event and store it in the recent buffer */
export function emitToolEvent(event: ToolEvent): void {
  recent.push(event);
  if (recent.length > MAX_RECENT) recent.shift();
  bus.emit("tool", event);
}

/** Subscribe to tool events. Returns a cleanup function. */
export function onToolEvent(handler: (event: ToolEvent) => void): () => void {
  bus.on("tool", handler);
  return () => {
    bus.off("tool", handler);
  };
}

/** Get buffered recent events (for new SSE clients to catch up) */
export function getRecentEvents(): ToolEvent[] {
  return [...recent];
}

// ── Summarizer ──

/** Generate a short human-readable summary for a tool result */
export function summarize(tool: string, result: Record<string, any>): string {
  const sig = (s: string | undefined) => (s ? s.slice(0, 8) + "…" : "?");
  const addr = (s: string | undefined) => (s ? s.slice(0, 8) + "…" : "?");

  switch (tool) {
    case "create_wallet":
      return `Created wallet ${addr(result.address)}`;
    case "get_wallet_address":
      return result.address as string;
    case "get_balance":
      return `${result.balance_sol} SOL`;
    case "get_token_balances":
      return `${(result.balances as any[])?.length ?? 0} token(s)`;
    case "transfer":
      return `Sent ${result.amount} → ${addr(result.to)}  sig:${sig(result.signature)}`;
    case "list_wallets":
      return `${result.count} wallet(s)`;
    case "request_airdrop":
      return `Airdropped ${result.amount} SOL`;
    case "import_wallet":
      return `Imported ${addr(result.address)}`;
    case "export_wallet":
      return "Private key exported";
    case "delete_wallet":
      return `Deleted ${result.deleted}`;
    case "swap_tokens":
      return `Swapped ${result.input_amount} → sig:${sig(result.signature)}`;
    case "fetch_token_price":
      return `$${result.price_usd} (${result.source})`;
    case "create_limit_order":
      return `Order placed  sig:${sig(result.signature)}`;
    case "cancel_limit_orders":
      return `Cancelled ${(result.signatures as string[])?.length ?? 0} order(s)`;
    case "get_open_orders":
      return `${result.count} open order(s)`;
    case "stake_sol":
      return `Staked ${result.amount} SOL → jupSOL  sig:${sig(result.signature)}`;
    case "lend_asset":
      return `Lent ${result.amount}  sig:${sig(result.signature)}`;
    case "withdraw_lend":
      return `Withdrew ${result.amount}  sig:${sig(result.signature)}`;
    default:
      return JSON.stringify(result).slice(0, 80);
  }
}
