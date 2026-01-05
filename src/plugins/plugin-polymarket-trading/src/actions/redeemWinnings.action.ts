/**
 * POLYMARKET_REDEEM Action
 *
 * Redeem winnings from resolved Polymarket positions.
 * Calls the Gnosis Conditional Tokens contract to burn winning
 * outcome tokens and receive USDC collateral.
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

// Polymarket Data API
const DATA_API_URL = "https://data-api.polymarket.com";

interface Position {
  conditionId: string;
  redeemable: boolean;
  title: string;
  size: number;
  currentValue: number;
  outcome: string;
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
  return (await response.json()) as Position[];
}

export const redeemWinningsAction: Action = {
  name: "POLYMARKET_REDEEM",
  similes: [
    "REDEEM_POLYMARKET",
    "CLAIM_POLYMARKET_WINNINGS",
    "POLYMARKET_CLAIM",
    "COLLECT_POLYMARKET_WINNINGS",
    "CLAIM_WINNINGS",
  ],
  description: `Redeem winnings from resolved Polymarket positions. Converts winning shares to USDC.

**How it works:**
1. Fetches your positions from the Polymarket Data API
2. Identifies positions marked as "redeemable" (resolved markets where you hold winning shares)
3. Calls the Gnosis Conditional Tokens contract to redeem each position
4. USDC is transferred to your wallet

**Parameters:**
- condition_id (optional): Specific condition ID to redeem. If not provided, redeems ALL redeemable positions.

**Tip:** Use POLYMARKET_GET_MY_POSITIONS first to see which positions are redeemable (marked with ⚡).`,

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

      // Get entity wallet
      const wallet = await getEntityWallet(
        runtime,
        message,
        "POLYMARKET_REDEEM",
        callback
      );

      if (wallet.success === false) {
        logger.error("[POLYMARKET_REDEEM] Failed to get entity wallet");
        return wallet.result;
      }

      const userId =
        wallet.metadata?.walletEntityId ||
        wallet.metadata?.accountName ||
        message.entityId;
      const walletAddress = wallet.walletAddress;

      if (!userId || !walletAddress) {
        return {
          text: "Unable to identify entity or wallet.",
          success: false,
          error: "no_entity_id",
        };
      }

      logger.info(
        `[POLYMARKET_REDEEM] Using wallet: ${walletAddress}, userId: ${userId.substring(0, 20)}...`
      );

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

      // Check setup
      const isSetup = await service.isSetupComplete(userId);
      if (!isSetup) {
        return {
          text: "Trading not set up. Run POLYMARKET_SETUP_TRADING first.",
          success: false,
          error: "setup_required",
        };
      }

      // Parse parameters
      const composedState = await runtime.composeState(
        message,
        ["ACTION_STATE"],
        true
      );
      const params = (composedState?.data?.actionParams ?? {}) as RedeemParams;
      const specificConditionId = params.condition_id || params.conditionId;

      // First, fetch positions to show user what's redeemable
      const positions = await fetchPositions(walletAddress);
      const redeemablePositions = positions.filter((p) => p.redeemable);

      if (redeemablePositions.length === 0) {
        return {
          text: `**Polymarket Redemption**
═══════════════════════════════════════════════════════

No redeemable positions found.

Positions become redeemable after a market resolves and you hold winning shares.

Use POLYMARKET_GET_MY_POSITIONS to view your current positions.`,
          success: true,
          data: { redeemableCount: 0, redeemed: [] },
        };
      }

      // If specific condition ID provided, validate it
      if (specificConditionId) {
        const targetPosition = redeemablePositions.find(
          (p) => p.conditionId === specificConditionId
        );

        if (!targetPosition) {
          return {
            text: `**Condition ID Not Found or Not Redeemable**

The condition ID \`${specificConditionId.substring(0, 20)}...\` is either:
- Not in your positions
- Not yet resolved
- Already redeemed

**Redeemable positions:**
${redeemablePositions.map((p) => `• ${p.outcome.toUpperCase()} - ${p.title.substring(0, 50)}...`).join("\n")}`,
            success: false,
            error: "condition_not_found",
          };
        }

        // Redeem specific position
        logger.info(
          `[POLYMARKET_REDEEM] Redeeming specific condition: ${specificConditionId.substring(0, 20)}...`
        );

        const result = await service.redeemPosition(userId, specificConditionId);

        if (result.success) {
          return {
            text: `✅ **Redemption Successful**
═══════════════════════════════════════════════════════

**Market:** ${targetPosition.title}
**Position:** ${targetPosition.outcome.toUpperCase()}
**Shares Redeemed:** ${targetPosition.size.toFixed(2)}

**Transaction:** [\`${result.transactionHash.substring(0, 18)}...\`](https://polygonscan.com/tx/${result.transactionHash})

USDC has been credited to your wallet.`,
            success: true,
            data: {
              conditionId: specificConditionId,
              transactionHash: result.transactionHash,
              market: targetPosition.title,
              outcome: targetPosition.outcome,
              shares: targetPosition.size,
            },
          };
        } else {
          return {
            text: `❌ **Redemption Failed**

**Market:** ${targetPosition.title}
**Error:** ${result.error}

This may be due to:
- Market not yet fully resolved
- Insufficient gas (POL)
- Network issues

Please try again later.`,
            success: false,
            error: result.error,
          };
        }
      }

      // Redeem all redeemable positions
      logger.info(
        `[POLYMARKET_REDEEM] Redeeming all ${redeemablePositions.length} redeemable positions...`
      );

      const results = await service.redeemAllPositions(userId);

      const successful = results.filter((r) => r.success);
      const failed = results.filter((r) => !r.success);

      // Build response
      let text = `**Polymarket Redemption Results**
═══════════════════════════════════════════════════════

`;

      if (successful.length > 0) {
        text += `✅ **Successfully Redeemed: ${successful.length}**\n\n`;

        for (const result of successful) {
          const position = redeemablePositions.find(
            (p) => p.conditionId === result.conditionId
          );
          const title = position?.title || "Unknown Market";

          text += `• ${title.substring(0, 50)}...\n`;
          text += `  TX: [\`${result.transactionHash.substring(0, 18)}...\`](https://polygonscan.com/tx/${result.transactionHash})\n\n`;
        }
      }

      if (failed.length > 0) {
        text += `\n❌ **Failed: ${failed.length}**\n\n`;

        for (const result of failed) {
          const position = redeemablePositions.find(
            (p) => p.conditionId === result.conditionId
          );
          const title = position?.title || "Unknown Market";

          text += `• ${title.substring(0, 50)}...\n`;
          text += `  Error: ${result.error}\n\n`;
        }
      }

      if (successful.length === 0 && failed.length === 0) {
        text +=
          "No positions were processed. This may indicate the positions were already redeemed.";
      }

      return {
        text,
        success: successful.length > 0,
        data: {
          redeemableCount: redeemablePositions.length,
          successCount: successful.length,
          failedCount: failed.length,
          results: results.map((r) => ({
            conditionId: r.conditionId,
            success: r.success,
            transactionHash: r.transactionHash,
            error: r.error,
          })),
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
          text: "Let me check for redeemable positions and redeem them...",
          action: "POLYMARKET_REDEEM",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "claim my prediction market winnings" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "I'll redeem your winning positions on Polymarket...",
          action: "POLYMARKET_REDEEM",
        },
      },
    ],
  ],
};

export default redeemWinningsAction;
