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

  const server = new McpServer({
    name: "agento",
    version: "0.1.0",
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
          const result = await tool.execute(parsed, ctx);
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
