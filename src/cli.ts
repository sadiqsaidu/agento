#!/usr/bin/env node
/**
 * Agento CLI — wallet management + live agent monitoring
 *
 * Setup commands let a developer create/manage wallets.
 * The `monitor` command is the star: a live-tail of every tool
 * execution flowing through the Agento REST server, so you can
 * watch your AI agent operate in real-time.
 *
 * Usage:
 *   npx tsx src/cli.ts wallet create --password <pw>
 *   npx tsx src/cli.ts wallet list
 *   npx tsx src/cli.ts wallet info <id> --password <pw>
 *   npx tsx src/cli.ts wallet fund <id> --password <pw>
 *   npx tsx src/cli.ts wallet import <base58-key> --password <pw>
 *   npx tsx src/cli.ts wallet export <id> --password <pw>
 *   npx tsx src/cli.ts wallet delete <id>
 *   npx tsx src/cli.ts serve rest [--port 3000]
 *   npx tsx src/cli.ts serve mcp --wallet <id> --password <pw>
 *   npx tsx src/cli.ts monitor [--port 3000]
 */

import { loadConfig } from "./config.js";
import { createKeystore, solBalance, tokenBalances } from "./wallet.js";
import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import type { ToolEvent } from "./events.js";

// ── Arg helpers ──

const args = process.argv.slice(2);

function getArg(index: number): string | undefined {
  return args[index];
}

function getFlag(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

// ── ANSI colors ──

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BLUE = "\x1b[34m";

function log(msg: string) {
  console.log(msg);
}
function success(msg: string) {
  log(`${GREEN}✅ ${msg}${RESET}`);
}
function fail(msg: string): never {
  log(`${RED}❌ ${msg}${RESET}`);
  process.exit(1);
}
function info(msg: string) {
  log(`${CYAN}ℹ  ${msg}${RESET}`);
}
function header(msg: string) {
  log(`\n${BOLD}${msg}${RESET}\n`);
}

// ── Main dispatch ──

async function main() {
  const command = getArg(0);
  const sub = getArg(1);

  if (!command || command === "help" || command === "--help") {
    printHelp();
    return;
  }

  switch (command) {
    case "wallet":
      await handleWallet(sub);
      break;
    case "serve":
      await handleServe(sub);
      break;
    case "monitor":
      await handleMonitor();
      break;
    default:
      fail(`Unknown command: ${command}. Run 'agento help' for usage.`);
  }
}

// ═══════════════════════════════════════════════════════
//  WALLET COMMANDS
// ═══════════════════════════════════════════════════════

async function handleWallet(sub: string | undefined) {
  const config = loadConfig();
  const keystore = createKeystore(config);
  const password = getFlag("password") || process.env.AGENTO_PASSWORD || "";

  switch (sub) {
    case "create": {
      if (!password) fail("Password required: --password <pw> or set AGENTO_PASSWORD env");
      const { id, address } = keystore.create(password);
      header("Wallet Created");
      log(`  ${DIM}ID:${RESET}      ${id}`);
      log(`  ${DIM}Address:${RESET} ${address}`);
      log(`  ${DIM}Network:${RESET} devnet`);
      log(`\n  ${DIM}Fund it:${RESET} npx tsx src/cli.ts wallet fund ${id} --password <pw>`);
      break;
    }

    case "list": {
      const wallets = keystore.list();
      header(`Wallets (${wallets.length})`);
      if (wallets.length === 0) {
        info("No wallets yet. Create one: npx tsx src/cli.ts wallet create --password <pw>");
        return;
      }
      for (const w of wallets) {
        log(`  ${BLUE}${w.id}${RESET}`);
        log(`    ${DIM}Address:${RESET} ${w.address}`);
        log(`    ${DIM}Created:${RESET} ${w.created_at}`);
        log("");
      }
      break;
    }

    case "info": {
      const walletId = getArg(2);
      if (!walletId) fail("Usage: agento wallet info <wallet-id> --password <pw>");
      if (!password) fail("Password required: --password <pw>");

      const keypair = keystore.unlock(walletId, password);
      const address = keypair.publicKey.toBase58();
      const balance = await solBalance(address, config.SOLANA_RPC_URL);
      const conn = new Connection(config.SOLANA_RPC_URL, "confirmed");
      const tokens = await tokenBalances(conn, keypair.publicKey);

      header("Wallet Info");
      log(`  ${DIM}ID:${RESET}      ${walletId}`);
      log(`  ${DIM}Address:${RESET} ${address}`);
      log(`  ${DIM}Balance:${RESET} ${GREEN}${balance} SOL${RESET}`);

      if (tokens.length > 0) {
        log(`\n  ${DIM}Tokens:${RESET}`);
        for (const t of tokens) {
          log(`    ${t.mint.slice(0, 12)}… ${GREEN}${t.uiAmount}${RESET} (decimals: ${t.decimals})`);
        }
      }
      break;
    }

    case "fund": {
      const walletId = getArg(2);
      if (!walletId) fail("Usage: agento wallet fund <wallet-id> --password <pw>");
      if (!password) fail("Password required: --password <pw>");

      const keypair = keystore.unlock(walletId, password);
      const conn = new Connection(config.SOLANA_RPC_URL, "confirmed");

      info("Requesting devnet airdrop (1 SOL)...");
      const sig = await conn.requestAirdrop(keypair.publicKey, LAMPORTS_PER_SOL);
      const bh = await conn.getLatestBlockhash();
      await conn.confirmTransaction(
        { signature: sig, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight },
        "confirmed",
      );

      success(`Airdropped 1 SOL → ${keypair.publicKey.toBase58()}`);
      log(`  ${DIM}Signature:${RESET} ${sig}`);
      break;
    }

    case "import": {
      const privateKey = getArg(2);
      if (!privateKey) fail("Usage: agento wallet import <base58-private-key> --password <pw>");
      if (!password) fail("Password required: --password <pw>");

      const { id, address } = keystore.import(privateKey, password);
      success("Imported wallet");
      log(`  ${DIM}ID:${RESET}      ${id}`);
      log(`  ${DIM}Address:${RESET} ${address}`);
      break;
    }

    case "export": {
      const walletId = getArg(2);
      if (!walletId) fail("Usage: agento wallet export <wallet-id> --password <pw>");
      if (!password) fail("Password required: --password <pw>");

      const key = keystore.export(walletId, password);
      log(`\n${YELLOW}⚠ WARNING: Keep this private key safe. Anyone with it controls the wallet.${RESET}\n`);
      log(`  ${key}`);
      break;
    }

    case "delete": {
      const walletId = getArg(2);
      if (!walletId) fail("Usage: agento wallet delete <wallet-id>");

      keystore.delete(walletId);
      success(`Deleted wallet ${walletId}`);
      break;
    }

    default:
      fail(
        `Unknown wallet command: ${sub}\n   Options: create, list, info, fund, import, export, delete`,
      );
  }
}

// ═══════════════════════════════════════════════════════
//  SERVE COMMANDS
// ═══════════════════════════════════════════════════════

async function handleServe(sub: string | undefined) {
  switch (sub) {
    case "rest": {
      // Override port if flag provided
      const port = getFlag("port");
      if (port) process.env.REST_PORT = port;
      await import("./rest.js");
      break;
    }

    case "mcp": {
      const wallet = getFlag("wallet") || process.env.WALLET_ID || "";
      const password = getFlag("password") || process.env.WALLET_PASSWORD || "agento";
      if (!wallet) fail("Wallet ID required: --wallet <id> or set WALLET_ID env");
      process.env.WALLET_ID = wallet;
      process.env.WALLET_PASSWORD = password;
      await import("./mcp.js");
      break;
    }

    default:
      fail(`Unknown serve target: ${sub}\n   Options: rest, mcp`);
  }
}

// ═══════════════════════════════════════════════════════
//  MONITOR — live-tail agent activity via SSE
// ═══════════════════════════════════════════════════════

async function handleMonitor() {
  const port = getFlag("port") || process.env.REST_PORT || "3000";
  const url = `http://localhost:${port}/events`;

  header("Agento Monitor");
  info(`Connecting to REST server at localhost:${port}...`);
  log(`${DIM}${"─".repeat(68)}${RESET}`);
  log(
    `  ${DIM}TIME${RESET}      ${DIM}ST${RESET}  ${DIM}TOOL${RESET}                   ${DIM}SUMMARY${RESET}`,
  );
  log(`${DIM}${"─".repeat(68)}${RESET}\n`);

  try {
    const res = await fetch(url, {
      headers: { Accept: "text/event-stream" },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    if (!res.body) throw new Error("No response body — SSE not supported");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        info("Server closed connection.");
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // keep incomplete line in buffer

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (!data) continue;

        try {
          const event: ToolEvent = JSON.parse(data);
          printEvent(event);
        } catch {
          // skip non-JSON (ping keepalives, etc.)
        }
      }
    }
  } catch (err: any) {
    const msg = err?.cause?.code || err.message || String(err);
    if (msg === "ECONNREFUSED" || msg.includes("ECONNREFUSED")) {
      fail(
        `Cannot connect to Agento REST server at localhost:${port}.\n   Start it first: npx tsx src/cli.ts serve rest`,
      );
    }
    fail(`Monitor connection failed: ${msg}`);
  }
}

function printEvent(event: ToolEvent) {
  const time = new Date(event.timestamp).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const icon = event.status === "success" ? `${GREEN}✅${RESET}` : `${RED}❌${RESET}`;
  const tool = `${CYAN}${event.tool.padEnd(22)}${RESET}`;
  const ms = `${DIM}${String(event.durationMs).padStart(5)}ms${RESET}`;
  const wallet = `${DIM}[${event.wallet}]${RESET}`;

  log(`  ${DIM}${time}${RESET}  ${icon}  ${tool} ${event.summary.padEnd(36)} ${ms} ${wallet}`);
}

// ── Help ──

function printHelp() {
  log(`
${BOLD}Agento${RESET} — Agentic wallet for AI agents on Solana

${BOLD}WALLET COMMANDS${RESET}
  wallet create  --password <pw>            Create a new encrypted wallet
  wallet list                               List all wallets in keystore
  wallet info    <id> --password <pw>       Show address, SOL balance, tokens
  wallet fund    <id> --password <pw>       Airdrop 1 devnet SOL
  wallet import  <key> --password <pw>      Import from base58 private key
  wallet export  <id> --password <pw>       Export private key (base58)
  wallet delete  <id>                       Permanently remove a wallet

${BOLD}SERVER COMMANDS${RESET}
  serve rest  [--port 3000]                 Start REST API server
  serve mcp   --wallet <id> --password <pw> Start MCP server (stdio)

${BOLD}MONITORING${RESET}
  monitor [--port 3000]                     Live-tail agent tool executions

${BOLD}ENVIRONMENT VARIABLES${RESET}
  AGENTO_PASSWORD     Default password (avoids --password flag)
  SOLANA_RPC_URL      RPC endpoint (default: devnet)
  REST_PORT           REST server port (default: 3000)
  KEYSTORE_DIR        Wallet storage dir (default: ./wallets)

${BOLD}EXAMPLES${RESET}
  ${DIM}# Setup: create and fund a wallet${RESET}
  npx tsx src/cli.ts wallet create --password my-secret
  npx tsx src/cli.ts wallet fund <id> --password my-secret

  ${DIM}# Start REST server, then monitor agent activity${RESET}
  npx tsx src/cli.ts serve rest
  npx tsx src/cli.ts monitor            ${DIM}# in another terminal${RESET}

  ${DIM}# Start MCP server for Claude Desktop${RESET}
  npx tsx src/cli.ts serve mcp --wallet <id> --password my-secret
`);
}

main().catch((err) => {
  log(`${RED}Fatal: ${err.message}${RESET}`);
  process.exit(1);
});
