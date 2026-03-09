/**
 * Agento REST Server — HTTP interface via Hono
 *
 * Provides the same tools as the MCP server, but over HTTP.
 * Useful for agents that prefer REST over stdio-based MCP.
 *
 * Usage: npx tsx src/rest.ts
 *
 * Auth: wallet_id and wallet_password are sent via headers:
 *   X-Wallet-Id: <wallet-id>
 *   X-Wallet-Password: <password>
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { streamSSE } from "hono/streaming";
import { cors } from "hono/cors";
import { loadConfig } from "./config.js";
import { createKeystore } from "./wallet.js";
import { ALL_TOOLS, type ToolContext } from "./tools.js";
import { emitToolEvent, summarize, onToolEvent, getRecentEvents } from "./events.js";
import {
  TRANSACTIONAL_TOOLS,
  checkGuardrails,
  recordTransaction,
  loadGuardrailConfig,
} from "./guardrails.js";

const config = loadConfig();
const keystore = createKeystore(config);

const app = new Hono();

app.use("*", cors());

// ─── Health check ───

app.get("/health", (c) =>
  c.json({ status: "ok", name: "agento", version: "0.1.1" }),
);

// ─── List available tools ───

app.get("/tools", (c) =>
  c.json({
    tools: ALL_TOOLS.map((t: { name: string; description: string }) => ({
      name: t.name,
      description: t.description,
    })),
  }),
);

// ─── Execute a tool ───

app.post("/tools/:name", async (c) => {
  const toolName = c.req.param("name");
  const tool = ALL_TOOLS.find((t: { name: string }) => t.name === toolName);

  if (!tool) {
    return c.json({ error: `Unknown tool: ${toolName}` }, 404);
  }

  // Extract wallet credentials from headers
  const walletId = c.req.header("X-Wallet-Id") || "";
  const walletPassword = c.req.header("X-Wallet-Password") || "agento";

  const ctx: ToolContext = {
    keystore,
    config,
    walletId,
    password: walletPassword,
  };

  try {
    const body = await c.req.json().catch(() => ({}));
    const parsed = tool.schema.parse(body);
    const start = Date.now();

    // ── Guardrail check for transactional tools ──
    if (TRANSACTIONAL_TOOLS.has(toolName)) {
      let walletAddress = "";
      try {
        const { getWalletCtx } = await import("./wallet.js");
        const wc = getWalletCtx(walletId, walletPassword, keystore, config);
        walletAddress = wc.publicKey.toBase58();
      } catch { /* wallet may not exist yet for some tools */ }

      const guard = await checkGuardrails(toolName, parsed, walletId, config, walletAddress);
      if (!guard.allowed) {
        emitToolEvent({
          timestamp: new Date().toISOString(),
          tool: toolName,
          wallet: walletId ? walletId.slice(0, 8) : "none",
          status: "blocked",
          durationMs: Date.now() - start,
          summary: `🛡️ ${guard.rule}: ${guard.reason}`,
          blockedBy: guard.rule ?? undefined,
          source: "rest",
        });
        return c.json({ success: false, blocked: true, rule: guard.rule, reason: guard.reason }, 403);
      }

      // Attach warnings to the response if any
      if (guard.warnings.length > 0) {
        // Warnings are non-blocking — continue execution
      }
    }

    const result = await tool.execute(parsed, ctx);

    // Record successful transactional operations in the ledger
    if (TRANSACTIONAL_TOOLS.has(toolName)) {
      const amountSol = extractSolAmountFromInput(toolName, parsed);
      recordTransaction(walletId, amountSol, toolName);
    }

    emitToolEvent({
      timestamp: new Date().toISOString(),
      tool: toolName,
      wallet: walletId ? walletId.slice(0, 8) : "none",
      status: "success",
      durationMs: Date.now() - start,
      summary: summarize(toolName, result),
      source: "rest",
    });
    return c.json({ success: true, result });
  } catch (err: any) {
    emitToolEvent({
      timestamp: new Date().toISOString(),
      tool: toolName,
      wallet: walletId ? walletId.slice(0, 8) : "none",
      status: "error",
      durationMs: 0,
      summary: err.message,
      source: "rest",
    });
    const status = err.name === "ZodError" ? 400 : 500;
    return c.json({ success: false, error: err.message }, status);
  }
});

// ─── Wallet management shortcuts ───

app.post("/wallets", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const password = (body as any).password || "agento";
  try {
    const result = keystore.create(password);
    return c.json({ success: true, ...result });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

app.get("/wallets", (c) => {
  const wallets = keystore.list();
  return c.json({ wallets, count: wallets.length });
});

// ─── Server-Sent Events (for CLI monitor) ───

app.get("/events", (c) => {
  return streamSSE(c, async (stream) => {
    // Send buffered recent events so new clients catch up
    for (const event of getRecentEvents()) {
      await stream.writeSSE({ data: JSON.stringify(event), event: "tool" });
    }

    // Subscribe to live events
    let alive = true;
    stream.onAbort(() => {
      alive = false;
    });

    const cleanup = onToolEvent((event) => {
      if (alive) {
        stream.writeSSE({ data: JSON.stringify(event), event: "tool" }).catch(() => {});
      }
    });

    // Keep connection open until client disconnects
    while (alive) {
      await stream.sleep(15000);
    }

    cleanup();
  });
});

// ─── Dashboard ───

const __dirname = dirname(fileURLToPath(import.meta.url));
let dashboardHtml: string | null = null;

function getDashboard(): string {
  if (!dashboardHtml) {
    dashboardHtml = readFileSync(join(__dirname, "dashboard.html"), "utf-8");
  }
  return dashboardHtml;
}

app.get("/dashboard", (c) => c.html(getDashboard()));
app.get("/", (c) => c.redirect("/dashboard"));

// ─── Start ───

// Initialize guardrails on startup
loadGuardrailConfig();

/** Quick SOL amount extractor for the tx ledger (mirrors guardrails.ts logic). */
function extractSolAmountFromInput(tool: string, input: Record<string, any>): number {
  const SOL_MINT = "So11111111111111111111111111111111111111112";
  switch (tool) {
    case "transfer":
      return !input.mint ? (input.amount as number) ?? 0 : 0;
    case "swap_tokens":
      return (!input.inputMint || input.inputMint === SOL_MINT)
        ? (input.inputAmount as number) ?? 0
        : 0;
    case "stake_sol":
      return (input.amount as number) ?? 0;
    default:
      return 0;
  }
}

const port = config.REST_PORT;
console.log(`🚀 Agento REST server listening on http://localhost:${port}`);
console.log(`   Dashboard: http://localhost:${port}/dashboard`);
console.log(`   Tools: ${ALL_TOOLS.length} available`);
console.log(`   Keystore: ${config.KEYSTORE_DIR}`);
serve({ fetch: app.fetch, port });
