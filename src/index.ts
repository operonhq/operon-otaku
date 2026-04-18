import {
  logger,
  type Character,
  type Plugin,
  type Project,
  type ProjectAgent,
} from "@elizaos/core";
import sqlPlugin from "@elizaos/plugin-sql";
import bootstrapPlugin from "./plugins/plugin-bootstrap/src/index.ts";
import anthropicPlugin from "@elizaos/plugin-anthropic";
import coingeckoPlugin from "./plugins/plugin-coingecko/src/index.ts";
import webSearchPlugin from "./plugins/plugin-web-search/src/index.ts";
import defiLlamaPlugin from "./plugins/plugin-defillama/src/index.ts";
import analyticsPlugin from "@elizaos/plugin-analytics";
import polymarketDiscoveryPlugin from "./plugins/plugin-polymarket-discovery/src/index.ts";
import operonPublisherPlugin from "@operon/plugin-publisher-sdk";

// Messaging plugins - only loaded when credentials are configured
const telegramEnabled = !!process.env.TELEGRAM_BOT_TOKEN?.trim();
let telegramPlugin: Plugin | undefined;
if (telegramEnabled) {
  try {
    telegramPlugin = (await import("@elizaos/plugin-telegram")).default as Plugin;
  } catch (err) {
    logger.error({ error: err }, "Failed to load Telegram plugin - continuing without Telegram");
  }
}

const discordEnabled = !!process.env.DISCORD_API_TOKEN?.trim();
let discordPlugin: Plugin | undefined;
if (discordEnabled) {
  try {
    discordPlugin = (await import("@elizaos/plugin-discord")).default as Plugin;
  } catch (err) {
    logger.error({ error: err }, "Failed to load Discord plugin - continuing without Discord");
  }
}

// Character files
import { defiAnalyst } from "./characters/defi-analyst.ts";
import { yieldScout } from "./characters/yield-scout.ts";
import { riskRadar } from "./characters/risk-radar.ts";
import { gasOptimizer } from "./characters/gas-optimizer.ts";
import { portfolioCheck } from "./characters/portfolio-check.ts";
import { rev } from "./characters/rev.ts";
import { operonResearch } from "./characters/operon-research.ts";

const CHARACTERS: Record<string, Character> = {
  defi_analyst: defiAnalyst,
  yield_scout: yieldScout,
  risk_radar: riskRadar,
  gas_optimizer: gasOptimizer,
  portfolio_check: portfolioCheck,
  rev: rev,
  operon_research: operonResearch,
};

const characterKey = (process.env.AGENT_CHARACTER || "defi_analyst").trim();
const character = CHARACTERS[characterKey];
if (!character) {
  throw new Error(
    `Unknown AGENT_CHARACTER: "${characterKey}". Valid options: ${Object.keys(CHARACTERS).join(", ")}`
  );
}

// Log character and integration status at module load time (start-server.ts doesn't call init)
logger.info({ name: character.name, key: characterKey }, "Character loaded:");
logger.info({ discord: discordEnabled, telegram: telegramEnabled }, "Integrations:");

export const projectAgent: ProjectAgent = {
  character,
  // SECURITY: These plugins define what the LLM can DO, not the character prompt.
  // Never add transaction/write plugins here. See docs and project_agent_scope memory.
  plugins: [
    sqlPlugin,
    bootstrapPlugin,
    anthropicPlugin,
    coingeckoPlugin,
    webSearchPlugin,
    defiLlamaPlugin,
    polymarketDiscoveryPlugin,
    analyticsPlugin,
    operonPublisherPlugin,
    ...(telegramEnabled && telegramPlugin ? [telegramPlugin] : []),
    ...(discordEnabled && discordPlugin ? [discordPlugin] : []),
  ],
};

const project: Project = {
  agents: [projectAgent],
};

export default project;
