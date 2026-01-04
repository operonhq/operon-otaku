import type { Memory, State } from "@elizaos/core";
import { matchesPluginContext, type PluginKeywordPatterns } from "@/utils/plugin-context-matcher";

/**
 * Keyword patterns for Polymarket Trading plugin context activation
 * 
 * These patterns are focused on TRADING operations (buy, sell, orders, positions)
 * vs the Discovery plugin which focuses on browsing/searching markets.
 */
export const polymarketTradingKeywordPatterns: PluginKeywordPatterns = {
  keywords: [
    // Trading core (always active)
    "polymarket",
    
    // Buy/Sell actions
    "buy shares", "sell shares", "buy yes", "buy no", "sell yes", "sell no",
    "place order", "place bet", "execute trade", "make a trade",
    
    // Order management
    "limit order", "cancel order", "open orders", "pending orders",
    "my orders", "view orders", "cancel all",
    
    // Position management
    "my positions", "my portfolio", "my holdings", "my bets",
    "check positions", "view positions", "position pnl",
    
    // Trading setup
    "setup trading", "approve usdc", "trading setup",
    "enable trading", "configure trading",
    
    // Redemption
    "redeem", "winnings", "claim winnings", "collect winnings",
  ],
  regexPatterns: [
    // Buy patterns
    /buy\s+\$?\d+/i,
    /buy\s+(?:on|some|more)/i,
    /purchase\s+(?:shares|position)/i,
    
    // Sell patterns
    /sell\s+(?:my|all|some|\d+)/i,
    /exit\s+(?:position|my)/i,
    /close\s+(?:position|my)/i,
    
    // Order patterns
    /(?:place|set|create)\s+(?:a\s+)?(?:limit\s+)?order/i,
    /cancel\s+(?:order|all|my)/i,
    
    // Position patterns
    /(?:show|check|view|get)\s+(?:my\s+)?(?:positions|portfolio|holdings)/i,
    /what\s+(?:do\s+i\s+)?(?:hold|own)/i,
    /what.*my\s+positions/i,
    
    // Trade execution patterns
    /trade\s+on\s+polymarket/i,
    /polymarket\s+trade/i,
    /bet\s+(?:on|against)/i,
    
    // Setup patterns
    /setup\s+(?:polymarket|trading)/i,
    /approve\s+(?:usdc|spending)/i,
  ],
};

/**
 * Check if Polymarket Trading plugin should be active based on recent conversation
 *
 * Use this in each Polymarket Trading action's validate function:
 *
 * @example
 * ```ts
 * validate: async (_runtime: IAgentRuntime, message: Memory, state?: State) => {
 *   // Check plugin context first
 *   if (!shouldPolymarketTradingPluginBeInContext(state, message)) {
 *     return false;
 *   }
 *
 *   // Then check service availability
 *   const service = _runtime.getService(PolymarketTradingService.serviceType);
 *   return !!service;
 * }
 * ```
 */
export function shouldPolymarketTradingPluginBeInContext(state?: State, message?: Memory): boolean {
  if (!state) return true; // If no state, always active (fallback)
  return matchesPluginContext(state, polymarketTradingKeywordPatterns, message);
}

