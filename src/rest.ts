/**
 * Agento REST Server — HTTP interface via Hono
 *
 * Exposes the same 18 tools as the MCP server, over HTTP.
 * Any agent framework can connect: LangChain, Vercel AI SDK, raw fetch, etc.
 *
 * Auth: wallet credentials via headers:
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

// ─── Health ───

app.get("/health", (c) =>
  c.json({ status: "ok", name: "agento", version: "0.2.0" }),
);

// ─── List tools ───

app.get("/tools", (c) =>
  c.json({
    tools: ALL_TOOLS.map((t) => ({ name: t.name, description: t.description })),
  }),
);

// ─── Execute a tool ───

app.post("/tools/:name", async (c) => {
  const toolName = c.req.param("name");
  const tool = ALL_TOOLS.find((t) => t.name === toolName);
  if (!tool) return c.json({ error: `Unknown tool: ${toolName}` }, 404);

  const walletId = c.req.header("X-Wallet-Id") || "";
  const walletPassword = c.req.header("X-Wallet-Password") || "";

  const ctx: ToolContext = { keystore, config, walletId, password: walletPassword };

  try {
    const body = await c.req.json().catch(() => ({}));
    const parsed = tool.schema.parse(body);
    const start = Date.now();

    // Guardrail check for transactional tools
    if (TRANSACTIONAL_TOOLS.has(toolName)) {
      let walletAddress = "";
      try {
        const { getWalletCtx } = await import("./wallet.js");
        const wc = getWalletCtx(walletId, walletPassword, keystore, config);
        walletAddress = wc.publicKey.toBase58();
      } catch {}

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
    }

    const result = await tool.execute(parsed, ctx);

    // Record in spending ledger
    if (TRANSACTIONAL_TOOLS.has(toolName)) {
      recordTransaction(walletId, extractSolAmount(toolName, parsed), toolName);
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
    return c.json({ success: false, error: err.message }, err.name === "ZodError" ? 400 : 500);
  }
});

// ─── Wallet shortcuts ───

app.post("/wallets", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const password = (body as any).password || "";
  if (!password) return c.json({ success: false, error: "Password required" }, 400);
  try {
    return c.json({ success: true, ...keystore.create(password) });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

app.get("/wallets", (c) => {
  const wallets = keystore.list();
  return c.json({ wallets, count: wallets.length });
});

// ─── SSE events ───

app.get("/events", (c) => {
  return streamSSE(c, async (stream) => {
    for (const event of getRecentEvents()) {
      await stream.writeSSE({ data: JSON.stringify(event), event: "tool" });
    }
    let alive = true;
    stream.onAbort(() => { alive = false; });
    const cleanup = onToolEvent((event) => {
      if (alive) stream.writeSSE({ data: JSON.stringify(event), event: "tool" }).catch(() => {});
    });
    while (alive) await stream.sleep(15000);
    cleanup();
  });
});

// ─── Dashboard ───

const __dirname = dirname(fileURLToPath(import.meta.url));
let dashboardHtml: string | null = null;

app.get("/dashboard", (c) => {
  if (!dashboardHtml) dashboardHtml = readFileSync(join(__dirname, "dashboard.html"), "utf-8");
  return c.html(dashboardHtml);
});
app.get("/", (c) => c.redirect("/dashboard"));

// ─── Start ───

loadGuardrailConfig();

function extractSolAmount(tool: string, input: Record<string, any>): number {
  const SOL = "So11111111111111111111111111111111111111112";
  if (tool === "transfer" && !input.mint) return input.amount ?? 0;
  if (tool === "swap_tokens" && (!input.inputMint || input.inputMint === SOL)) return input.inputAmount ?? 0;
  if (tool === "stake_sol") return input.amount ?? 0;
  return 0;
}

const port = config.REST_PORT;
console.log(`🚀 Agento REST server on http://localhost:${port}`);
console.log(`   Dashboard: http://localhost:${port}/dashboard`);
console.log(`   Tools: ${ALL_TOOLS.length} available`);
serve({ fetch: app.fetch, port });
