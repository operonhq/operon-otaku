/**
 * POLYMARKET_SETUP_TRADING Action
 *
 * One-time setup for Polymarket trading:
 * - Get or create CDP wallet
 * - Derive L2 API credentials
 * - Approve USDC spending on exchange contracts
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

export const setupTradingAction: Action = {
  name: "POLYMARKET_SETUP_TRADING",
  similes: [
    "SETUP_POLYMARKET",
    "POLYMARKET_SETUP",
    "INIT_POLYMARKET_TRADING",
    "CONFIGURE_POLYMARKET",
    "ENABLE_POLYMARKET_TRADING",
  ],
  description: `Set up trading on Polymarket. MUST be called before any trading actions.

**What it does:**
- Creates/retrieves a CDP wallet on Polygon
- Derives L2 API credentials for CLOB trading
- Approves USDC spending on exchange contracts

**Prerequisite for:**
- POLYMARKET_BUY_SHARES
- POLYMARKET_SELL_SHARES
- Any trading operation

**If POLYMARKET_BUY_SHARES fails with "setup_required", call this action first!**`,

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

      if (!service) {
        logger.warn(
          "[POLYMARKET_SETUP_TRADING] Trading service not available"
        );
        return false;
      }

      return true;
    } catch (error) {
      logger.error(
        "[POLYMARKET_SETUP_TRADING] Validation error:",
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
      logger.info("[POLYMARKET_SETUP_TRADING] Starting setup...");

      // Get entity wallet (handles shared wallet scenario)
      const wallet = await getEntityWallet(
        runtime,
        message,
        "POLYMARKET_SETUP_TRADING",
        callback,
      );

      if (wallet.success === false) {
        logger.error("[POLYMARKET_SETUP_TRADING] Failed to get entity wallet");
        return wallet.result;
      }

      // Use the wallet's accountName (cdp_user_id from user_registry) as the userId for the trading service
      // This ensures we use the same CDP account that was originally created for this entity
      const userId = wallet.metadata?.accountName || wallet.metadata?.walletEntityId || message.entityId;
      if (!userId) {
        return {
          text: "Unable to identify entity for trading setup.",
          success: false,
          error: "no_entity_id",
        };
      }

      logger.info(`[POLYMARKET_SETUP_TRADING] Using wallet account: ${userId}, address: ${wallet.walletAddress}`);

      // Get trading service
      const service = runtime.getService(
        PolymarketTradingService.serviceType
      ) as PolymarketTradingService;

      if (!service) {
        return {
          text: "Polymarket trading service is not available. Check CDP credentials.",
          success: false,
          error: "service_unavailable",
        };
      }

      // Run setup
      const result = await service.setupTrading(userId);

      // Format response
      let text = "\n**Polymarket Trading Setup**\n";
      text += "═══════════════════════════════════════════════════════\n\n";

      text += `**Wallet Address:**\n\`${result.walletAddress}\`\n\n`;

      text += "**Status:**\n";
      text += `  - API Credentials: ${result.hasApiCredentials ? "Ready" : "Not available"}\n`;
      text += "\n**USDC Approvals (for buying):**\n";
      text += `  - CTF Exchange: ${parseFloat(result.ctfExchangeAllowance) > 0 ? "Approved" : "Pending"}\n`;
      text += `  - Neg Risk Exchange: ${parseFloat(result.negRiskExchangeAllowance) > 0 ? "Approved" : "Pending"}\n`;
      text += `  - Neg Risk Adapter: ${parseFloat(result.negRiskAdapterAllowance) > 0 ? "Approved" : "Pending"}\n`;
      text += "\n**CTF Token Approvals (for selling):**\n";
      text += `  - CTF Exchange: ${result.ctfExchangeTokenApproval ? "Approved" : "Pending"}\n`;
      text += `  - Neg Risk Exchange: ${result.negRiskExchangeTokenApproval ? "Approved" : "Pending"}\n`;
      text += `  - Neg Risk Adapter: ${result.negRiskAdapterTokenApproval ? "Approved" : "Pending"}\n\n`;

      if (result.isReady) {
        text += "**Trading is ready.**\n\n";
        text +=
          "You can now use POLYMARKET_BUY_SHARES or POLYMARKET_SELL_SHARES to trade.\n";
        text += "Use SEARCH_POLYMARKETS to find markets to trade.\n";
      } else {
        text += "**Setup incomplete.**\n\n";

        if (result.warnings.length > 0) {
          text += "**Issues to address:**\n";
          for (const warning of result.warnings) {
            text += `  - ${warning}\n`;
          }
          text += "\n";
        }

        text += "**To complete setup:**\n";
        text += `1. Send POLYGON to \`${result.walletAddress}\` for gas fees\n`;
        text += `2. Send USDC.e to \`${result.walletAddress}\` for trading\n`;
        text += "3. Run POLYMARKET_SETUP_TRADING again\n";
      }

      text += "\n";
      text += `**PolygonScan:** https://polygonscan.com/address/${result.walletAddress}\n`;

      const actionResult: ActionResult = {
        text,
        success: true,
        data: {
          walletAddress: result.walletAddress,
          isReady: result.isReady,
          hasApiCredentials: result.hasApiCredentials,
          // USDC approvals (for buying)
          ctfExchangeApproved: parseFloat(result.ctfExchangeAllowance) > 0,
          negRiskExchangeApproved: parseFloat(result.negRiskExchangeAllowance) > 0,
          negRiskAdapterApproved: parseFloat(result.negRiskAdapterAllowance) > 0,
          // CTF token approvals (for selling)
          ctfExchangeTokenApproved: result.ctfExchangeTokenApproval,
          negRiskExchangeTokenApproved: result.negRiskExchangeTokenApproval,
          negRiskAdapterTokenApproved: result.negRiskAdapterTokenApproval,
          warnings: result.warnings,
        },
      };

      callback?.({
        text: actionResult.text,
        content: actionResult.data,
      });

      logger.info(
        `[POLYMARKET_SETUP_TRADING] Setup complete - Ready: ${result.isReady}`
      );
      return actionResult;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[POLYMARKET_SETUP_TRADING] Error: ${errorMsg}`);

      const errorResult: ActionResult = {
        text: `Failed to set up Polymarket trading: ${errorMsg}`,
        success: false,
        error: errorMsg,
      };

      callback?.({
        text: errorResult.text,
        content: { error: "setup_failed", details: errorMsg },
      });

      return errorResult;
    }
  },

  examples: [
    [
      {
        name: "{{user}}",
        content: { text: "set up polymarket trading" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Setting up Polymarket trading for you...",
          action: "POLYMARKET_SETUP_TRADING",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "I want to trade on polymarket" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Let me set up your Polymarket trading account...",
          action: "POLYMARKET_SETUP_TRADING",
        },
      },
    ],
  ],
};

export default setupTradingAction;
