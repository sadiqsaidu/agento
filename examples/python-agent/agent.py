"""
Agento Python Agent — standalone demo

Connects to a hosted Agento REST server, auto-discovers all available tools,
and lets an LLM (via OpenRouter) manage Solana wallets through function calling.

Zero dependency on the Agento Node.js codebase — pure HTTP.

Usage:
    python agent.py                              # default demo
    python agent.py "swap 0.1 SOL for USDC"     # custom task
    python agent.py -i                           # interactive chat
"""

import os
import sys
import json
import httpx
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

# ── Config ──

AGENTO_URL = os.environ.get("AGENTO_URL", "https://agento-8m72.onrender.com")
WALLET_ID = os.environ.get("WALLET_ID", "")
WALLET_PASSWORD = os.environ.get("WALLET_PASSWORD", "agento")
MODEL = os.environ.get("MODEL", "openai/gpt-4o-mini")

client = OpenAI(
    api_key=os.environ["OPENROUTER_API_KEY"],
    base_url="https://openrouter.ai/api/v1",
)

http = httpx.Client(timeout=60)

# ── Auto-discover tools from the live API ──

def discover_tools() -> list[dict]:
    """Fetch tool list from Agento and convert to OpenAI function-calling format."""
    resp = http.get(f"{AGENTO_URL}/tools")
    resp.raise_for_status()
    tools = resp.json()["tools"]

    openai_tools = []
    for t in tools:
        openai_tools.append({
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t["description"],
                "parameters": {"type": "object", "properties": {}},
            },
        })
    return openai_tools


# ── REST client ──

wallet_id: str = WALLET_ID


def call_tool(name: str, args: dict) -> dict:
    global wallet_id

    headers: dict[str, str] = {
        "Content-Type": "application/json",
        "X-Wallet-Password": WALLET_PASSWORD,
    }
    if wallet_id:
        headers["X-Wallet-Id"] = wallet_id

    resp = http.post(f"{AGENTO_URL}/tools/{name}", json=args, headers=headers)
    data = resp.json()

    # Auto-capture wallet ID on creation
    if name == "create_wallet" and data.get("success"):
        result = data.get("result", {})
        new_id = result.get("wallet_id") or result.get("id", "")
        if new_id:
            wallet_id = new_id
            print(f"  📝 Active wallet → {wallet_id[:8]}…")

    return data


# ── Agent loop ──

SYSTEM = """You are an AI agent managing Solana wallets through the Agento API.
You operate on Solana devnet. Common token mints:
  SOL:  So11111111111111111111111111111111111111112
  USDC: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v

Rules:
- If no wallet exists, create one first and airdrop SOL before doing anything.
- Be concise. Report results with addresses and amounts.
- If a tool fails, explain why and suggest a fix.
- The tools accept JSON parameters — pass them as the function arguments."""


def agent_loop(prompt: str, messages: list, tools: list, max_turns: int = 12) -> str | None:
    messages.append({"role": "user", "content": prompt})

    for _ in range(max_turns):
        resp = client.chat.completions.create(
            model=MODEL,
            messages=messages,
            tools=tools,
            tool_choice="auto",
        )

        msg = resp.choices[0].message
        messages.append(msg)

        if not msg.tool_calls:
            print(f"\n🤖 {msg.content}")
            return msg.content

        for tc in msg.tool_calls:
            fn = tc.function.name
            fn_args = json.loads(tc.function.arguments) if tc.function.arguments else {}
            print(f"  🔧 {fn}({json.dumps(fn_args)})")

            result = call_tool(fn, fn_args)
            icon = "✅" if result.get("success") else ("🛡️" if result.get("blocked") else "❌")
            print(f"  {icon} {json.dumps(result)[:200]}")

            messages.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": json.dumps(result),
            })

    print("⚠️  Max turns reached.")
    return None


def interactive(tools: list):
    messages: list = [{"role": "system", "content": SYSTEM}]
    print("Type your instructions (ctrl+c to quit):\n")
    while True:
        try:
            prompt = input("You: ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\n👋 Bye.")
            break
        if not prompt:
            continue
        agent_loop(prompt, messages, tools)
        print()


# ── Entry ──

def main():
    print(f"🌐 Agento: {AGENTO_URL}")
    print(f"🧠 Model:  {MODEL}")
    if wallet_id:
        print(f"💳 Wallet: {wallet_id[:8]}…")
    print()

    # Health check
    try:
        resp = http.get(f"{AGENTO_URL}/health")
        resp.raise_for_status()
    except (httpx.ConnectError, httpx.HTTPStatusError):
        print(f"❌ Cannot reach Agento at {AGENTO_URL}")
        sys.exit(1)
    print("✅ Agento is reachable.")

    # Auto-discover tools
    tools = discover_tools()
    print(f"🔧 Discovered {len(tools)} tools.\n")

    if "-i" in sys.argv or "--interactive" in sys.argv:
        interactive(tools)
    else:
        prompt = (
            " ".join(a for a in sys.argv[1:] if not a.startswith("-"))
            or "Create a new wallet, airdrop 2 SOL, then check the balance."
        )
        print(f"🎯 Task: {prompt}\n")
        messages: list = [{"role": "system", "content": SYSTEM}]
        agent_loop(prompt, messages, tools)


if __name__ == "__main__":
    main()
