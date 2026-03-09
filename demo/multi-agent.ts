/**
 * Agento Multi-Agent Demo — 3 agents, each managing their own wallet
 *
 * Demonstrates Agento's multi-agent scalability:
 *   Agent 1 ("Trader")    — swaps SOL for USDC
 *   Agent 2 ("Staker")    — stakes SOL for jupSOL
 *   Agent 3 ("Lender")    — swaps SOL → USDC then lends it on Lulo
 *
 * Each agent has its own wallet, its own credentials, and operates independently.
 * All activity is visible in the Agento dashboard / CLI monitor simultaneously.
 *
 * Usage:
 *   1. Start the server:  agento serve rest
 *   2. Create 3 wallets + fund each with ~2 SOL
 *   3. Set env vars in .env
 *   4. Run:  npm run demo:multi
 */

import { tool } from "@langchain/core/tools";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import "dotenv/config";

const AGENTO_URL = process.env.AGENTO_URL || "http://localhost:3000";

if (!process.env.OPENROUTER_API_KEY) {
  console.error("❌ Set OPENROUTER_API_KEY in .env");
  process.exit(1);
}

// ── Agent config — each agent has its own wallet ──

interface AgentConfig {
  name: string;
  emoji: string;
  walletId: string;
  password: string;
  task: string;
}

const agents: AgentConfig[] = [
  {
    name: "Trader",
    emoji: "🔁",
    walletId: process.env.AGENT1_WALLET_ID || "",
    password: process.env.AGENT1_PASSWORD || "",
    task: "Check my SOL balance. Then swap 0.1 SOL for USDC. Report the result and my updated balances.",
  },
  {
    name: "Staker",
    emoji: "🥩",
    walletId: process.env.AGENT2_WALLET_ID || "",
    password: process.env.AGENT2_PASSWORD || "",
    task: "Check my SOL balance. Then stake 0.1 SOL for jupSOL. Report the result and my updated token balances.",
  },
  {
    name: "Lender",
    emoji: "🏦",
    walletId: process.env.AGENT3_WALLET_ID || "",
    password: process.env.AGENT3_PASSWORD || "",
    task: "Check my SOL balance. Swap 0.2 SOL for USDC. Then lend 0.5 USDC (mintAddress: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v) on Lulo. Report results at each step.",
  },
];

// Validate all wallets are configured
for (const a of agents) {
  if (!a.walletId || !a.password) {
    console.error(`❌ ${a.name} agent missing wallet config.`);
    console.error("   Set AGENT1_WALLET_ID, AGENT1_PASSWORD, AGENT2_WALLET_ID, etc. in .env");
    process.exit(1);
  }
}

// ── Health check ──

const health = await fetch(`${AGENTO_URL}/health`).catch(() => null);
if (!health?.ok) {
  console.error(`❌ Cannot reach Agento at ${AGENTO_URL}. Run: agento serve rest`);
  process.exit(1);
}

// ── Discover tools once ──

const { tools: toolList } = await (await fetch(`${AGENTO_URL}/tools`)).json() as {
  tools: { name: string; description: string }[];
};
const skillDocs = toolList.map((t) => `• ${t.name}: ${t.description}`).join("\n");

// ── Create an agent for a given wallet ──

function createAgentForWallet(walletId: string, password: string) {
  const caller = tool(
    async ({ toolName, input }) => {
      try {
        const res = await fetch(`${AGENTO_URL}/tools/${toolName}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Wallet-Id": walletId,
            "X-Wallet-Password": password,
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

  const llm = new ChatOpenAI({
    modelName: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
    temperature: 0,
    apiKey: process.env.OPENROUTER_API_KEY,
    configuration: { baseURL: "https://openrouter.ai/api/v1" },
  });

  return createReactAgent({ llm, tools: [caller] });
}

// ── Run all agents in parallel ──

console.log("🤖 Agento Multi-Agent Demo");
console.log(`📡 ${AGENTO_URL}`);
console.log(`👀 Dashboard: ${AGENTO_URL}/dashboard`);
console.log(`${"═".repeat(60)}`);
console.log(`Running ${agents.length} agents in parallel...\n`);

const tasks = agents.map(async (config) => {
  const startTime = Date.now();
  console.log(`${config.emoji} [${config.name}] Starting... (wallet: ${config.walletId.slice(0, 8)}…)`);

  try {
    const agent = createAgentForWallet(config.walletId, config.password);
    const { messages } = await agent.invoke({
      messages: [new HumanMessage(config.task)],
    });
    const reply = messages.at(-1)?.content;
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n${config.emoji} [${config.name}] Done in ${duration}s:`);
    console.log(`   ${typeof reply === "string" ? reply.replace(/\n/g, "\n   ") : JSON.stringify(reply)}\n`);
    return { name: config.name, ok: true };
  } catch (err) {
    console.error(`\n${config.emoji} [${config.name}] ❌ ${err instanceof Error ? err.message : err}\n`);
    return { name: config.name, ok: false };
  }
});

const results = await Promise.all(tasks);

console.log("═".repeat(60));
console.log("📊 MULTI-AGENT RESULTS");
console.log("═".repeat(60));
for (const r of results) {
  console.log(`${r.ok ? "✅" : "❌"}  ${r.name}`);
}
console.log(`\n👀 Watch all activity: ${AGENTO_URL}/dashboard\n`);
