import {
  logger,
  type IAgentRuntime,
  type Project,
  type ProjectAgent,
} from "@elizaos/core";
import { character } from "./character";
import sqlPlugin from "@elizaos/plugin-sql";
import bootstrapPlugin from "./plugins/plugin-bootstrap/src/index.ts";
import openaiPlugin from "@elizaos/plugin-openai";
import cdpPlugin from "./plugins/plugin-cdp/index.ts";
import coingeckoPlugin from "./plugins/plugin-coingecko/src/index.ts";
import webSearchPlugin from "./plugins/plugin-web-search/src/index.ts";
import defiLlamaPlugin from "./plugins/plugin-defillama/src/index.ts";
import etherscanPlugin from "./plugins/plugin-etherscan/src/index.ts";
import analyticsPlugin from "@elizaos/plugin-analytics";
// import openrouterPlugin from "@elizaos/plugin-openrouter";
// import mcpPlugin from "@elizaos/plugin-mcp"; // Disabled: Nansen MCP times out on Railway, wastes ~30 GPT-4o calls per message
import gamificationPlugin from "./plugins/plugin-gamification/src/index.ts";
import polymarketDiscoveryPlugin from "./plugins/plugin-polymarket-discovery/src/index.ts";
import telegramPlugin from "@elizaos/plugin-telegram";
import _operonPublisherPlugin from "@operon/plugin-publisher-sdk";

// Patch: add name to the Operon provider so ElizaOS includes it in composeState
const operonPublisherPlugin = {
  ..._operonPublisherPlugin,
  providers: _operonPublisherPlugin.providers?.map(p => ({
    ...p,
    name: p.name || "OPERON_PLACEMENT",
    description: p.description || "Sponsored placement from Operon ad network",
  })),
};

const initCharacter = ({ runtime }: { runtime: IAgentRuntime }) => {
  logger.info("Initializing character");
  logger.info({ name: character.name }, "Character loaded:");

  // Log MCP configuration status
  const nansenKey = process.env.NANSEN_API_KEY;
  if (nansenKey) {
    logger.info(`NANSEN_API_KEY found (length: ${nansenKey.length})`);
  } else {
    logger.warn(
      "NANSEN_API_KEY not found - Nansen MCP server will fail to connect",
    );
  }
};

export const projectAgent: ProjectAgent = {
  character,
  init: async (runtime: IAgentRuntime) => await initCharacter({ runtime }),
  plugins: [
    sqlPlugin,
    bootstrapPlugin,
    openaiPlugin,
    cdpPlugin,
    coingeckoPlugin,
    webSearchPlugin,
    defiLlamaPlugin,
    etherscanPlugin,
    // mcpPlugin,
    analyticsPlugin,
    gamificationPlugin,
    polymarketDiscoveryPlugin,
    operonPublisherPlugin,
    telegramPlugin,
  ],
};

const project: Project = {
  agents: [projectAgent],
};

export { character } from "./character";

export default project;
