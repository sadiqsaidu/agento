# Python Agent Demo

A standalone Python agent that connects to a hosted Agento REST server and manages Solana wallets via LLM function-calling.

**Zero dependency on the Agento Node.js codebase** — talks pure HTTP.

## How it works

1. Connects to the Agento REST API (hosted or local)
2. Auto-discovers all 18 tools from `GET /tools`
3. Converts them to OpenAI function-calling format
4. ReAct loop: prompt → LLM picks tool → HTTP call → LLM responds

## Quick start

```bash
cd examples/python-agent

python -m venv .venv
source .venv/bin/activate

pip install -r requirements.txt

cp .env.example .env
# Edit .env — add your OPENROUTER_API_KEY

python agent.py                                # default demo
python agent.py "check SOL price"              # custom task
python agent.py -i                             # interactive chat
```

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENROUTER_API_KEY` | Yes | — | From [openrouter.ai](https://openrouter.ai/keys) |
| `AGENTO_URL` | No | `https://agento-8m72.onrender.com` | Agento server URL |
| `WALLET_PASSWORD` | No | `agento` | Password for wallet ops |
| `WALLET_ID` | No | — | Pre-existing wallet (agent creates if empty) |
| `MODEL` | No | `openai/gpt-4o-mini` | Any OpenRouter model |
