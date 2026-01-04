/**
 * GET_POLYMARKET_DETAIL Action
 *
 * Get detailed information about a specific prediction market.
 * Returns YES and NO token_ids needed for orderbook queries.
 * 
 * Accepts flexible identifiers:
 * - market_slug: URL-friendly market identifier (e.g., "epl-bou-ars-2026-01-03-ars")
 * - market_id: Numeric market ID (e.g., "986005")
 * - condition_id: Hex condition ID as fallback (e.g., "0x907b032a...")
 */

import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
  type ActionResult,
  logger,
} from "@elizaos/core";
import { PolymarketService } from "../services/polymarket.service";
import { shouldPolymarketPluginBeInContext } from "../../matcher";

interface GetMarketDetailParams {
  // Primary identifiers (preferred - use from GET_POLYMARKET_EVENT_DETAIL results)
  market_slug?: string;
  marketSlug?: string;
  slug?: string;
  // Numeric ID
  market_id?: string;
  marketId?: string;
  id?: string;
  // Fallback identifier
  condition_id?: string;
  conditionId?: string;
}

type GetMarketDetailInput = {
  identifier: string;
  identifierType: "slug" | "id" | "condition_id";
};

type GetMarketDetailActionResult = ActionResult & { input: GetMarketDetailInput };

export const getMarketDetailAction: Action = {
  name: "GET_POLYMARKET_DETAIL",
  similes: [
    "POLYMARKET_DETAILS",
    "MARKET_INFO",
    "MARKET_DETAILS",
    "SHOW_MARKET",
    "POLYMARKET_INFO",
    "MARKET_INFORMATION",
  ],
  description:
    "Get detailed information about a specific Polymarket prediction market. Accepts market_slug (like 'epl-bou-ars-2026-01-03-ars'), market_id (numeric), or condition_id (hex). Use the market slug from GET_POLYMARKET_EVENT_DETAIL results - it's the most reliable identifier. Returns token_ids needed for trading.",

  parameters: {
    market_slug: {
      type: "string",
      description: "Market slug from event details (e.g., 'epl-bou-ars-2026-01-03-ars'). This is the PREFERRED identifier - get it from GET_POLYMARKET_EVENT_DETAIL results.",
      required: false,
    },
    market_id: {
      type: "string", 
      description: "Numeric market ID (e.g., '986005'). Alternative to slug.",
      required: false,
    },
    condition_id: {
      type: "string",
      description: "Hex condition ID starting with 0x. Use only if slug/id not available.",
      required: false,
    },
  },

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    try {
      // Check plugin context first
      if (!shouldPolymarketPluginBeInContext(state, message)) {
        return false;
      }

      const service = runtime.getService(
        PolymarketService.serviceType
      ) as PolymarketService;

      if (!service) {
        logger.warn("[GET_POLYMARKET_DETAIL] Polymarket service not available");
        return false;
      }

      return true;
    } catch (error) {
      logger.error(
        "[GET_POLYMARKET_DETAIL] Error validating action:",
        error instanceof Error ? error.message : String(error)
      );
      return false;
    }
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      logger.info("[GET_POLYMARKET_DETAIL] Getting market details");

      // Read parameters from state
      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
      const params = (composedState?.data?.actionParams ?? {}) as Partial<GetMarketDetailParams>;

      // Extract identifier with priority: slug > id > condition_id
      const slug = (params.market_slug || params.marketSlug || params.slug)?.trim();
      const id = (params.market_id || params.marketId || params.id)?.trim();
      const conditionId = (params.condition_id || params.conditionId)?.trim();
      
      // Determine which identifier to use (priority: slug > id > condition_id)
      let identifier: string;
      let identifierType: "slug" | "id" | "condition_id";
      
      if (slug) {
        identifier = slug;
        identifierType = "slug";
      } else if (id) {
        identifier = id;
        identifierType = "id";
      } else if (conditionId) {
        identifier = conditionId;
        identifierType = "condition_id";
      } else {
        const errorMsg = "Market identifier is required. Provide market_slug, market_id, or condition_id";
        logger.error(`[GET_POLYMARKET_DETAIL] ${errorMsg}`);
        const errorResult: ActionResult = {
          text: ` ${errorMsg}. Use GET_POLYMARKET_EVENT_DETAIL first to get market slugs.`,
          success: false,
          error: "missing_identifier",
        };
        callback?.({
          text: errorResult.text,
          content: { error: "missing_identifier", details: errorMsg },
        });
        return errorResult;
      }

      const inputParams: GetMarketDetailInput = { identifier, identifierType };
      logger.info(`[GET_POLYMARKET_DETAIL] Using ${identifierType}: ${identifier}`);

      // Get service
      const service = runtime.getService(
        PolymarketService.serviceType
      ) as PolymarketService;

      if (!service) {
        const errorMsg = "Polymarket service not available";
        logger.error(`[GET_POLYMARKET_DETAIL] ${errorMsg}`);
        const errorResult: GetMarketDetailActionResult = {
          text: ` ${errorMsg}`,
          success: false,
          error: "service_unavailable",
          input: inputParams,
        };
        callback?.({
          text: errorResult.text,
          content: { error: "service_unavailable", details: errorMsg },
        });
        return errorResult;
      }

      // Fetch market details
      logger.info(`[GET_POLYMARKET_DETAIL] Fetching details for ${identifier}`);
      const market = await service.getMarketDetail(identifier);
      
      // Fetch prices using condition_id (required for CLOB API)
      // Market type uses conditionId (camelCase) or condition_id (snake_case)
      const marketConditionId = (market as any).conditionId || (market as any).condition_id || market.condition_id;
      if (!marketConditionId) {
        throw new Error("Market condition_id not found in response");
      }
      const prices = await service.getMarketPrices(marketConditionId);

      // Format response
      let text = ` **${market.question}**\n\n`;

      if (market.description) {
        text += `**Description:** ${market.description}\n\n`;
      }

      // Use actual outcome names if available (for sports/alternative markets)
      const outcome1Label = prices.outcome1_name || "YES";
      const outcome2Label = prices.outcome2_name || "NO";

      text += `**Current Odds:**\n`;
      text += `   ${outcome1Label}: ${prices.yes_price_formatted}\n`;
      text += `   ${outcome2Label}: ${prices.no_price_formatted}\n`;
      text += `   Spread: ${(parseFloat(prices.spread) * 100).toFixed(2)}%\n\n`;

      if (market.category) {
        text += `**Category:** ${market.category}\n`;
      }

      if (market.volume) {
        const volumeNum = parseFloat(market.volume);
        if (!isNaN(volumeNum)) {
          text += `**Trading Volume:** $${volumeNum.toLocaleString()}\n`;
        }
      }

      if (market.liquidity) {
        const liquidityNum = parseFloat(market.liquidity);
        if (!isNaN(liquidityNum)) {
          text += `**Liquidity:** $${liquidityNum.toLocaleString()}\n`;
        }
      }

      if (market.endDateIso) {
        const endDate = new Date(market.endDateIso);
        text += `**Closes:** ${endDate.toLocaleString()}\n`;
      }

      text += `\n**Status:**\n`;
      text += `   Active: ${market.active ? "Yes" : "No"}\n`;
      text += `   Closed: ${market.closed ? "Yes" : "No"}\n`;
      text += `   Resolved: ${market.resolved ? "Yes" : "No"}\n`;

      if (market.tags && market.tags.length > 0) {
        text += `\n**Tags:** ${market.tags.join(", ")}\n`;
      }

      // Show market identifiers
      text += `\n**Market Slug:** \`${market.slug || identifier}\``;
      if (marketConditionId) {
        text += `\n**Condition ID:** \`${marketConditionId}\``;
      }

      // Extract and display token IDs for orderbook queries
      const tokens = market.tokens || [];
      
      // Check if this is a Yes/No market or alternative outcome market
      const yesToken = tokens.find((t: any) => t.outcome?.toLowerCase() === "yes");
      const noToken = tokens.find((t: any) => t.outcome?.toLowerCase() === "no");
      const isYesNoMarket = yesToken && noToken;

      if (tokens.length >= 2) {
        text += `\n\n**Tradeable Token IDs** (use with GET_POLYMARKET_ORDERBOOK):\n`;
        if (isYesNoMarket) {
          text += `   YES Token: \`${yesToken.token_id}\`\n`;
          text += `   NO Token: \`${noToken.token_id}\`\n`;
        } else {
          // For alternative outcome markets (e.g., sports with team names)
          tokens.forEach((token: any, index: number) => {
            text += `   ${token.outcome} Token: \`${token.token_id}\`\n`;
          });
        }
      }

      const result: GetMarketDetailActionResult = {
        text,
        success: true,
        data: {
          market: {
            slug: market.slug || market.market_slug,
            condition_id: marketConditionId,
            question: market.question,
            description: market.description,
            category: market.category,
            volume: market.volume,
            liquidity: market.liquidity,
            end_date: market.endDateIso || market.end_date_iso,
            active: market.active,
            closed: market.closed,
            resolved: market.resolved,
            tags: market.tags,
          },
          // Include token IDs for multi-step action chaining
          tokens: {
            // For Yes/No markets, provide backwards-compatible fields
            yes_token_id: yesToken?.token_id || null,
            no_token_id: noToken?.token_id || null,
            // For any market type, provide outcome-based token access
            outcome1_token_id: prices.outcome1_token_id || yesToken?.token_id || null,
            outcome2_token_id: prices.outcome2_token_id || noToken?.token_id || null,
            outcome1_name: prices.outcome1_name || "Yes",
            outcome2_name: prices.outcome2_name || "No",
            // Full token list for complete access
            all_tokens: tokens.map((t: any) => ({
              token_id: t.token_id,
              outcome: t.outcome,
              price: t.price,
            })),
          },
          prices: {
            yes_price: prices.yes_price,
            no_price: prices.no_price,
            yes_price_formatted: prices.yes_price_formatted,
            no_price_formatted: prices.no_price_formatted,
            spread: prices.spread,
            outcome1_name: prices.outcome1_name,
            outcome2_name: prices.outcome2_name,
          },
        },
        input: inputParams,
      };

      logger.info(`[GET_POLYMARKET_DETAIL] Successfully fetched details for ${market.question}`);
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[GET_POLYMARKET_DETAIL] Error: ${errorMsg}`);
      const errorResult: ActionResult = {
        text: ` Failed to get market details: ${errorMsg}`,
        success: false,
        error: errorMsg,
      };
      callback?.({
        text: errorResult.text,
        content: { error: "fetch_failed", details: errorMsg },
      });
      return errorResult;
    }
  },

  examples: [
    [
      {
        name: "{{user}}",
        content: {
          text: "show me details for the Arsenal win market epl-bou-ars-2026-01-03-ars",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Getting market details...",
          action: "GET_POLYMARKET_DETAIL",
          market_slug: "epl-bou-ars-2026-01-03-ars",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "get info on market 986005" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Fetching market information...",
          action: "GET_POLYMARKET_DETAIL",
          market_id: "986005",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "show me the details for that Arsenal market from the event" },
      },
      {
        name: "{{agent}}",
        content: {
          text: " Getting market details...",
          action: "GET_POLYMARKET_DETAIL",
          market_slug: "epl-bou-ars-2026-01-03-ars",
        },
      },
    ],
  ],
};

export default getMarketDetailAction;
