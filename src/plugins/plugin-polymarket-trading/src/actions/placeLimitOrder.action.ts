/**
 * POLYMARKET_PLACE_LIMIT_ORDER Action
 *
 * Place a limit order on a Polymarket prediction market.
 * Similar to buy/sell but with explicit price control.
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
import { getEntityWallet } from "../../../../utils/entity";
import { validateOrderParams, parseOutcome, parseSide } from "../utils/orderHelpers";
import { ERROR_MESSAGES } from "../constants";

interface LimitOrderParams {
  token_id?: string;
  tokenId?: string;
  outcome?: string;
  side?: string;
  price: string | number;
  size: string | number;
  market_question?: string;
  marketQuestion?: string;
  condition_id?: string;
  conditionId?: string;
}

export const placeLimitOrderAction: Action = {
  name: "POLYMARKET_PLACE_LIMIT_ORDER",
  similes: [
    "POLYMARKET_LIMIT_ORDER",
    "LIMIT_ORDER_POLYMARKET",
    "SET_POLYMARKET_LIMIT",
  ],
  description:
    "Place a limit order to buy or sell shares at a specific price. The order will wait in the orderbook until the price is matched.",

  parameters: {
    token_id: {
      type: "string",
      description: "The ERC1155 token ID for the outcome",
      required: true,
    },
    side: {
      type: "string",
      description: "Order side: 'BUY' or 'SELL'",
      required: true,
    },
    price: {
      type: "number",
      description: "Limit price (0.01-0.99)",
      required: true,
    },
    size: {
      type: "number",
      description: "Number of shares",
      required: true,
    },
    outcome: {
      type: "string",
      description: "Outcome: 'YES' or 'NO' (for display)",
      required: false,
    },
    market_question: {
      type: "string",
      description: "Market question (for display)",
      required: false,
    },
  },

  validate: async (runtime: IAgentRuntime, _message: Memory) => {
    try {
      const service = runtime.getService(
        PolymarketTradingService.serviceType
      ) as PolymarketTradingService;
      return !!service;
    } catch {
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
      logger.info("[POLYMARKET_PLACE_LIMIT_ORDER] Processing order...");

      // Get entity wallet (handles shared wallet scenario)
      const wallet = await getEntityWallet(
        runtime,
        message,
        "POLYMARKET_PLACE_LIMIT_ORDER",
        callback,
      );

      if (wallet.success === false) {
        logger.error("[POLYMARKET_PLACE_LIMIT_ORDER] Failed to get entity wallet");
        return wallet.result;
      }

      // Use the wallet's account name (walletEntityId) as the userId for the trading service
      const userId = wallet.metadata?.walletEntityId || wallet.metadata?.accountName || message.entityId;
      if (!userId) {
        return {
          text: "Unable to identify entity.",
          success: false,
          error: "no_entity_id",
        };
      }

      logger.info(`[POLYMARKET_PLACE_LIMIT_ORDER] Using wallet account: ${userId}, address: ${wallet.walletAddress}`);

      const service = runtime.getService(
        PolymarketTradingService.serviceType
      ) as PolymarketTradingService;

      if (!service) {
        return {
          text: "Trading service not available.",
          success: false,
          error: "service_unavailable",
        };
      }

      const isSetup = await service.isSetupComplete(userId);
      if (!isSetup) {
        return {
          text: ERROR_MESSAGES.SETUP_REQUIRED,
          success: false,
          error: "setup_required",
        };
      }

      const composedState = await runtime.composeState(
        message,
        ["ACTION_STATE"],
        true
      );
      const params = (composedState?.data?.actionParams ??
        {}) as Partial<LimitOrderParams>;

      // Parse order parameters
      const tokenId = params.token_id || params.tokenId;
      const sideStr = params.side;
      const priceStr = params.price;
      const sizeStr = params.size;
      const outcomeStr = params.outcome || "YES";
      const marketQuestion =
        params.market_question || params.marketQuestion || "Unknown Market";

      if (!tokenId || !sideStr || !priceStr || !sizeStr) {
        return {
          text: "Missing required parameters: token_id, side, price, and size are required.",
          success: false,
          error: "missing_params",
        };
      }

      const side = parseSide(sideStr);
      const price =
        typeof priceStr === "string" ? parseFloat(priceStr) : priceStr;
      const size =
        typeof sizeStr === "string" ? parseInt(sizeStr, 10) : sizeStr;
      const outcome = parseOutcome(outcomeStr);

      const validation = validateOrderParams({
        tokenId,
        price,
        size,
        side,
      });

      if (!validation.isValid) {
        return {
          text: `Invalid order: ${validation.errors.join("; ")}`,
          success: false,
          error: "validation_failed",
        };
      }

      // Check balance for buys
      if (side === "BUY") {
        const balance = await service.getUsdcBalance(userId);
        const cost = price * size;
        if (parseFloat(balance.available) < cost) {
          return {
            text: `${ERROR_MESSAGES.INSUFFICIENT_BALANCE}\nRequired: $${cost.toFixed(2)}`,
            success: false,
            error: "insufficient_balance",
          };
        }
      }

      // Execute the limit order immediately
      logger.info(`[POLYMARKET_PLACE_LIMIT_ORDER] Placing ${side} order: ${size} shares @ $${price}`);

      const orderResult = await service.placeLimitOrder(userId, {
        tokenId,
        price,
        size,
        side,
      });

      if (orderResult.status === "PLACED" || orderResult.status === "FILLED") {
        const isFilled = orderResult.status === "FILLED";
        const totalCost = (price * size).toFixed(2);
        const maxGain = ((1 - price) * size).toFixed(2);

        let resultText = `✅ **Limit Order ${isFilled ? 'Filled' : 'Placed'}**
═══════════════════════════════════════════════════════

**Market:** ${marketQuestion}
**Position:** ${side} ${size} ${outcome} shares @ $${price.toFixed(4)}
**Cost:** $${totalCost} USDC
**Max Gain:** $${maxGain} (if outcome resolves in your favor)

**Order ID:** \`${orderResult.orderId}\`
`;

        if (orderResult.transactionHash) {
          resultText += `\n**Transaction:** [\`${orderResult.transactionHash.substring(0, 18)}...\`](https://polygonscan.com/tx/${orderResult.transactionHash})`;
        }

        resultText += `\nUse POLYMARKET_GET_OPEN_ORDERS to view pending orders.`;

        return {
          text: resultText,
          success: true,
          data: {
            orderId: orderResult.orderId,
            status: orderResult.status,
            transactionHash: orderResult.transactionHash,
            market: marketQuestion,
            outcome,
            side,
            price,
            size,
            cost: parseFloat(totalCost),
          },
        };
      } else {
        return {
          text: `❌ **Order Failed**\n\n**Reason:** ${orderResult.error || "Unknown error"}\n\nPlease try again.`,
          success: false,
          error: orderResult.error,
        };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[POLYMARKET_PLACE_LIMIT_ORDER] Error: ${errorMsg}`);
      return {
        text: `Failed to place limit order: ${errorMsg}`,
        success: false,
        error: errorMsg,
      };
    }
  },

  examples: [
    [
      {
        name: "{{user}}",
        content: { text: "place a limit order to buy 100 shares at 0.30" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "I'll place that limit order for you...",
          action: "POLYMARKET_PLACE_LIMIT_ORDER",
        },
      },
    ],
  ],
};

export default placeLimitOrderAction;
