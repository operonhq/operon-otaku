/**
 * POLYMARKET_BUY_SHARES Action
 *
 * Buy YES or NO shares on a Polymarket prediction market.
 * Executes immediately when called with valid parameters.
 *
 * WORKFLOW FOR AGENTS:
 * 1. First, use SEARCH_POLYMARKETS to find the market and get the token_id
 *    - Use yes_token_id for YES shares, no_token_id for NO shares
 * 2. Call this action with the token_id, outcome, amount, and price
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
import {
  parseOutcome,
  calculateMaxGain,
  isValidTokenId,
} from "../utils/orderHelpers";
import { MIN_ORDER_SIZE_USDC } from "../constants";

interface BuySharesParams {
  // Required parameters
  token_id?: string;
  tokenId?: string;
  outcome?: string;
  amount?: string | number;

  // Optional parameters
  price?: string | number;
  market_question?: string;
  marketQuestion?: string;
  condition_id?: string;
  conditionId?: string;
}


export const buySharesAction: Action = {
  name: "POLYMARKET_BUY_SHARES",
  similes: [
    "BUY_POLYMARKET",
    "BUY_PREDICTION",
    "POLYMARKET_BUY",
    "PLACE_POLYMARKET_BET",
  ],
  description: `Buy YES or NO shares on a Polymarket prediction market. Executes immediately.

**WORKFLOW:**
1. FIRST get token IDs using ONE of these actions:
   - SEARCH_POLYMARKETS: Returns yes_token_id/no_token_id for matching markets
   - GET_POLYMARKET_DETAIL: Returns token IDs for a specific market
   - GET_POLYMARKET_EVENT_DETAIL: Returns token IDs for all markets in an event (sports, etc.)
2. THEN call POLYMARKET_BUY_SHARES with the token_id, outcome, amount, and price

**CRITICAL - Token ID Format:**
- Token IDs are LONG DECIMAL NUMBERS like: 72021705026613735092487991500143179671848673350211582512747266204751673572514
- Do NOT use condition_id (hex starting with 0x) as token_id - these are different!
- Do NOT use market_id (short numbers) as token_id

**REQUIRED PARAMETERS:**
- token_id: The ERC1155 token ID (use yes_token_id for YES, no_token_id for NO)
- outcome: "YES" or "NO" (must match the token_id used)
- amount: Amount in USDC to spend (e.g., 1, 5, 10)
- price: Limit price between 0.01-0.99 (use yes_price or no_price from search/detail)

**EXAMPLE:**
If search returned: yes_token_id="72021705026...", yes_price="0.51"
And user wants to buy $5 of YES shares:
- token_id: "72021705026..."
- outcome: "YES"
- amount: 5
- price: 0.51`,

  parameters: {
    token_id: {
      type: "string",
      description:
        "REQUIRED. The ERC1155 token ID from SEARCH_POLYMARKETS. Use yes_token_id to buy YES, no_token_id to buy NO.",
      required: true,
    },
    outcome: {
      type: "string",
      description: "REQUIRED. Which outcome to buy: 'YES' or 'NO'. Must match the token_id used.",
      required: true,
    },
    amount: {
      type: "number",
      description: "REQUIRED. Amount in USDC to spend on this trade (e.g., 1, 5, 10).",
      required: true,
    },
    price: {
      type: "number",
      description:
        "REQUIRED. Limit price between 0.01-0.99. Use yes_price (for YES) or no_price (for NO) from SEARCH_POLYMARKETS.",
      required: true,
    },
    market_question: {
      type: "string",
      description: "OPTIONAL. The market question for display.",
      required: false,
    },
    condition_id: {
      type: "string",
      description: "OPTIONAL. The market condition ID for reference.",
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

      if (!service) {
        logger.warn("[POLYMARKET_BUY_SHARES] Trading service not available");
        return false;
      }

      return true;
    } catch (error) {
      logger.error(
        "[POLYMARKET_BUY_SHARES] Validation error:",
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
      logger.info("[POLYMARKET_BUY_SHARES] Processing buy request...");

      // Get entity wallet (handles shared wallet scenario)
      const wallet = await getEntityWallet(
        runtime,
        message,
        "POLYMARKET_BUY_SHARES",
        callback,
      );

      if (wallet.success === false) {
        logger.error("[POLYMARKET_BUY_SHARES] Failed to get entity wallet");
        return wallet.result;
      }

      // Use the wallet's account name (walletEntityId) as the userId for the trading service
      // This ensures we use the same CDP account that was originally created for this entity
      const userId = wallet.metadata?.walletEntityId || wallet.metadata?.accountName || message.entityId;
      if (!userId) {
        return {
          text: "Unable to identify entity for trading.",
          success: false,
          error: "no_entity_id",
        };
      }

      logger.info(`[POLYMARKET_BUY_SHARES] Using wallet account: ${userId}, address: ${wallet.walletAddress}`);

      const service = runtime.getService(
        PolymarketTradingService.serviceType
      ) as PolymarketTradingService;

      if (!service) {
        return {
          text: "Polymarket trading service is not available. Make sure the plugin is configured correctly.",
          success: false,
          error: "service_unavailable",
        };
      }

      // Check if setup is complete
      const isSetup = await service.isSetupComplete(userId);
      if (!isSetup) {
        return {
          text: "Trading not set up. Run POLYMARKET_SETUP_TRADING first to configure your wallet.\n\n**Action Required:** Call POLYMARKET_SETUP_TRADING first to initialize the wallet and API credentials.",
          success: false,
          error: "setup_required",
        };
      }

      // Parse parameters from state
      const composedState = await runtime.composeState(
        message,
        ["ACTION_STATE"],
        true
      );
      const params = (composedState?.data?.actionParams ??
        {}) as Partial<BuySharesParams>;

      logger.info(`[POLYMARKET_BUY_SHARES] Received params: ${JSON.stringify(params)}`);

      // ========================================================================
      // STEP 1: Validate all required parameters
      // ========================================================================
      const tokenId = params.token_id || params.tokenId;
      const outcomeStr = params.outcome;
      const amountStr = params.amount;
      const priceStr = params.price;
      const marketQuestion = params.market_question || params.marketQuestion || "Unknown Market";

      // Collect all missing parameters
      const missingParams: string[] = [];

      if (!tokenId) {
        missingParams.push("token_id (get from SEARCH_POLYMARKETS: use yes_token_id for YES, no_token_id for NO)");
      }

      if (!outcomeStr) {
        missingParams.push("outcome (must be 'YES' or 'NO')");
      }

      if (amountStr === undefined || amountStr === null) {
        missingParams.push("amount (USDC amount to spend, e.g., 1, 5, 10)");
      }

      if (priceStr === undefined || priceStr === null) {
        missingParams.push("price (use yes_price or no_price from SEARCH_POLYMARKETS)");
      }

      if (missingParams.length > 0) {
        const errorMessage = `❌ **Missing Required Parameters**

The following parameters are missing:
${missingParams.map(p => `• ${p}`).join("\n")}

**How to fix:**
1. Call SEARCH_POLYMARKETS first to find the market
2. Use the returned values (yes_token_id, yes_price, etc.)
3. Call POLYMARKET_BUY_SHARES with all required parameters

**Example:**
\`\`\`
token_id: "123..." (from yes_token_id or no_token_id)
outcome: "YES"
amount: 5
price: 0.10 (from yes_price or no_price)
\`\`\``;

        return {
          text: errorMessage,
          success: false,
          error: "missing_parameters",
          data: { missingParams },
        };
      }

      // ========================================================================
      // STEP 1.5: Validate token ID format (catch invalid IDs early)
      // ========================================================================
      if (tokenId && !isValidTokenId(tokenId)) {
        const errorMessage = `❌ **Invalid Token ID Format**

The token_id provided (\`${tokenId}\`) is not a valid Polymarket token ID.

**Valid token IDs are:**
- Long decimal numbers (50+ digits)
- Example: \`72021705026613735092487991500143179671848673350211582512747266204751673572514\`

**Invalid formats:**
- Hex strings starting with 0x (these are condition IDs or addresses)
- Short numbers or random strings

**How to get valid token IDs:**
1. Use SEARCH_POLYMARKETS - returns \`yes_token_id\` and \`no_token_id\`
2. Use GET_POLYMARKET_DETAIL - returns token IDs for the market
3. Use GET_POLYMARKET_EVENT_DETAIL - returns token IDs for all markets in an event`;

        return {
          text: errorMessage,
          success: false,
          error: "invalid_token_id_format",
          data: { providedTokenId: tokenId },
        };
      }

      // ========================================================================
      // STEP 2: Parse and validate parameter values
      // ========================================================================
      let outcome: "YES" | "NO";
      try {
        outcome = parseOutcome(outcomeStr!);
      } catch (e) {
        return {
          text: `❌ **Invalid Outcome**\n\nGot: "${outcomeStr}"\nExpected: "YES" or "NO"`,
          success: false,
          error: "invalid_outcome",
        };
      }

      const amount = typeof amountStr === "string" ? parseFloat(amountStr) : amountStr!;
      if (isNaN(amount) || amount <= 0) {
        return {
          text: `❌ **Invalid Amount**\n\nGot: "${amountStr}"\nExpected: A positive number (e.g., 1, 5, 10)`,
          success: false,
          error: "invalid_amount",
        };
      }

      const price = typeof priceStr === "string" ? parseFloat(priceStr) : priceStr!;
      if (isNaN(price) || price <= 0 || price >= 1) {
        return {
          text: `❌ **Invalid Price**\n\nGot: "${priceStr}"\nExpected: A number between 0.01 and 0.99\n\n**Tip:** Use yes_price or no_price from SEARCH_POLYMARKETS results.`,
          success: false,
          error: "invalid_price",
        };
      }

      // ========================================================================
      // STEP 3: Validate USDC amount (market order - CLOB handles shares)
      // ========================================================================
      // For market orders, we just pass the USDC amount directly
      // The CLOB will give us whatever shares we can get at market price
      if (amount < MIN_ORDER_SIZE_USDC) {
        return {
          text: `❌ **Order Too Small**\n\nAmount: $${amount.toFixed(2)} USDC\nMinimum: $${MIN_ORDER_SIZE_USDC} USDC\n\nPolymarket requires at least $1 per order.`,
          success: false,
          error: "order_too_small",
        };
      }

      // Estimate shares for display (actual may vary based on orderbook)
      const estimatedShares = Math.floor(amount / price);
      const estimatedMaxGain = calculateMaxGain(estimatedShares, price);
      const estimatedMaxLoss = amount; // Max loss is what we spend

      // ========================================================================
      // STEP 4: Check balance
      // ========================================================================
      const balance = await service.getUsdcBalance(userId);
      if (parseFloat(balance.available) < amount) {
        logger.warn(`[POLYMARKET_BUY_SHARES] Insufficient balance: ${balance.available} < ${amount}`);
        
        return {
          text: `❌ **Insufficient Balance**

• Available: $${balance.available} USDC
• Required: $${amount.toFixed(2)} USDC
• Shortfall: $${(amount - parseFloat(balance.available)).toFixed(2)} USDC

Please add more USDC to your wallet or reduce the trade amount.`,
          success: false,
          error: "insufficient_balance",
          data: {
            available: balance.available,
            required: amount,
            shortfall: amount - parseFloat(balance.available),
          },
        };
      }

      // ========================================================================
      // STEP 5: Execute the trade immediately
      // ========================================================================
      logger.info(`[POLYMARKET_BUY_SHARES] Executing market order: $${amount} USDC for ${outcome} shares`);

      // For market orders, pass the USDC amount directly
      // The trading service uses createAndPostMarketOrder which executes at best available price
      const orderResult = await service.placeOrder(userId, {
        tokenId: tokenId!,
        price,
        size: estimatedShares,
        side: "BUY",
        usdcAmount: amount, // Pass USDC amount for market order
      });

      if ((orderResult.status === "FILLED" || orderResult.status === "PLACED") && orderResult.orderId) {
        const isFilled = orderResult.status === "FILLED";
        const executedShares = orderResult.executedSize || estimatedShares;
        const txHash = orderResult.transactionHash;
        
        logger.info(`[POLYMARKET_BUY_SHARES] Trade ${isFilled ? 'FILLED' : 'placed'}! Order ID: ${orderResult.orderId}${txHash ? `, TX: ${txHash}` : ''}`);
        
        let resultText = `✅ **Trade ${isFilled ? 'Executed' : 'Placed'} Successfully**
═══════════════════════════════════════════════════════

**Market:** ${marketQuestion}
**Position:** BUY ${executedShares} ${outcome} shares
**Cost:** $${amount.toFixed(2)} USDC
`;

        if (txHash) {
          resultText += `
**Transaction:** [\`${txHash.substring(0, 18)}...\`](https://polygonscan.com/tx/${txHash})
`;
        }

        resultText += `
**Order ID:** \`${orderResult.orderId}\`

Use GET_POLYMARKET_POSITIONS to view your positions.
`;
        
        return {
          text: resultText,
          success: true,
          data: {
            orderId: orderResult.orderId,
            transactionHash: txHash,
            status: orderResult.status,
            market: marketQuestion,
            outcome,
            shares: executedShares,
            price,
            cost: amount,
          },
        };
      } else {
        // Order failed - show the actual error from CLOB
        const errorMessage = orderResult.error || "Unknown error - no details from Polymarket";
        
        logger.error(`[POLYMARKET_BUY_SHARES] Trade failed: ${errorMessage}`);
        
        return {
          text: `❌ **Trade Failed**

**Reason:** ${errorMessage}

**Order Details:**
- Market: ${marketQuestion}
- Position: ${outcome}
- Amount: $${amount.toFixed(2)} USDC
- Estimated shares: ~${estimatedShares}

Please fix the issue and try again.`,
          success: false,
          error: errorMessage,
          data: {
            failureReason: errorMessage,
            market: marketQuestion,
            outcome,
            amount,
            estimatedShares,
            price,
          },
        };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[POLYMARKET_BUY_SHARES] Unexpected error: ${errorMsg}`);

      return {
        text: `❌ **Trade Error**

**Error:** ${errorMsg}

This may be a temporary issue. Please try again.`,
        success: false,
        error: errorMsg,
      };
    }
  },

  examples: [
    [
      {
        name: "{{user}}",
        content: {
          text: "buy $5 of YES on the Bitcoin 100k market",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "I'll help you buy YES shares. Let me search for the Bitcoin 100k market and execute the trade...",
          action: "SEARCH_POLYMARKETS",
        },
      },
    ],
  ],
};

export default buySharesAction;
