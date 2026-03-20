import {
  logger,
  type IAgentRuntime,
  type Project,
  type ProjectAgent,
} from "@elizaos/core";
import { character } from "./character";
import sqlPlugin from "@elizaos/plugin-sql";
import bootstrapPlugin from "./plugins/plugin-bootstrap/src/index.ts";
import anthropicPlugin from "@elizaos/plugin-anthropic";
import coingeckoPlugin from "./plugins/plugin-coingecko/src/index.ts";
import webSearchPlugin from "./plugins/plugin-web-search/src/index.ts";
import defiLlamaPlugin from "./plugins/plugin-defillama/src/index.ts";
import analyticsPlugin from "@elizaos/plugin-analytics";
import polymarketDiscoveryPlugin from "./plugins/plugin-polymarket-discovery/src/index.ts";
import telegramPlugin from "@elizaos/plugin-telegram";
import operonPublisherPlugin from "@operon/plugin-publisher-sdk";

const initCharacter = ({ runtime }: { runtime: IAgentRuntime }) => {
  logger.info("Initializing character");
  logger.info({ name: character.name }, "Character loaded:");
};

export const projectAgent: ProjectAgent = {
  character,
  init: async (runtime: IAgentRuntime) => await initCharacter({ runtime }),
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
    telegramPlugin,
  ],
};

const project: Project = {
  agents: [projectAgent],
};

export { character } from "./character";

export default project;
