/**
 * Agento Demo Agent — single agent testing all DeFi tools
 *
 * This agent connects to a running Agento REST server, auto-discovers
 * all available tools via SKILLS.md / GET /tools, and runs through
 * swap, stake, limit order, and lending operations autonomously.
 *
 * Usage:
 *   1. Start the server:  agento serve rest
 *   2. Create + fund a wallet via the CLI
 *   3. Set env vars in .env (WALLET_ID, WALLET_PASSWORD, OPENROUTER_API_KEY)
 *   4. Run:  npm run demo
 */

import { tool } from "@langchain/core/tools";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import "dotenv/config";

const AGENTO_URL = process.env.AGENTO_URL || "http://localhost:3000";
const WALLET_ID = process.env.WALLET_ID || "";
const WALLET_PASSWORD = process.env.WALLET_PASSWORD || "";

if (!WALLET_ID || !WALLET_PASSWORD) {
  console.error("❌ Set WALLET_ID and WALLET_PASSWORD in .env");
  process.exit(1);
}
if (!process.env.OPENROUTER_API_KEY) {
  console.error("❌ Set OPENROUTER_API_KEY in .env");
  process.exit(1);
}

// ── Health check ──

const health = await fetch(`${AGENTO_URL}/health`).catch(() => null);
if (!health?.ok) {
  console.error(`❌ Cannot reach Agento at ${AGENTO_URL}. Run: agento serve rest`);
  process.exit(1);
}

// ── Discover tools ──

const { tools: toolList } = await (await fetch(`${AGENTO_URL}/tools`)).json() as {
  tools: { name: string; description: string }[];
};

const skillDocs = toolList.map((t) => `• ${t.name}: ${t.description}`).join("\n");
console.log(`🔧 Discovered ${toolList.length} tools from Agento\n`);

// ── Generic Agento caller ──

const agento = tool(
  async ({ toolName, input }) => {
    try {
      const res = await fetch(`${AGENTO_URL}/tools/${toolName}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Wallet-Id": WALLET_ID,
          "X-Wallet-Password": WALLET_PASSWORD,
        },
        body: JSON.stringify(input ?? {}),
      });
      return JSON.stringify(await res.json());
    } catch (err) {
      return JSON.stringify({ error: String(err) });
    }
  },
  {
    name: "agento",
    description: `Call any Agento wallet tool by name. Available tools:\n${skillDocs}`,
    schema: z.object({
      toolName: z.string().describe("The exact tool name"),
      input: z.record(z.unknown()).optional().describe("Tool input parameters"),
    }),
  },
);

// ── LLM via OpenRouter ──

const llm = new ChatOpenAI({
  modelName: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
  temperature: 0,
  apiKey: process.env.OPENROUTER_API_KEY,
  configuration: { baseURL: "https://openrouter.ai/api/v1" },
});

const agent = createReactAgent({ llm, tools: [agento] });

// ── Test tasks ──

const tasks = [
  {
    name: "💰 Wallet & Prices",
    prompt: "Check my SOL balance, list all token balances, and fetch the current price of SOL and USDC.",
  },
  {
    name: "🔁 Swap SOL → USDC",
    prompt: "Swap 0.1 SOL for USDC. Then check my updated SOL and token balances.",
  },
  {
    name: "🥩 Stake SOL → jupSOL",
    prompt: "Stake 0.1 SOL for jupSOL. Then check my token balances to confirm.",
  },
  {
    name: "📋 Limit Order",
    prompt: `Place a limit order selling 50000000 lamports of SOL (inputMint: So11111111111111111111111111111111111111112) for at least 1000000 USDC units (outputMint: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v). Use makingAmount and takingAmount as strings. Then list all open orders.`,
  },
  {
    name: "❌ Cancel Orders",
    prompt: "List all my open limit orders. If any exist, cancel all of them.",
  },
  {
    name: "🏦 Lend USDC",
    prompt: "Lend 0.5 USDC (mintAddress: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v) to Lulo. Then check my token balances.",
  },
  {
    name: "🏧 Withdraw USDC",
    prompt: "Withdraw 0.5 USDC (mintAddress: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v) from Lulo. Then check my token balances.",
  },
];

// ── Run ──

console.log("🤖 Agento Demo Agent");
console.log(`📡 ${AGENTO_URL}`);
console.log(`💳 Wallet: ${WALLET_ID}`);
console.log(`👀 Dashboard: ${AGENTO_URL}/dashboard`);
console.log(`${"═".repeat(60)}\n`);

const results: { name: string; ok: boolean }[] = [];

for (const task of tasks) {
  console.log(`🧪 ${task.name}`);
  console.log("─".repeat(60));

  try {
    const { messages } = await agent.invoke({
      messages: [new HumanMessage(task.prompt)],
    });
    const reply = messages.at(-1)?.content;
    console.log(`\n🤖 ${typeof reply === "string" ? reply : JSON.stringify(reply)}\n`);
    results.push({ name: task.name, ok: true });
  } catch (err) {
    console.error(`\n❌ ${err instanceof Error ? err.message : err}\n`);
    results.push({ name: task.name, ok: false });
  }
}

console.log("═".repeat(60));
console.log("📊 RESULTS");
console.log("═".repeat(60));
results.forEach((r) => console.log(`${r.ok ? "✅" : "❌"}  ${r.name}`));
console.log(`\n👀 Full activity log: ${AGENTO_URL}/dashboard\n`);
