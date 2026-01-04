/**
 * POLYMARKET_CANCEL_ORDER Action
 *
 * Cancel an open order on Polymarket.
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

interface CancelOrderParams {
  order_id?: string;
  orderId?: string;
  cancel_all?: string | boolean;
  cancelAll?: string | boolean;
}

export const cancelOrderAction: Action = {
  name: "POLYMARKET_CANCEL_ORDER",
  similes: [
    "CANCEL_POLYMARKET_ORDER",
    "POLYMARKET_CANCEL",
    "REMOVE_POLYMARKET_ORDER",
  ],
  description:
    "Cancel an open order on Polymarket. Can cancel a specific order by ID or all open orders.",

  parameters: {
    order_id: {
      type: "string",
      description: "The order ID to cancel. Get from GET_POLYMARKET_OPEN_ORDERS.",
      required: false,
    },
    cancel_all: {
      type: "boolean",
      description: "If true, cancels all open orders.",
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
      logger.info("[POLYMARKET_CANCEL_ORDER] Processing cancellation...");

      // Get entity wallet (handles shared wallet scenario)
      const wallet = await getEntityWallet(
        runtime,
        message,
        "POLYMARKET_CANCEL_ORDER",
        callback,
      );

      if (wallet.success === false) {
        logger.error("[POLYMARKET_CANCEL_ORDER] Failed to get entity wallet");
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

      logger.info(`[POLYMARKET_CANCEL_ORDER] Using wallet account: ${userId}, address: ${wallet.walletAddress}`);

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

      const composedState = await runtime.composeState(
        message,
        ["ACTION_STATE"],
        true
      );
      const params = (composedState?.data?.actionParams ??
        {}) as Partial<CancelOrderParams>;

      const orderId = params.order_id || params.orderId;
      const cancelAll =
        params.cancel_all === true ||
        params.cancel_all === "true" ||
        params.cancelAll === true ||
        params.cancelAll === "true";

      if (cancelAll) {
        // Cancel all orders
        const results = await service.cancelAllOrders(userId);

        if (results.length === 0) {
          return {
            text: "No open orders to cancel.",
            success: true,
            data: { cancelledCount: 0 },
          };
        }

        const successful = results.filter((r) => r.success);
        const failed = results.filter((r) => !r.success);

        let text = `\n**Order Cancellation Results**\n`;
        text += `═══════════════════════════════════════════════════════\n\n`;
        text += `Cancelled: ${successful.length}/${results.length} orders\n\n`;

        if (successful.length > 0) {
          text += `**Successfully cancelled:**\n`;
          for (const result of successful) {
            text += `  • \`${result.orderId}\`\n`;
          }
          text += "\n";
        }

        if (failed.length > 0) {
          text += `**Failed to cancel:**\n`;
          for (const result of failed) {
            text += `  • \`${result.orderId}\`: ${result.error}\n`;
          }
        }

        return {
          text,
          success: true,
          data: {
            cancelledCount: successful.length,
            failedCount: failed.length,
            results,
          },
        };
      }

      if (!orderId) {
        // Show open orders
        const openOrders = await service.getOpenOrders(userId);

        if (openOrders.length === 0) {
          return {
            text: "No open orders to cancel.",
            success: true,
            data: { openOrders: [] },
          };
        }

        let text = `\n**Open Orders**\n`;
        text += `═══════════════════════════════════════════════════════\n\n`;
        text += `You have ${openOrders.length} open order(s):\n\n`;

        for (const order of openOrders) {
          text += `  • ID: \`${order.orderId}\`\n`;
          text += `    ${order.side} ${order.remainingSize} @ $${order.price}\n\n`;
        }

        text += `To cancel a specific order: specify order_id\n`;
        text += `To cancel all: set cancel_all=true\n`;

        return {
          text,
          success: true,
          data: { openOrders },
        };
      }

      // Cancel specific order
      const result = await service.cancelOrder(userId, orderId);

      if (result.success) {
        return {
          text: `\n**Order Cancelled**\n\nOrder \`${orderId}\` has been cancelled successfully.`,
          success: true,
          data: { orderId, cancelled: true },
        };
      } else {
        return {
          text: `Failed to cancel order: ${result.error}`,
          success: false,
          error: result.error,
        };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[POLYMARKET_CANCEL_ORDER] Error: ${errorMsg}`);
      return {
        text: `Failed to cancel order: ${errorMsg}`,
        success: false,
        error: errorMsg,
      };
    }
  },

  examples: [
    [
      {
        name: "{{user}}",
        content: { text: "cancel my polymarket orders" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "I'll cancel your open orders...",
          action: "POLYMARKET_CANCEL_ORDER",
        },
      },
    ],
  ],
};

export default cancelOrderAction;
