/**
 * Polymarket Trading Plugin Type Definitions
 *
 * Trading-specific types for order placement, position management,
 * and safety confirmations.
 */

import type { EvmServerAccount } from "@coinbase/cdp-sdk";

// ============================================================================
// Trading Setup Types
// ============================================================================

/**
 * Result of the trading setup process
 */
export interface TradingSetupResult {
  /** CDP wallet address on Polygon */
  walletAddress: string;
  /** Whether L2 API credentials are available */
  hasApiCredentials: boolean;
  /** USDC allowance on CTF Exchange (for buying) */
  ctfExchangeAllowance: string;
  /** USDC allowance on Neg Risk CTF Exchange (for buying) */
  negRiskExchangeAllowance: string;
  /** USDC allowance on Neg Risk Adapter (required for neg risk markets) */
  negRiskAdapterAllowance: string;
  /** Whether CTF tokens can be transferred by CTF Exchange (for selling) */
  ctfExchangeTokenApproval: boolean;
  /** Whether CTF tokens can be transferred by Neg Risk Exchange (for selling) */
  negRiskExchangeTokenApproval: boolean;
  /** Whether CTF tokens can be transferred by Neg Risk Adapter (for selling) */
  negRiskAdapterTokenApproval: boolean;
  /** Whether setup is complete and ready for trading */
  isReady: boolean;
  /** Any warnings or issues found */
  warnings: string[];
}

/**
 * API credentials for L2 authentication with CLOB
 * Note: The CLOB client uses 'key' but we also store 'apiKey' for clarity
 */
export interface ApiCredentials {
  key: string;
  apiKey: string;
  secret: string;
  passphrase: string;
}

/**
 * Trading service configuration
 */
export interface TradingServiceConfig {
  /** Polygon RPC URL */
  polygonRpcUrl: string;
  /** CLOB API host */
  clobHost: string;
  /** Maximum trade amount in USDC */
  maxTradeAmount: number;
  /** Whether to require explicit confirmation */
  requireConfirmation: boolean;
}

// ============================================================================
// Order Types
// ============================================================================

/**
 * Side of an order
 */
export type OrderSide = "BUY" | "SELL";

/**
 * Parameters for creating an order
 */
export interface OrderParams {
  /** ERC1155 token ID for the outcome */
  tokenId: string;
  /** Price per share (0.01 - 0.99) - used for display/estimates */
  price: number;
  /** Number of shares to trade (for limit orders) */
  size: number;
  /** Order side */
  side: OrderSide;
  /** Fee rate in basis points (default: 0) */
  feeRateBps?: number;
  /** USDC amount for market orders (if set, used instead of size*price for BUY) */
  usdcAmount?: number;
}

/**
 * Valid tick sizes for Polymarket orders
 */
export type TickSize = "0.1" | "0.01" | "0.001" | "0.0001";

/**
 * Parameters for creating a limit order (GTC - Good Till Cancelled)
 */
export interface LimitOrderParams {
  /** ERC1155 token ID for the outcome */
  tokenId: string;
  /** Limit price per share (0.01 - 0.99) */
  price: number;
  /** Number of shares */
  size: number;
  /** Order side */
  side: OrderSide;
  /** Tick size for the market (e.g., "0.01" or "0.001") */
  tickSize?: TickSize;
  /** Whether this is a neg risk market */
  negRisk?: boolean;
  /** Fee rate in basis points (default: 0) */
  feeRateBps?: number;
}

/**
 * Parameters for placing an order with market context
 */
export interface PlaceOrderParams extends OrderParams {
  /** Condition ID of the market */
  conditionId: string;
  /** Market question for display */
  marketQuestion: string;
  /** Outcome being traded (YES/NO) */
  outcome: "YES" | "NO";
}

/**
 * Result of an order placement
 */
export interface OrderResult {
  /** Unique order identifier */
  orderId: string;
  /** Order status - FILLED means executed on-chain, PLACED means in orderbook */
  status: "PLACED" | "FILLED" | "PARTIAL" | "CANCELLED" | "FAILED";
  /** Transaction hash (present when status is FILLED) */
  transactionHash?: string;
  /** Executed price per share */
  executedPrice?: string;
  /** Executed size in shares */
  executedSize?: string;
  /** Remaining size (for partial fills) */
  remainingSize?: string;
  /** Timestamp */
  timestamp: number;
  /** Error message if failed */
  error?: string;
}

/**
 * Open order information
 */
export interface OpenOrder {
  /** Order ID */
  orderId: string;
  /** Condition ID */
  conditionId: string;
  /** Token ID */
  tokenId: string;
  /** Market question */
  marketQuestion?: string;
  /**
   * Outcome for the order.
   * For standard markets: "YES" or "NO"
   * For sports/alternative markets: may be team names or other outcomes
   * Derived from token metadata, not order side.
   */
  outcome: string;
  /** Side */
  side: OrderSide;
  /** Price */
  price: string;
  /** Original size */
  originalSize: string;
  /** Remaining size */
  remainingSize: string;
  /** Created timestamp */
  createdAt: number;
}

/**
 * Cancel order result
 */
export interface CancelOrderResult {
  /** Order ID that was cancelled */
  orderId: string;
  /** Whether cancellation was successful */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

// ============================================================================
// Confirmation & Safety Types
// ============================================================================

/**
 * Trade confirmation request for safety
 */
export interface ConfirmationRequest {
  /** Market question */
  market: string;
  /** Condition ID */
  conditionId: string;
  /** Outcome being traded */
  outcome: "YES" | "NO";
  /** Side */
  side: OrderSide;
  /** Price per share */
  price: number;
  /** Number of shares */
  shares: number;
  /** Total cost in USDC */
  totalCost: number;
  /** Maximum possible loss */
  maxLoss: number;
  /** Maximum possible gain */
  maxGain: number;
  /** Implied probability */
  impliedProbability: string;
  /** Unique confirmation token */
  confirmationToken: string;
}

/**
 * Confirmation validation result
 */
export interface ConfirmationValidation {
  /** Whether the confirmation is valid */
  isValid: boolean;
  /** The original request if valid */
  request?: ConfirmationRequest;
  /** Error message if invalid */
  error?: string;
}

// ============================================================================
// Balance & Position Types
// ============================================================================

/**
 * USDC balance information
 */
export interface UsdcBalance {
  /** Available USDC balance */
  available: string;
  /** USDC locked in open orders */
  locked: string;
  /** Total USDC */
  total: string;
}

/**
 * Allowance status for Polymarket contracts
 */
export interface AllowanceStatus {
  /** Allowance on CTF Exchange */
  ctfExchange: string;
  /** Allowance on Neg Risk CTF Exchange */
  negRiskExchange: string;
  /** Allowance on Neg Risk Adapter (required for neg risk markets) */
  negRiskAdapter: string;
  /** Whether unlimited approval is set on all contracts */
  isUnlimited: boolean;
}

// ============================================================================
// Redemption Types
// ============================================================================

/**
 * Redeemable position
 */
export interface RedeemablePosition {
  /** Condition ID */
  conditionId: string;
  /** Market question */
  market: string;
  /** Winning outcome */
  outcome: "YES" | "NO";
  /** Shares to redeem */
  shares: string;
  /** Payout amount in USDC */
  payout: string;
}

/**
 * Redemption result
 */
export interface RedemptionResult {
  /** Condition ID */
  conditionId: string;
  /** Amount redeemed */
  amount: string;
  /** Transaction hash */
  transactionHash: string;
  /** Whether redemption was successful */
  success: boolean;
  /** Error if failed */
  error?: string;
}

// ============================================================================
// CDP Signer Types
// ============================================================================

/**
 * Typed data field for EIP-712 signing
 */
export interface TypedDataField {
  name: string;
  type: string;
}

/**
 * EIP-712 typed data domain
 */
export interface TypedDataDomain {
  name?: string;
  version?: string;
  chainId?: number;
  verifyingContract?: string;
  salt?: string;
}

/**
 * CDP Signer Adapter interface
 * Bridges CDP accounts to ethers.js v5 Signer interface
 */
export interface ICdpSignerAdapter {
  /** Wallet address */
  address: string;
  /** Get wallet address */
  getAddress(): Promise<string>;
  /** Sign EIP-712 typed data (ethers v5 interface) */
  _signTypedData(
    domain: TypedDataDomain,
    types: Record<string, TypedDataField[]>,
    value: Record<string, unknown>
  ): Promise<string>;
  /** Sign a message */
  signMessage(message: string | Uint8Array): Promise<string>;
  /** Provider stub for network info */
  provider: { getNetwork: () => Promise<{ chainId: number; name?: string }> };
}

// ============================================================================
// User State Types
// ============================================================================

/**
 * Cached user state for trading
 */
export interface UserTradingState {
  /** User identifier */
  userId: string;
  /** CDP account */
  cdpAccount?: EvmServerAccount;
  /** API credentials */
  apiCredentials?: ApiCredentials;
  /** Last setup check timestamp */
  lastSetupCheck?: number;
  /** Pending confirmations */
  pendingConfirmations: Map<string, ConfirmationRequest>;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Trading-specific error codes
 */
export enum TradingErrorCode {
  INSUFFICIENT_BALANCE = "INSUFFICIENT_BALANCE",
  INSUFFICIENT_ALLOWANCE = "INSUFFICIENT_ALLOWANCE",
  MARKET_CLOSED = "MARKET_CLOSED",
  MARKET_NOT_FOUND = "MARKET_NOT_FOUND",
  INVALID_PRICE = "INVALID_PRICE",
  INVALID_SIZE = "INVALID_SIZE",
  ORDER_FAILED = "ORDER_FAILED",
  CONFIRMATION_REQUIRED = "CONFIRMATION_REQUIRED",
  CONFIRMATION_EXPIRED = "CONFIRMATION_EXPIRED",
  API_CREDENTIALS_MISSING = "API_CREDENTIALS_MISSING",
  SETUP_REQUIRED = "SETUP_REQUIRED",
  SIGNING_FAILED = "SIGNING_FAILED",
  NETWORK_ERROR = "NETWORK_ERROR",
}

/**
 * Trading error
 */
export interface TradingError {
  code: TradingErrorCode;
  message: string;
  details?: unknown;
}

