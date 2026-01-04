/**
 * POLYMARKET_GET_MY_POSITIONS Action
 *
 * Get the agent's current positions in Polymarket prediction markets.
 * Uses the agent's wallet address automatically - no need to specify it.
 * Queries the Polymarket data API directly with the CDP wallet address.
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
import { getEntityWallet } from "../../../../utils/entity";

// Polymarket Data API endpoint
const DATA_API_URL = "https://data-api.polymarket.com";

interface Position {
  proxyWallet: string;
  asset: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  initialValue: number;
  currentValue: number;
  cashPnl: number;
  percentPnl: number;
  totalBought: number;
  realizedPnl: number;
  percentRealizedPnl: number;
  curPrice: number;
  redeemable: boolean;
  mergeable: boolean;
  title: string;
  slug: string;
  icon: string;
  eventId: string;
  eventSlug: string;
  outcome: string;
  outcomeIndex: number;
  oppositeOutcome: string;
  oppositeAsset: string;
  endDate: string;
  negativeRisk: boolean;
}   

/**
 * Fetch positions directly from Polymarket Data API
 * Uses the wallet address directly (no proxy derivation for CDP wallets)
 */
async function fetchPositions(walletAddress: string): Promise<Position[]> {
  const url = `${DATA_API_URL}/positions?user=${walletAddress}`;
  
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`Polymarket API error: ${response.status} ${response.statusText}`);
  }
  
  const positions = await response.json() as Position[];
  return positions;
}

export const getMyPositionsAction: Action = {
  name: "POLYMARKET_GET_MY_POSITIONS",
  similes: [
    "GET_MY_POLYMARKET_POSITIONS",
    "MY_POLYMARKET_POSITIONS",
    "SHOW_MY_POSITIONS",
    "WHAT_DO_I_HOLD",
    "MY_POLYMARKET_PORTFOLIO",
    "CHECK_MY_POSITIONS",
    "MY_BETS",
    "AGENT_POSITIONS",
  ],
  description:
    "Get current Polymarket positions with values and PnL. Returns token_id for each position which can be passed to POLYMARKET_SELL_SHARES.",

  parameters: {},

  validate: async (_runtime: IAgentRuntime, _message: Memory) => {
    return true;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      logger.info("[POLYMARKET_GET_MY_POSITIONS] Getting agent positions...");

      // Get entity wallet (handles shared wallet scenario)
      const wallet = await getEntityWallet(
        runtime,
        message,
        "POLYMARKET_GET_MY_POSITIONS",
        callback
      );

      if (wallet.success === false) {
        logger.error(
          "[POLYMARKET_GET_MY_POSITIONS] Failed to get entity wallet"
        );
        return wallet.result;
      }

      const walletAddress = wallet.walletAddress;
      if (!walletAddress) {
        return {
          text: "Unable to determine wallet address.",
          success: false,
          error: "no_wallet_address",
        };
      }

      logger.info(
        `[POLYMARKET_GET_MY_POSITIONS] Fetching positions for wallet: ${walletAddress}`
      );

      // Fetch positions directly from Polymarket API
      const positions = await fetchPositions(walletAddress);

      if (positions.length === 0) {
        const result: ActionResult = {
          text: `**My Polymarket Positions**\n\nNo open positions found.\n\nWallet: \`${walletAddress}\`\n\n**To start trading:**\n1. Use SEARCH_POLYMARKETS to find markets\n2. Use POLYMARKET_BUY_SHARES to open a position`,
          success: true,
          data: { positions: [], count: 0, walletAddress },
        };
        return result;
      }

      // Calculate totals
      let totalValue = 0;
      let totalPnl = 0;

      positions.forEach((position: Position) => {
        const value = position.currentValue || 0;
        const pnl = position.cashPnl || 0;
        totalValue += value;
        totalPnl += pnl;
      });

      // Format response
      let text = `**My Polymarket Positions**\n`;
      text += `═══════════════════════════════════════════════════════\n\n`;
      text += `Found ${positions.length} active position${positions.length > 1 ? "s" : ""}:\n\n`;

      positions.forEach((position: Position, index: number) => {
        const value = position.currentValue || 0;
        const pnl = position.cashPnl || 0;
        const pnlSign = pnl >= 0 ? "+" : "";

        text += `**${index + 1}. ${position.outcome.toUpperCase()} - ${position.title}**\n`;
        text += `   ${position.size.toFixed(2)} shares @ ${(position.curPrice * 100).toFixed(1)}% = $${value.toFixed(2)} (${pnlSign}$${pnl.toFixed(2)})\n`;
        text += `   token_id: \`${position.asset}\`\n`;
        if (position.redeemable) {
          text += `   ⚡ **Redeemable**\n`;
        }
        text += "\n";
      });

      text += `**Total:** $${totalValue.toFixed(2)} (${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)})\n`;
      text += `\nTo sell: use POLYMARKET_SELL_SHARES with token_id from above.`;

      const result: ActionResult = {
        text,
        success: true,
        data: {
          positions: positions.map((p: Position) => ({
            // Key field for POLYMARKET_SELL_SHARES
            token_id: p.asset,
            // Position details
            outcome: p.outcome,
            title: p.title,
            size: p.size,
            curPrice: p.curPrice,
            currentValue: p.currentValue,
            pnl: p.cashPnl,
            redeemable: p.redeemable,
          })),
          count: positions.length,
          walletAddress,
        },
      };

      logger.info(
        `[POLYMARKET_GET_MY_POSITIONS] Found ${positions.length} positions, total value: $${totalValue.toFixed(2)}`
      );
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[POLYMARKET_GET_MY_POSITIONS] Error: ${errorMsg}`);

      const errorResult: ActionResult = {
        text: `Failed to get positions: ${errorMsg}`,
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
        content: { text: "what are my polymarket positions?" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Let me check your Polymarket positions...",
          action: "POLYMARKET_GET_MY_POSITIONS",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "show me what I'm holding on polymarket" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Checking your Polymarket portfolio...",
          action: "POLYMARKET_GET_MY_POSITIONS",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: { text: "check my bets" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Fetching your active positions...",
          action: "POLYMARKET_GET_MY_POSITIONS",
        },
      },
    ],
  ],
};

export default getMyPositionsAction;
