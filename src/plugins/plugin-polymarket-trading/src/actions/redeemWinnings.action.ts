/**
 * POLYMARKET_REDEEM Action
 *
 * Redeem winnings from resolved Polymarket positions.
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

interface RedeemParams {
  condition_id?: string;
  conditionId?: string;
}

export const redeemWinningsAction: Action = {
  name: "POLYMARKET_REDEEM",
  similes: [
    "REDEEM_POLYMARKET",
    "CLAIM_POLYMARKET_WINNINGS",
    "POLYMARKET_CLAIM",
    "COLLECT_POLYMARKET_WINNINGS",
  ],
  description:
    "Redeem winnings from resolved Polymarket positions. Converts winning shares to USDC.",

  parameters: {
    condition_id: {
      type: "string",
      description:
        "Optional condition ID to redeem. If not provided, attempts to redeem all redeemable positions.",
      required: false,
    },
  },

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
      logger.info("[POLYMARKET_REDEEM] Processing redemption...");

      // Get entity wallet (handles shared wallet scenario)
      const wallet = await getEntityWallet(
        runtime,
        message,
        "POLYMARKET_REDEEM",
        callback,
      );

      if (wallet.success === false) {
        logger.error("[POLYMARKET_REDEEM] Failed to get entity wallet");
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

      logger.info(`[POLYMARKET_REDEEM] Using wallet account: ${userId}, address: ${wallet.walletAddress}`);

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
          text: "Trading not set up. Run POLYMARKET_SETUP_TRADING first.",
          success: false,
          error: "setup_required",
        };
      }

      // TODO: Implement redemption logic
      // This requires:
      // 1. Fetching user positions from the discovery plugin
      // 2. Filtering for redeemable positions (resolved markets where user has winning shares)
      // 3. Calling the CLOB client or contract to redeem

      // For now, return a placeholder response
      let text = `\n**Polymarket Redemption**\n`;
      text += `═══════════════════════════════════════════════════════\n\n`;
      text += `⚠️ Redemption feature is under development.\n\n`;
      text += `To redeem winnings manually:\n`;
      text += `1. Go to https://polymarket.com/portfolio\n`;
      text += `2. Find resolved markets with winning positions\n`;
      text += `3. Click "Redeem" to collect your USDC\n\n`;
      text += `Alternatively, use GET_POLYMARKET_POSITIONS to view your positions.\n`;

      return {
        text,
        success: true,
        data: {
          message: "Redemption feature under development",
          manualRedemptionUrl: "https://polymarket.com/portfolio",
        },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[POLYMARKET_REDEEM] Error: ${errorMsg}`);
      return {
        text: `Failed to process redemption: ${errorMsg}`,
        success: false,
        error: errorMsg,
      };
    }
  },

  examples: [
    [
      {
        name: "{{user}}",
        content: { text: "redeem my polymarket winnings" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Let me check for redeemable positions...",
          action: "POLYMARKET_REDEEM",
        },
      },
    ],
  ],
};

export default redeemWinningsAction;
