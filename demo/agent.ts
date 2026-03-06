/**
 * Demo Agent — LangChain ReAct agent that connects to Agento via MCP
 *
 * This demonstrates the core value proposition:
 *   An AI agent (this file) connects to Agento's MCP server (src/mcp.ts)
 *   and autonomously manages a Solana wallet — creating wallets, checking
 *   balances, retrieving market data, executing swaps, placing limit orders,
 *   staking, and lending.
 *
 * Architecture:
 *   [This Agent] --stdio--> [Agento MCP Server] --RPC/API--> [Solana Devnet]
 *
 * Usage:
 *   1. Set env vars (OPENROUTER_API_KEY, WALLET_ID, WALLET_PASSWORD)
 *   2. npx tsx demo/agent.ts
 */

import { ChatOpenAI } from "@langchain/openai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import "dotenv/config";

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || "openai/gpt-oss-120b:free";
  if (!apiKey) {
    console.error("❌ OPENROUTER_API_KEY is required");
    process.exit(1);
  }

  // ── LLM via OpenRouter ──
  const llm = new ChatOpenAI({
    model,
    configuration: {
      baseURL: "https://openrouter.ai/api/v1",
    },
    apiKey,
    temperature: 0,
  });

  // ── Connect to Agento MCP server via stdio ──
  console.log("🔌 Connecting to Agento MCP server...\n");
  console.log(`🧠 Model: ${model}\n`);

  const mcpClient = new MultiServerMCPClient({
    mcpServers: {
      agento: {
        transport: "stdio",
        command: "npx",
        args: ["tsx", "src/mcp.ts"],
        env: {
          ...process.env as Record<string, string>,
          WALLET_ID: process.env.WALLET_ID || "",
          WALLET_PASSWORD: process.env.WALLET_PASSWORD || "agento",
        },
      },
    },
  });

  const tools = await mcpClient.getTools();
  console.log(
    `✅ Connected! Available tools: ${tools.map((t) => t.name).join(", ")}\n`,
  );

  // ── Create the ReAct agent ──
  const agent = createReactAgent({
    llm,
    tools,
    prompt: `You are an autonomous DeFi agent connected to an Agento wallet on Solana devnet.

You have access to a set of wallet and DeFi tools through the Agento MCP server.
Your capabilities include:
- Creating and managing Solana wallets
- Checking SOL and token balances
- Fetching token prices and market context
- Transferring SOL and SPL tokens
- Swapping tokens via Jupiter
- Creating and managing limit orders
- Liquid staking SOL for jupSOL
- Lending assets via Lulo for yield

When asked to perform operations:
1. Prefer information-gathering tools first unless the user explicitly asks for an on-chain action
2. Explain what you're doing before each action
3. Report transaction signatures after on-chain operations
4. If an action needs funds and the wallet appears unfunded, explain the constraint and suggest the user fund the wallet externally
5. Handle errors gracefully and suggest alternatives

You are running on Solana DEVNET — all transactions use test tokens.`,
  });

  // ── Run the agent ──
  const task =
    process.argv[2] ||
    "List the available Agento wallets, show the active wallet address, check its SOL balance, and fetch the current prices of SOL and USDC.";

  console.log(`📋 Task: ${task}\n`);
  console.log("─".repeat(60) + "\n");

  const stream = await agent.stream(
    { messages: [{ role: "user", content: task }] },
    { recursionLimit: 20 },
  );

  for await (const event of stream) {
    // Each event is keyed by node name: "agent" or "tools"
    const agentData = (event as any).agent;
    const toolsData = (event as any).tools;

    if (agentData?.messages) {
      for (const msg of agentData.messages) {
        if (msg.content && typeof msg.content === "string") {
          console.log(`🤖 Agent: ${msg.content}\n`);
        }
      }
    }
    if (toolsData?.messages) {
      for (const msg of toolsData.messages) {
        const toolName = msg.name || "tool";
        const content =
          typeof msg.content === "string"
            ? msg.content
            : JSON.stringify(msg.content, null, 2);
        console.log(`🔧 [${toolName}]: ${content}\n`);
      }
    }
  }

  // Cleanup
  await mcpClient.close();
  console.log("\n✅ Done");
}

main().catch((err) => {
  if (err?.message?.includes("429")) {
    console.error(
      "Fatal: OpenRouter rate limit hit. Set OPENROUTER_MODEL to a different available model or retry later.",
    );
    process.exit(1);
  }
  console.error("Fatal:", err.message);
  process.exit(1);
});
