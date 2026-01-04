/**
 * POLYMARKET_GET_OPEN_ORDERS Action
 *
 * View all open orders on Polymarket for the user.
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

export const getOpenOrdersAction: Action = {
  name: "POLYMARKET_GET_OPEN_ORDERS",
  similes: [
    "VIEW_POLYMARKET_ORDERS",
    "POLYMARKET_ORDERS",
    "MY_POLYMARKET_ORDERS",
    "LIST_POLYMARKET_ORDERS",
  ],
  description: "View all open orders on Polymarket for your wallet.",

  parameters: {},

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    try {
      // Check plugin context first
      if (!shouldPolymarketTradingPluginBeInContext(state, message)) {
        return false;
      }

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
      logger.info("[POLYMARKET_GET_OPEN_ORDERS] Fetching orders...");

      // Get entity wallet (handles shared wallet scenario)
      const wallet = await getEntityWallet(
        runtime,
        message,
        "POLYMARKET_GET_OPEN_ORDERS",
        callback,
      );

      if (wallet.success === false) {
        logger.error("[POLYMARKET_GET_OPEN_ORDERS] Failed to get entity wallet");
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

      logger.info(`[POLYMARKET_GET_OPEN_ORDERS] Using wallet account: ${userId}, address: ${wallet.walletAddress}`);

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

      // Check if setup is complete
      const isSetup = await service.isSetupComplete(userId);
      if (!isSetup) {
        return {
          text: "Trading not set up. Run POLYMARKET_SETUP_TRADING first.",
          success: false,
          error: "setup_required",
        };
      }

      const orders = await service.getOpenOrders(userId);
      const walletAddress = await service.getWalletAddress(userId);

      if (orders.length === 0) {
        return {
          text: `\n**Open Orders**\n\nNo open orders found.\n\nWallet: \`${walletAddress}\``,
          success: true,
          data: { orders: [], walletAddress },
        };
      }

      let text = `\n**Open Orders**\n`;
      text += `═══════════════════════════════════════════════════════\n\n`;
      text += `Found ${orders.length} open order(s):\n\n`;

      for (let i = 0; i < orders.length; i++) {
        const order = orders[i];
        const filled =
          parseFloat(order.originalSize) - parseFloat(order.remainingSize);
        const filledPct = (
          (filled / parseFloat(order.originalSize)) *
          100
        ).toFixed(1);

        text += `**${i + 1}. ${order.side} ${order.outcome}**\n`;
        text += `   Price: $${order.price}\n`;
        text += `   Size: ${order.remainingSize}/${order.originalSize} (${filledPct}% filled)\n`;
        text += `   Order ID: \`${order.orderId}\`\n`;
        text += "\n";
      }

      text += `Use POLYMARKET_CANCEL_ORDER to cancel orders.\n`;
      text += `\nWallet: \`${walletAddress}\``;

      return {
        text,
        success: true,
        data: {
          orders,
          count: orders.length,
          walletAddress,
        },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[POLYMARKET_GET_OPEN_ORDERS] Error: ${errorMsg}`);
      return {
        text: `Failed to fetch open orders: ${errorMsg}`,
        success: false,
        error: errorMsg,
      };
    }
  },

  examples: [
    [
      {
        name: "{{user}}",
        content: { text: "show my polymarket orders" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Fetching your open orders...",
          action: "POLYMARKET_GET_OPEN_ORDERS",
        },
      },
    ],
  ],
};

export default getOpenOrdersAction;
