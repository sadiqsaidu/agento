#!/usr/bin/env node

import { loadConfig } from "./config.js";
import { createKeystore, solBalance, tokenBalances } from "./wallet.js";
import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import type { ToolEvent } from "./events.js";

// ── ANSI ──

const R = "\x1b[0m";
const B = "\x1b[1m";
const D = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BLUE = "\x1b[34m";
const MAGENTA = "\x1b[35m";

// ── Arg helpers ──

const args = process.argv.slice(2);

function arg(i: number) {
  return args[i];
}

function flag(name: string) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : undefined;
}

// ── Output helpers ──

const log = console.log;

function ok(msg: string) {
  log(`${GREEN}✅ ${msg}${R}`);
}

function fail(msg: string): never {
  log(`${RED}❌ ${msg}${R}`);
  process.exit(1);
}

function info(msg: string) {
  log(`${CYAN}ℹ  ${msg}${R}`);
}

// ── Banner ──

const VERSION = "0.1.0";

function banner() {
  log(`
${YELLOW}  ╔═══════════════════════════════════════════════╗${R}
${YELLOW}  ║${R}  ${B}Welcome to ${CYAN}Agento${R} ${D}v${VERSION}${R}                      ${YELLOW}║${R}
${YELLOW}  ╚═══════════════════════════════════════════════╝${R}

${MAGENTA}   █████╗  ██████╗ ███████╗███╗   ██╗████████╗ ██████╗${R}
${MAGENTA}  ██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝██╔═══██╗${R}
${MAGENTA}  ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ██║   ██║${R}
${MAGENTA}  ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ██║   ██║${R}
${MAGENTA}  ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ╚██████╔╝${R}
${MAGENTA}  ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝    ╚═════╝${R}

${D}  Agentic wallet infrastructure for AI agents on Solana${R}
`);
}

// ── Main ──

async function main() {
  const command = arg(0);

  if (!command || command === "help" || command === "--help" || command === "-h") {
    banner();
    printHelp();
    return;
  }

  if (command === "--version" || command === "-v") {
    log(`agento v${VERSION}`);
    return;
  }

  switch (command) {
    case "wallet":
      await handleWallet(arg(1));
      break;
    case "serve":
      await handleServe(arg(1));
      break;
    case "monitor":
      await handleMonitor();
      break;
    default:
      fail(`Unknown command: ${command}\n   Run 'agento help' for usage.`);
  }
}

// ═══════════════════════════════════════════════════════
//  WALLET
// ═══════════════════════════════════════════════════════

async function handleWallet(sub: string | undefined) {
  const config = loadConfig();
  const keystore = createKeystore(config);
  const password = flag("password") || process.env.AGENTO_PASSWORD || "";

  switch (sub) {
    case "create": {
      if (!password) fail("Password required: --password <pw> or AGENTO_PASSWORD env");
      const { id, address } = keystore.create(password);
      log(`\n${B}Wallet Created${R}\n`);
      log(`  ${D}ID:${R}      ${id}`);
      log(`  ${D}Address:${R} ${address}`);
      log(`  ${D}Network:${R} devnet`);
      log(`\n  ${D}Fund it:${R} agento wallet fund ${id} --password <pw>\n`);
      break;
    }

    case "list": {
      const wallets = keystore.list();
      log(`\n${B}Wallets (${wallets.length})${R}\n`);
      if (wallets.length === 0) {
        info("No wallets. Create one: agento wallet create --password <pw>");
        return;
      }
      for (const w of wallets) {
        log(`  ${BLUE}${w.id}${R}`);
        log(`    ${D}Address:${R} ${w.address}`);
        log(`    ${D}Created:${R} ${w.created_at}\n`);
      }
      break;
    }

    case "info": {
      const id = arg(2);
      if (!id) fail("Usage: agento wallet info <id> --password <pw>");
      if (!password) fail("Password required");
      const kp = keystore.unlock(id, password);
      const addr = kp.publicKey.toBase58();
      const bal = await solBalance(addr, config.SOLANA_RPC_URL);
      const conn = new Connection(config.SOLANA_RPC_URL, "confirmed");
      const tokens = await tokenBalances(conn, kp.publicKey);

      log(`\n${B}Wallet Info${R}\n`);
      log(`  ${D}ID:${R}      ${id}`);
      log(`  ${D}Address:${R} ${addr}`);
      log(`  ${D}Balance:${R} ${GREEN}${bal} SOL${R}`);
      if (tokens.length > 0) {
        log(`\n  ${D}Tokens:${R}`);
        for (const t of tokens)
          log(`    ${t.mint.slice(0, 12)}… ${GREEN}${t.uiAmount}${R} (decimals: ${t.decimals})`);
      }
      log("");
      break;
    }

    case "fund": {
      const id = arg(2);
      if (!id) fail("Usage: agento wallet fund <id> --password <pw>");
      if (!password) fail("Password required");
      const kp = keystore.unlock(id, password);
      const conn = new Connection(config.SOLANA_RPC_URL, "confirmed");
      info("Requesting devnet airdrop (1 SOL)...");
      const sig = await conn.requestAirdrop(kp.publicKey, LAMPORTS_PER_SOL);
      const bh = await conn.getLatestBlockhash();
      await conn.confirmTransaction(
        { signature: sig, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight },
        "confirmed",
      );
      ok(`Airdropped 1 SOL → ${kp.publicKey.toBase58()}`);
      log(`  ${D}Signature:${R} ${sig}\n`);
      break;
    }

    case "import": {
      const key = arg(2);
      if (!key) fail("Usage: agento wallet import <base58-key> --password <pw>");
      if (!password) fail("Password required");
      const { id, address } = keystore.import(key, password);
      ok("Imported wallet");
      log(`  ${D}ID:${R}      ${id}`);
      log(`  ${D}Address:${R} ${address}\n`);
      break;
    }

    case "export": {
      const id = arg(2);
      if (!id) fail("Usage: agento wallet export <id> --password <pw>");
      if (!password) fail("Password required");
      const key = keystore.export(id, password);
      log(`\n${YELLOW}⚠ Keep this private key safe. Anyone with it controls the wallet.${R}\n`);
      log(`  ${key}\n`);
      break;
    }

    case "delete": {
      const id = arg(2);
      if (!id) fail("Usage: agento wallet delete <id>");
      keystore.delete(id);
      ok(`Deleted wallet ${id}\n`);
      break;
    }

    default:
      fail(`Unknown wallet command: ${sub}\n   Options: create, list, info, fund, import, export, delete`);
  }
}

// ═══════════════════════════════════════════════════════
//  SERVE
// ═══════════════════════════════════════════════════════

async function handleServe(sub: string | undefined) {
  switch (sub) {
    case "rest": {
      const port = flag("port");
      if (port) process.env.REST_PORT = port;
      banner();
      log(`${D}  Starting REST server...${R}\n`);
      await import("./rest.js");
      break;
    }
    case "mcp": {
      const wallet = flag("wallet") || process.env.WALLET_ID || "";
      const pw = flag("password") || process.env.WALLET_PASSWORD || "agento";
      if (!wallet) fail("Wallet ID required: --wallet <id> or WALLET_ID env");
      process.env.WALLET_ID = wallet;
      process.env.WALLET_PASSWORD = pw;
      await import("./mcp.js");
      break;
    }
    default:
      fail(`Unknown serve target: ${sub}\n   Options: rest, mcp`);
  }
}

// ═══════════════════════════════════════════════════════
//  MONITOR
// ═══════════════════════════════════════════════════════

async function handleMonitor() {
  const host = flag("host") || process.env.AGENTO_HOST || "http://localhost:3000";
  const url = `${host}/events`;

  banner();
  log(`${B}  Live Monitor${R}`);
  info(`Connecting to ${host}...`);
  log(`${D}${"─".repeat(72)}${R}`);
  log(`  ${D}TIME${R}      ${D}ST${R}  ${D}TOOL${R}                   ${D}SUMMARY${R}`);
  log(`${D}${"─".repeat(72)}${R}\n`);

  try {
    const res = await fetch(url, { headers: { Accept: "text/event-stream" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!res.body) throw new Error("No response body");

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
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (!data) continue;
        try {
          printEvent(JSON.parse(data) as ToolEvent);
        } catch { /* skip non-JSON keepalives */ }
      }
    }
  } catch (err: any) {
    const msg = err?.cause?.code || err.message || String(err);
    if (msg.includes("ECONNREFUSED"))
      fail(`Cannot connect to ${host}.\n   Start the server first: agento serve rest`);
    fail(`Monitor failed: ${msg}`);
  }
}

function printEvent(e: ToolEvent) {
  const time = new Date(e.timestamp).toLocaleTimeString("en-US", {
    hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const icon = e.status === "success" ? `${GREEN}✅${R}`
    : e.status === "blocked" ? `${YELLOW}🛡️${R}`
    : `${RED}❌${R}`;
  const tool = `${CYAN}${e.tool.padEnd(22)}${R}`;
  const ms = `${D}${String(e.durationMs).padStart(5)}ms${R}`;
  const wallet = `${D}[${e.wallet}]${R}`;
  log(`  ${D}${time}${R}  ${icon}  ${tool} ${e.summary.padEnd(36)} ${ms} ${wallet}`);
}

// ── Help ──

function printHelp() {
  log(`${B}USAGE${R}
  ${CYAN}agento${R} <command> [options]

${B}WALLET${R}
  wallet create  --password <pw>            Create encrypted wallet
  wallet list                               List all wallets
  wallet info    <id> --password <pw>       Balance + token info
  wallet fund    <id> --password <pw>       Airdrop 1 devnet SOL
  wallet import  <key> --password <pw>      Import base58 private key
  wallet export  <id> --password <pw>       Export private key
  wallet delete  <id>                       Remove wallet

${B}SERVER${R}
  serve rest  [--port 3000]                 Start REST API
  serve mcp   --wallet <id> --password <pw> Start MCP server (stdio)

${B}MONITOR${R}
  monitor [--host http://localhost:3000]    Live-tail agent activity

${B}OPTIONS${R}
  --help, -h        Show this help
  --version, -v     Show version

${B}ENVIRONMENT${R}
  AGENTO_PASSWORD   Default wallet password
  AGENTO_HOST       Monitor target (default: http://localhost:3000)
  SOLANA_RPC_URL    RPC endpoint (default: devnet)
  REST_PORT         Server port (default: 3000)
  KEYSTORE_DIR      Wallet storage (default: ./wallets)

${B}EXAMPLES${R}
  ${D}# First time setup${R}
  agento wallet create --password my-secret
  agento wallet fund <id> --password my-secret

  ${D}# Start the server${R}
  agento serve rest

  ${D}# Monitor agent activity (works with hosted server too)${R}
  agento monitor --host https://agento-8m72.onrender.com

  ${D}# MCP for Claude Desktop / Cursor${R}
  agento serve mcp --wallet <id> --password my-secret
`);
}

// ── Go ──

main().catch((err) => {
  console.error("Fatal:", err.message || err);
  process.exit(1);
});
