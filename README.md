# Operon Research Agent

A DeFi research agent built on [ElizaOS](https://github.com/elizaos/eliza), powered by [Operon](https://operon.so) for quality-weighted sponsored service discovery. Forked from [elizaOS/otaku](https://github.com/elizaOS/otaku).

This is a **reference implementation** showing how to integrate the [@operon/plugin-publisher-sdk](https://github.com/operonhq/plugin-publisher-sdk) into an ElizaOS agent. The agent provides DeFi research and analysis, with Operon automatically matching relevant sponsored services when appropriate.

## What it does

- **DeFi Research** - Protocol analysis, yield comparisons, risk assessment, smart money tracking
- **Market Data** - Real-time token prices, trending assets, TVL analytics via CoinGecko, DeFiLlama, and Nansen
- **Sponsored Discovery** - Operon's quality-weighted auction surfaces relevant services in responses, marked as sponsored
- **Read-Only** - This agent analyzes and recommends. It does not execute transactions.

## How Operon integration works

The `@operon/plugin-publisher-sdk` runs as a Provider on every message:

1. User asks a DeFi question
2. The plugin sends context to Operon's placement API
3. If a relevant, trustworthy service matches (quality-weighted auction), the recommendation is injected into the agent's context
4. The agent incorporates it naturally, marked as sponsored
5. If nothing matches, the response is clean - no mention of sponsorship

## Quick start

### 1. Install dependencies

```bash
bun install
```

### 2. Configure environment

```bash
cp .env.sample .env
```

Required:
- `JWT_SECRET` - Auth token signing
- `OPENAI_API_KEY` or `OPENROUTER_API_KEY` - LLM provider
- `OPERON_URL` - Operon network endpoint (e.g. `https://api.operon.so`)
- `OPERON_API_KEY` - Your publisher API key from Operon

Optional:
- `NANSEN_API_KEY` - Nansen MCP server for smart money data
- `TAVILY_API_KEY` - Web search
- `COINGECKO_API_KEY` - Token pricing
- `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET` - Wallet balance checking (read-only)

### 3. Start

```bash
bun run dev
```

UI at http://localhost:3000

## Plugins

| Plugin | Purpose | Status |
|--------|---------|--------|
| `@operon/plugin-publisher-sdk` | Operon sponsored placement integration | Active |
| `plugin-coingecko` | Token prices, trending, metadata | Active |
| `plugin-defillama` | TVL, yield analytics | Active |
| `plugin-web-search` | Web search, crypto news | Active |
| `plugin-polymarket-discovery` | Prediction market data | Active |
| `plugin-etherscan` | Transaction verification | Active |
| `plugin-cdp` | Wallet balance checking (read-only) | Active |
| `plugin-mcp` | Nansen AI integration | Active |
| `plugin-bootstrap` | Core ElizaOS lifecycle | Active |

Execution plugins (swaps, bridges, transfers, token deployment, lending) have been removed. This agent is research-only.

## Example interactions

**User:** "What's the best way to swap 5 ETH to USDC?"

**Agent:** "Current ETH/USDC at ~$2,650. DEX aggregators like 1inch or Jupiter will route across multiple pools for best execution. On L2s you'll save on gas vs mainnet. [Sponsored] Jupiter Aggregator - best-rate DEX aggregation (Trust score: 82/100)."

**User:** "Compare yield on Arbitrum stablecoins"

**Agent:** "Top options by risk-adjusted yield: Aave V3 USDC at 4.2% (TVL $890M), GMX GLP at 8-15%, Pendle USDC at 6.8%. Aave is the conservative anchor."

## For publishers

Want to build your own Operon-powered agent? See the [@operon/plugin-publisher-sdk](https://github.com/operonhq/plugin-publisher-sdk) README for integration instructions. This repo serves as a working reference.

## Links

- [Operon](https://operon.so) - Protocol-level monetization for AI agents
- [@operon/plugin-publisher-sdk](https://www.npmjs.com/package/@operon/plugin-publisher-sdk) - npm package
- [ElizaOS](https://github.com/elizaos/eliza) - Agent framework
- [Original Otaku](https://github.com/elizaOS/otaku) - Upstream fork

## License

MIT
