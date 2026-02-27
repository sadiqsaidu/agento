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

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { createKeystore } from "./wallet.js";
import { ALL_TOOLS, type ToolContext } from "./tools.js";

const config = loadConfig();
const keystore = createKeystore(config);

const app = new Hono();

// ─── Health check ───

app.get("/health", (c) =>
  c.json({ status: "ok", name: "agento", version: "0.1.0" }),
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
    const result = await tool.execute(parsed, ctx);
    return c.json({ success: true, result });
  } catch (err: any) {
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

// ─── Start ───

const port = config.REST_PORT;
console.log(`🚀 Agento REST server listening on http://localhost:${port}`);
console.log(`   Tools: ${ALL_TOOLS.length} available`);
console.log(`   Keystore: ${config.KEYSTORE_DIR}`);
serve({ fetch: app.fetch, port });
