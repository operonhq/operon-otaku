/**
 * Order Helpers
 *
 * Utilities for order creation, validation, and formatting.
 */

import type { OrderParams, PlaceOrderParams, OrderSide } from "../types";
import {
  MIN_PRICE,
  MAX_PRICE,
  MIN_SHARES,
  MIN_ORDER_SIZE_USDC,
  DEFAULT_MAX_TRADE_AMOUNT,
  ERROR_MESSAGES,
} from "../constants";

/**
 * Validate Polymarket token ID format
 *
 * Valid token IDs are long decimal number strings (typically 50+ digits).
 * Invalid formats include:
 * - Hex strings starting with 0x (these are condition IDs or addresses)
 * - Short numbers (market IDs)
 * - Random strings
 *
 * @param tokenId - Token ID to validate
 * @returns true if valid format, false otherwise
 */
export function isValidTokenId(tokenId: string): boolean {
  if (!tokenId || tokenId.length < 20) return false;
  // Token IDs are decimal numbers, not hex
  if (tokenId.startsWith("0x")) return false;
  // Must be all digits (decimal number)
  return /^\d+$/.test(tokenId);
}

/**
 * Validate order parameters
 *
 * @param params - Order parameters to validate
 * @param maxTradeAmount - Maximum allowed trade amount in USDC
 * @returns Object with isValid flag and any error messages
 */
export function validateOrderParams(
  params: OrderParams,
  maxTradeAmount: number = DEFAULT_MAX_TRADE_AMOUNT
): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validate token ID presence and format
  if (!params.tokenId || params.tokenId.length === 0) {
    errors.push("Token ID is required");
  } else if (!isValidTokenId(params.tokenId)) {
    errors.push(
      "Invalid token ID format. Token IDs should be long decimal numbers (not hex). " +
      "Use SEARCH_POLYMARKETS, GET_POLYMARKET_DETAIL, or GET_POLYMARKET_EVENT_DETAIL to get valid token IDs."
    );
  }

  // Validate price
  if (params.price < MIN_PRICE || params.price > MAX_PRICE) {
    errors.push(ERROR_MESSAGES.INVALID_PRICE);
  }

  // Validate size
  if (params.size < MIN_SHARES) {
    errors.push(ERROR_MESSAGES.INVALID_SIZE);
  }

  // Validate total cost doesn't exceed max
  const totalCost = params.price * params.size;
  if (totalCost > maxTradeAmount) {
    errors.push(
      `Trade amount ($${totalCost.toFixed(2)}) exceeds maximum ($${maxTradeAmount})`
    );
  }

  // Validate minimum order size (Polymarket requires $1 minimum)
  if (totalCost < MIN_ORDER_SIZE_USDC) {
    errors.push(ERROR_MESSAGES.ORDER_TOO_SMALL);
  }

  // Validate side
  if (params.side !== "BUY" && params.side !== "SELL") {
    errors.push("Side must be 'BUY' or 'SELL'");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Calculate number of shares from USDC amount and price
 *
 * @param usdcAmount - Amount of USDC to spend
 * @param price - Price per share
 * @returns Number of whole shares that can be purchased
 */
export function calculateSharesFromUsdc(
  usdcAmount: number,
  price: number
): number {
  if (price <= 0 || price > 1) {
    throw new Error(`Invalid price: ${price}`);
  }

  // Shares = USDC / Price
  const shares = Math.floor(usdcAmount / price);
  return shares;
}

/**
 * Calculate USDC cost for a given number of shares
 *
 * @param shares - Number of shares
 * @param price - Price per share
 * @returns Total USDC cost
 */
export function calculateUsdcFromShares(shares: number, price: number): number {
  return shares * price;
}

/**
 * Calculate maximum potential gain for a buy order
 *
 * For a BUY order:
 * - If correct: Each share pays $1, so gain = shares * (1 - price) = shares - cost
 * - If wrong: Lose entire cost
 *
 * @param shares - Number of shares
 * @param price - Price per share
 * @returns Maximum potential gain in USDC
 */
export function calculateMaxGain(shares: number, price: number): number {
  // Each share pays $1 if correct
  // Cost was shares * price
  // Gain = shares * 1 - shares * price = shares * (1 - price)
  return shares * (1 - price);
}

/**
 * Calculate maximum potential loss for a buy order
 *
 * For a BUY order, max loss is the entire cost
 *
 * @param shares - Number of shares
 * @param price - Price per share
 * @returns Maximum potential loss in USDC
 */
export function calculateMaxLoss(shares: number, price: number): number {
  return shares * price;
}

/**
 * Calculate implied probability from price
 *
 * @param price - Price per share (0.01 - 0.99)
 * @returns Implied probability as percentage string (e.g., "45%")
 */
export function calculateImpliedProbability(price: number): string {
  return `${(price * 100).toFixed(1)}%`;
}

/**
 * Format price for display
 *
 * @param price - Price value
 * @param includePercentage - Whether to include probability percentage
 * @returns Formatted price string
 */
export function formatPrice(
  price: number | string,
  includePercentage: boolean = true
): string {
  const priceNum = typeof price === "string" ? parseFloat(price) : price;
  const priceStr = `$${priceNum.toFixed(4)}`;

  if (includePercentage) {
    return `${priceStr} (${calculateImpliedProbability(priceNum)})`;
  }

  return priceStr;
}

/**
 * Format order for display
 *
 * @param params - Order parameters
 * @returns Formatted order summary
 */
export function formatOrderSummary(params: PlaceOrderParams): string {
  const totalCost = params.price * params.size;
  const maxGain = calculateMaxGain(params.size, params.price);
  const maxLoss = calculateMaxLoss(params.size, params.price);

  const lines = [
    `**Order Summary**`,
    `───────────────────────────────`,
    `Market: ${params.marketQuestion}`,
    `Position: ${params.outcome} at ${formatPrice(params.price)}`,
    `Shares: ${params.size}`,
    `Side: ${params.side}`,
    ``,
    `Cost: $${totalCost.toFixed(2)} USDC`,
    `Max Gain: $${maxGain.toFixed(2)} (if ${params.outcome} is correct)`,
    `Max Loss: $${maxLoss.toFixed(2)} (if ${params.outcome} is incorrect)`,
    `───────────────────────────────`,
  ];

  return lines.join("\n");
}

/**
 * Parse outcome string to normalized format
 *
 * @param outcome - Outcome string (case insensitive)
 * @returns Normalized "YES" or "NO"
 */
export function parseOutcome(outcome: string): "YES" | "NO" {
  const normalized = outcome.toUpperCase().trim();

  if (normalized === "YES" || normalized === "Y") {
    return "YES";
  }

  if (normalized === "NO" || normalized === "N") {
    return "NO";
  }

  throw new Error(`Invalid outcome: ${outcome}. Must be 'YES' or 'NO'.`);
}

/**
 * Parse side string to normalized format
 *
 * @param side - Side string (case insensitive)
 * @returns Normalized "BUY" or "SELL"
 */
export function parseSide(side: string): OrderSide {
  const normalized = side.toUpperCase().trim();

  if (normalized === "BUY" || normalized === "B") {
    return "BUY";
  }

  if (normalized === "SELL" || normalized === "S") {
    return "SELL";
  }

  throw new Error(`Invalid side: ${side}. Must be 'BUY' or 'SELL'.`);
}

/**
 * Round price to valid Polymarket tick size
 *
 * Polymarket uses 2 decimal places (0.01 increments)
 *
 * @param price - Raw price
 * @returns Rounded price
 */
export function roundToTickSize(price: number): number {
  return Math.round(price * 100) / 100;
}
