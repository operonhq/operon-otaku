/**
 * POLYMARKET_APPROVE_USDC Action
 *
 * Approve USDC spending on Polymarket exchange contracts.
 * This is typically done automatically during setup, but can be run manually.
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

export const approveUsdcAction: Action = {
  name: "POLYMARKET_APPROVE_USDC",
  similes: [
    "APPROVE_POLYMARKET_USDC",
    "POLYMARKET_USDC_APPROVAL",
    "ENABLE_POLYMARKET_SPENDING",
  ],
  description:
    "Approve USDC spending on Polymarket exchange contracts. Required before trading. Usually done automatically during setup.",

  parameters: {},

  validate: async (runtime: IAgentRuntime, _message: Memory) => {
    try {
      const service = runtime.getService(
        PolymarketTradingService.serviceType
      ) as PolymarketTradingService;

      if (!service) {
        logger.warn("[POLYMARKET_APPROVE_USDC] Trading service not available");
        return false;
      }

      return true;
    } catch (error) {
      logger.error(
        "[POLYMARKET_APPROVE_USDC] Validation error:",
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
      logger.info("[POLYMARKET_APPROVE_USDC] Approving USDC...");

      // Get entity wallet (handles shared wallet scenario)
      const wallet = await getEntityWallet(
        runtime,
        message,
        "POLYMARKET_APPROVE_USDC",
        callback,
      );

      if (wallet.success === false) {
        logger.error("[POLYMARKET_APPROVE_USDC] Failed to get entity wallet");
        return wallet.result;
      }

      // Use the wallet's account name (walletEntityId) as the userId for the trading service
      const userId = wallet.metadata?.walletEntityId || wallet.metadata?.accountName || message.entityId;
      if (!userId) {
        return {
          text: "Unable to identify entity for approval.",
          success: false,
          error: "no_entity_id",
        };
      }

      logger.info(`[POLYMARKET_APPROVE_USDC] Using wallet account: ${userId}, address: ${wallet.walletAddress}`);

      const service = runtime.getService(
        PolymarketTradingService.serviceType
      ) as PolymarketTradingService;

      if (!service) {
        return {
          text: "Polymarket trading service is not available.",
          success: false,
          error: "service_unavailable",
        };
      }

      // Get current allowance status
      const beforeStatus = await service.getAllowanceStatus(userId);

      if (
        parseFloat(beforeStatus.ctfExchange) > 1_000_000 &&
        parseFloat(beforeStatus.negRiskExchange) > 1_000_000
      ) {
        return {
          text: "USDC is already approved for trading on Polymarket. You're ready to trade!",
          success: true,
          data: {
            alreadyApproved: true,
            ctfExchange: beforeStatus.ctfExchange,
            negRiskExchange: beforeStatus.negRiskExchange,
          },
        };
      }

      // Approve USDC
      const result = await service.approveUsdc(userId);

      // Get new allowance status
      const afterStatus = await service.getAllowanceStatus(userId);
      const walletAddress = await service.getWalletAddress(userId);

      let text = "\n**USDC Approval Complete**\n";
      text += "═══════════════════════════════════════════════════════\n\n";

      if (result.ctfExchange) {
        text += `✅ CTF Exchange approved\n`;
        text += `   TX: https://polygonscan.com/tx/${result.ctfExchange}\n\n`;
      } else {
        text += `ℹ️ CTF Exchange was already approved\n\n`;
      }

      if (result.negRiskExchange) {
        text += `✅ Neg Risk Exchange approved\n`;
        text += `   TX: https://polygonscan.com/tx/${result.negRiskExchange}\n\n`;
      } else {
        text += `ℹ️ Neg Risk Exchange was already approved\n\n`;
      }

      text += "You can now trade on Polymarket!\n";

      const actionResult: ActionResult = {
        text,
        success: true,
        data: {
          ctfExchangeTx: result.ctfExchange,
          negRiskExchangeTx: result.negRiskExchange,
          walletAddress,
          newAllowances: afterStatus,
        },
      };

      callback?.({
        text: actionResult.text,
        content: actionResult.data,
      });

      logger.info("[POLYMARKET_APPROVE_USDC] Approval complete");
      return actionResult;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[POLYMARKET_APPROVE_USDC] Error: ${errorMsg}`);

      const errorResult: ActionResult = {
        text: `Failed to approve USDC: ${errorMsg}\n\nMake sure you have MATIC for gas fees.`,
        success: false,
        error: errorMsg,
      };

      callback?.({
        text: errorResult.text,
        content: { error: "approval_failed", details: errorMsg },
      });

      return errorResult;
    }
  },

  examples: [
    [
      {
        name: "{{user}}",
        content: { text: "approve usdc for polymarket" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Approving USDC spending on Polymarket...",
          action: "POLYMARKET_APPROVE_USDC",
        },
      },
    ],
  ],
};

export default approveUsdcAction;

