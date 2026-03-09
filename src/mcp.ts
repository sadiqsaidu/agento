/**
 * Agento MCP Server — stdio transport
 *
 * Exposes all wallet + DeFi tools via the Model Context Protocol.
 * AI agents connect to this via stdio (e.g. Claude Desktop, LangChain MCP adapters).
 *
 * Usage: WALLET_ID=<id> WALLET_PASSWORD=<pw> npx tsx src/mcp.ts
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { createKeystore } from "./wallet.js";
import { ALL_TOOLS, type ToolContext } from "./tools.js";
import { emitToolEvent, summarize } from "./events.js";
import {
  TRANSACTIONAL_TOOLS,
  checkGuardrails,
  recordTransaction,
  loadGuardrailConfig,
} from "./guardrails.js";

async function main() {
  const config = loadConfig();
  const keystore = createKeystore(config);

  // Wallet ID & password from env (set by the agent that spawns this process)
  const walletId = process.env.WALLET_ID || "";
  const walletPassword = process.env.WALLET_PASSWORD || "agento";

  const ctx: ToolContext = {
    keystore,
    config,
    walletId,
    password: walletPassword,
  };

  // Initialize guardrails
  loadGuardrailConfig();

  const server = new McpServer({
    name: "agento",
    version: "0.2.0",
  });

  // Register every tool from the shared registry
  for (const tool of ALL_TOOLS) {
    // Extract the raw shape from the zod schema for MCP registration
    const shape = tool.schema instanceof z.ZodObject ? tool.schema.shape : {};

    server.tool(
      tool.name,
      tool.description,
      shape,
      async (args: Record<string, unknown>) => {
        const start = Date.now();
        try {
          const parsed = tool.schema.parse(args);

          // ── Guardrail check for transactional tools ──
          if (TRANSACTIONAL_TOOLS.has(tool.name)) {
            let walletAddress = "";
            try {
              const { getWalletCtx } = await import("./wallet.js");
              const wc = getWalletCtx(walletId, walletPassword, keystore, config);
              walletAddress = wc.publicKey.toBase58();
            } catch { /* wallet may not exist yet */ }

            const guard = await checkGuardrails(tool.name, parsed, walletId, config, walletAddress);
            if (!guard.allowed) {
              emitToolEvent({
                timestamp: new Date().toISOString(),
                tool: tool.name,
                wallet: walletId ? walletId.slice(0, 8) : "none",
                status: "blocked",
                durationMs: Date.now() - start,
                summary: `🛡️ ${guard.rule}: ${guard.reason}`,
                blockedBy: guard.rule ?? undefined,
                source: "mcp",
              });
              return {
                content: [{
                  type: "text" as const,
                  text: `Blocked by guardrail [${guard.rule}]: ${guard.reason}`,
                }],
                isError: true,
              };
            }
          }

          const result = await tool.execute(parsed, ctx);

          // Record successful transactional operations
          if (TRANSACTIONAL_TOOLS.has(tool.name)) {
            const SOL_MINT = "So11111111111111111111111111111111111111112";
            let amountSol = 0;
            const p = parsed as Record<string, any>;
            if (tool.name === "transfer" && !p.mint) amountSol = p.amount ?? 0;
            else if (tool.name === "swap_tokens" && (!p.inputMint || p.inputMint === SOL_MINT)) amountSol = p.inputAmount ?? 0;
            else if (tool.name === "stake_sol") amountSol = p.amount ?? 0;
            recordTransaction(walletId, amountSol, tool.name);
          }

          emitToolEvent({
            timestamp: new Date().toISOString(),
            tool: tool.name,
            wallet: walletId ? walletId.slice(0, 8) : "none",
            status: "success",
            durationMs: Date.now() - start,
            summary: summarize(tool.name, result),
            source: "mcp",
          });
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (err: any) {
          emitToolEvent({
            timestamp: new Date().toISOString(),
            tool: tool.name,
            wallet: walletId ? walletId.slice(0, 8) : "none",
            status: "error",
            durationMs: Date.now() - start,
            summary: err.message,
            source: "mcp",
          });
          return {
            content: [{ type: "text" as const, text: `Error: ${err.message}` }],
            isError: true,
          };
        }
      },
    );
  }

  // Start stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("🔌 Agento MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
