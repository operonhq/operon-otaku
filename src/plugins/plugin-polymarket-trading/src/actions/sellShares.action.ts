/**
 * POLYMARKET_SELL_SHARES Action
 *
 * Sell shares from a Polymarket position.
 * Agent passes token_id from POLYMARKET_GET_MY_POSITIONS response.
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
import { PolymarketTradingService } from "../services/trading.service";
import { shouldPolymarketTradingPluginBeInContext } from "../../matcher";
import { getEntityWallet } from "../../../../utils/entity";
import { ERROR_MESSAGES, CLOB_HOST } from "../constants";

// Polymarket Data API
const DATA_API_URL = "https://data-api.polymarket.com";

interface Position {
  asset: string;
  size: number;
  curPrice: number;
  title: string;
  outcome: string;
}

interface SellSharesParams {
  token_id?: string;
  tokenId?: string;
  shares?: string | number;
}

/**
 * Fetch positions from Polymarket Data API
 */
async function fetchPositions(walletAddress: string): Promise<Position[]> {
  const url = `${DATA_API_URL}/positions?user=${walletAddress}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch positions: ${response.status}`);
  }
  return await response.json() as Position[];
}

/**
 * Fetch current sell price from CLOB
 */
async function fetchSellPrice(tokenId: string): Promise<number | null> {
  try {
    const response = await fetch(`${CLOB_HOST}/price?token_id=${tokenId}&side=sell`);
    if (!response.ok) return null;
    const data = await response.json() as { price?: string };
    const price = parseFloat(data.price || "");
    return isNaN(price) ? null : price;
  } catch {
    return null;
  }
}

export const sellSharesAction: Action = {
  name: "POLYMARKET_SELL_SHARES",
  similes: [
    "SELL_POLYMARKET",
    "SELL_PREDICTION",
    "POLYMARKET_SELL",
    "EXIT_POSITION",
  ],
  description:
    "Sell shares from a Polymarket position. Pass the token_id from POLYMARKET_GET_MY_POSITIONS. Shares is optional - defaults to selling all.",

  parameters: {
    token_id: {
      type: "string",
      description: "The tokenId from POLYMARKET_GET_MY_POSITIONS response. This identifies which position to sell.",
      required: true,
    },
    shares: {
      type: "number",
      description: "Number of shares to sell. If omitted, sells all shares in the position.",
      required: false,
    },
  },

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    // Check plugin context first
    if (!shouldPolymarketTradingPluginBeInContext(state, message)) {
      return false;
    }

    const service = runtime.getService(PolymarketTradingService.serviceType);
    return !!service;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      logger.info("[SELL_SHARES] Starting...");

      // Get wallet
      const wallet = await getEntityWallet(runtime, message, "POLYMARKET_SELL_SHARES", callback);
      if (wallet.success === false) return wallet.result;
      
      const walletAddress = wallet.walletAddress;
      const userId = wallet.metadata?.walletEntityId || wallet.metadata?.accountName || message.entityId;
      
      if (!walletAddress || !userId) {
        return { text: "Wallet not available.", success: false, error: "no_wallet" };
      }

      // Get service
      const service = runtime.getService(PolymarketTradingService.serviceType) as PolymarketTradingService;
      if (!service) {
        return { text: "Trading service not available.", success: false, error: "no_service" };
      }

      // Check setup
      if (!(await service.isSetupComplete(userId))) {
        return { text: ERROR_MESSAGES.SETUP_REQUIRED, success: false, error: "setup_required" };
      }

      // Parse params
      const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
      const params = (composedState?.data?.actionParams ?? {}) as SellSharesParams;
      
      const tokenId = params.token_id || params.tokenId;
      
      if (!tokenId) {
        return {
          text: "token_id is required. Get it from POLYMARKET_GET_MY_POSITIONS first.",
          success: false,
          error: "missing_token_id",
        };
      }

      logger.info(`[SELL_SHARES] Token ID: ${tokenId.substring(0, 30)}...`);

      // Fetch positions to get position details
      const positions = await fetchPositions(walletAddress);
      const position = positions.find(p => p.asset === tokenId);
      
      if (!position) {
        return {
          text: `Position with token_id not found. Run POLYMARKET_GET_MY_POSITIONS to see available positions.`,
          success: false,
          error: "position_not_found",
        };
      }

      // Determine shares
      let sharesToSell = position.size;
      if (params.shares) {
        const requested = typeof params.shares === "string" ? parseFloat(params.shares) : params.shares;
        if (requested > 0 && requested <= position.size) {
          sharesToSell = requested;
        }
      }

      // Get price
      const price = (await fetchSellPrice(tokenId)) ?? position.curPrice;
      
      logger.info(`[SELL_SHARES] Selling ${sharesToSell} shares @ ${price}`);

      // Execute
      const result = await service.placeOrder(userId, {
        tokenId,
        price,
        size: sharesToSell,
        side: "SELL",
      });

      const proceeds = (sharesToSell * price).toFixed(2);

      if (result.status === "FILLED") {
        return {
          text: `✅ **Sold!**\n\n${position.outcome.toUpperCase()} - ${position.title}\nShares: ${sharesToSell.toFixed(2)} @ ${(price * 100).toFixed(1)}%\nProceeds: ~$${proceeds}`,
          success: true,
          data: { orderId: result.orderId, shares: sharesToSell, price, proceeds, status: "FILLED" },
        };
      } else if (result.status === "PLACED") {
        return {
          text: `📝 **Order Placed**\n\n${position.outcome.toUpperCase()} - ${position.title}\nShares: ${sharesToSell.toFixed(2)} @ ${(price * 100).toFixed(1)}%`,
          success: true,
          data: { orderId: result.orderId, shares: sharesToSell, price, status: "PLACED" },
        };
      } else {
        return {
          text: `❌ Sell failed: ${result.error || "Unknown error"}`,
          success: false,
          error: result.error,
        };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`[SELL_SHARES] Error: ${msg}`);
      return { text: `Failed: ${msg}`, success: false, error: msg };
    }
  },

  examples: [
    [
      {
        name: "{{user}}",
        content: { text: "sell my fed rate position" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "I'll sell that position for you.",
          action: "POLYMARKET_SELL_SHARES",
        },
      },
    ],
  ],
};

export default sellSharesAction;
