/**
 * Polymarket Trading Plugin
 *
 * Enables trading on Polymarket prediction markets using CDP wallets.
 *
 * Features:
 * - CDP wallet integration for secure signing
 * - L2 API credential derivation
 * - USDC approval management
 * - Order placement with safety confirmations
 * - Order cancellation and management
 *
 * Trading Actions:
 * - POLYMARKET_SETUP_TRADING: One-time setup for trading
 * - POLYMARKET_BUY_SHARES: Buy YES/NO shares
 * - POLYMARKET_SELL_SHARES: Sell existing positions
 * - POLYMARKET_PLACE_LIMIT_ORDER: Place limit orders
 * - POLYMARKET_CANCEL_ORDER: Cancel open orders
 * - POLYMARKET_GET_OPEN_ORDERS: View open orders
 * - POLYMARKET_GET_MY_POSITIONS: View agent's current positions
 * - POLYMARKET_REDEEM: Redeem winnings from resolved markets
 * - POLYMARKET_APPROVE_USDC: Approve USDC spending
 *
 * Configuration:
 * - CDP_API_KEY_ID: CDP API key ID
 * - CDP_API_KEY_SECRET: CDP API key secret
 * - CDP_WALLET_SECRET: CDP wallet secret
 * - ALCHEMY_API_KEY: Alchemy API key for Polygon RPC
 * - POLYMARKET_MAX_TRADE_AMOUNT: Maximum trade amount in USDC (default: 1000)
 * - POLYMARKET_REQUIRE_CONFIRMATION: Require explicit confirmation (default: true)
 *
 * Usage:
 * 1. Run POLYMARKET_SETUP_TRADING to initialize
 * 2. Fund wallet with MATIC (gas) and USDC.e (trading)
 * 3. Use SEARCH_POLYMARKETS (from discovery plugin) to find markets
 * 4. Use POLYMARKET_BUY_SHARES or POLYMARKET_SELL_SHARES to trade
 */

import type { Plugin } from "@elizaos/core";

// Service
import { PolymarketTradingService } from "./services/trading.service";

// Actions
import { setupTradingAction } from "./actions/setupTrading.action";
import { buySharesAction } from "./actions/buyShares.action";
import { sellSharesAction } from "./actions/sellShares.action";
import { placeLimitOrderAction } from "./actions/placeLimitOrder.action";
import { cancelOrderAction } from "./actions/cancelOrder.action";
import { getOpenOrdersAction } from "./actions/getOpenOrders.action";
import { getMyPositionsAction } from "./actions/getMyPositions.action";
import { redeemWinningsAction } from "./actions/redeemWinnings.action";
import { approveUsdcAction } from "./actions/approveUsdc.action";

// Types
export type * from "./types";

// Constants
export * from "./constants";

// Adapters
export { CdpSignerAdapter } from "./adapters/cdp-signer-adapter";

// Utils
export * from "./utils";

// Matcher (for context-aware action activation)
export { shouldPolymarketTradingPluginBeInContext, polymarketTradingKeywordPatterns } from "../matcher";

/**
 * Polymarket Trading Plugin
 *
 * Provides trading capabilities on Polymarket prediction markets:
 *
 * Setup & Configuration:
 * - POLYMARKET_SETUP_TRADING: Initialize wallet and API credentials
 * - POLYMARKET_APPROVE_USDC: Approve USDC spending on exchanges
 *
 * Trading:
 * - POLYMARKET_BUY_SHARES: Buy YES/NO shares with confirmation
 * - POLYMARKET_SELL_SHARES: Sell positions with confirmation
 * - POLYMARKET_PLACE_LIMIT_ORDER: Place limit orders
 *
 * Order Management:
 * - POLYMARKET_GET_OPEN_ORDERS: View active orders
 * - POLYMARKET_CANCEL_ORDER: Cancel specific or all orders
 *
 * Portfolio:
 * - POLYMARKET_GET_MY_POSITIONS: View agent's current positions with PnL
 *
 * Redemption:
 * - POLYMARKET_REDEEM: Redeem winnings from resolved markets
 *
 * Works best with plugin-polymarket-discovery for market data.
 */
export const polymarketTradingPlugin: Plugin = {
  name: "polymarket-trading",
  description:
    "Trade on Polymarket prediction markets with CDP wallet integration and safety confirmations",
  evaluators: [],
  providers: [],
  actions: [
    // Setup
    setupTradingAction,
    approveUsdcAction,
    // Trading
    buySharesAction,
    sellSharesAction,
    placeLimitOrderAction,
    // Order Management
    getOpenOrdersAction,
    cancelOrderAction,
    // Portfolio
    getMyPositionsAction,
    // Redemption
    redeemWinningsAction,
  ],
  services: [PolymarketTradingService],
};

export default polymarketTradingPlugin;

