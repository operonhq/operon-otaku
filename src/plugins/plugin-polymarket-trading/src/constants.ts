/**
 * Polymarket Trading Plugin Constants
 *
 * Contract addresses, chain configuration, and API endpoints
 * for Polymarket trading on Polygon.
 */

// ============================================================================
// Chain Configuration
// ============================================================================

/** Polygon chain ID */
export const POLYGON_CHAIN_ID = 137;

/** Chain name */
export const POLYGON_CHAIN_NAME = "polygon";

// ============================================================================
// API Endpoints
// ============================================================================

/** Polymarket CLOB API host */
export const CLOB_HOST = "https://clob.polymarket.com";

/** Polymarket Gamma API host (market metadata) */
export const GAMMA_HOST = "https://gamma-api.polymarket.com";

/** Polymarket Data API host (user data) */
export const DATA_API_HOST = "https://data-api.polymarket.com";

// ============================================================================
// Contract Addresses (Polygon Mainnet)
// ============================================================================

export const CONTRACTS = {
  /**
   * USDC.e (Bridged USDC) - 6 decimals
   * This is the USDC variant used by Polymarket
   */
  USDC_BRIDGED: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as const,

  /**
   * Native USDC on Polygon - 6 decimals
   * Not used by Polymarket, but included for reference
   */
  USDC_NATIVE: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" as const,

  /**
   * Polymarket CTF Exchange
   * Main exchange contract for standard conditional token trades
   */
  CTF_EXCHANGE: "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E" as const,

  /**
   * Polymarket Neg Risk CTF Exchange
   * Exchange for negative risk conditional token trades
   */
  NEG_RISK_CTF_EXCHANGE: "0xC5d563A36AE78145C45a50134d48A1215220f80a" as const,

  /**
   * Polymarket Neg Risk Adapter
   * Adapter for negative risk market operations
   */
  NEG_RISK_ADAPTER: "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296" as const,

  /**
   * Gnosis Conditional Tokens Framework
   * Core conditional tokens contract
   */
  CONDITIONAL_TOKENS: "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045" as const,

  /**
   * Gnosis Safe Proxy Factory
   * Used for proxy wallet derivation
   */
  GNOSIS_PROXY_FACTORY: "0xaB45c5A4B0c941a2F231C04C3f49182e1A254052" as const,
} as const;

// ============================================================================
// Token Configuration
// ============================================================================

/** USDC decimals */
export const USDC_DECIMALS = 6;

/** Maximum approval amount (2^256 - 1) */
export const MAX_APPROVAL =
  "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" as const;

// ============================================================================
// Trading Limits
// ============================================================================

/** Default maximum trade amount in USDC */
export const DEFAULT_MAX_TRADE_AMOUNT = 1000;

/** 
 * Minimum order size in USDC 
 * Polymarket CLOB requires minimum $1 for marketable orders
 */
export const MIN_ORDER_SIZE_USDC = 1.0;

/** 
 * Minimum price (0.1 cent / $0.001)
 * Polymarket CLOB tick size is 0.001
 */
export const MIN_PRICE = 0.001;

/** 
 * Maximum price (99.9 cents / $0.999)
 * Polymarket allows prices up to 0.999
 */
export const MAX_PRICE = 0.999;

/** Minimum shares to trade */
export const MIN_SHARES = 1;

// ============================================================================
// Timing Configuration
// ============================================================================

/** Confirmation token expiry in milliseconds (5 minutes) */
export const CONFIRMATION_EXPIRY_MS = 5 * 60 * 1000;

/** API credentials cache TTL in milliseconds (1 hour) */
export const API_CREDENTIALS_CACHE_TTL = 60 * 60 * 1000;

/** Transaction receipt polling interval in milliseconds */
export const TX_POLL_INTERVAL_MS = 2000;

/** Maximum wait time for transaction confirmation in milliseconds */
export const TX_TIMEOUT_MS = 60 * 1000;

// ============================================================================
// ERC20 ABI (Minimal)
// ============================================================================

export const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

// ============================================================================
// Conditional Tokens ABI (for redemption)
// ============================================================================

export const CONDITIONAL_TOKENS_ABI = [
  {
    name: "redeemPositions",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "collateralToken", type: "address" },
      { name: "parentCollectionId", type: "bytes32" },
      { name: "conditionId", type: "bytes32" },
      { name: "indexSets", type: "uint256[]" },
    ],
    outputs: [],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "id", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "payoutDenominator",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "conditionId", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "payoutNumerators",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "conditionId", type: "bytes32" },
      { name: "outcomeIndex", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// ============================================================================
// Error Messages
// ============================================================================

export const ERROR_MESSAGES = {
  INSUFFICIENT_BALANCE: "Insufficient USDC balance for this trade",
  INSUFFICIENT_ALLOWANCE:
    "USDC spending not approved. Run POLYMARKET_APPROVE_USDC first.",
  MARKET_CLOSED: "This market is closed and no longer accepting trades",
  MARKET_NOT_FOUND: "Market not found with the specified condition ID",
  INVALID_PRICE: `Price must be between ${MIN_PRICE} and ${MAX_PRICE}`,
  INVALID_SIZE: `Trade size must be at least ${MIN_SHARES} shares`,
  ORDER_TOO_SMALL: `Minimum order size is $${MIN_ORDER_SIZE_USDC} USDC. Polymarket requires at least $1 per order.`,
  CONFIRMATION_REQUIRED:
    'Trade requires confirmation. Reply "confirm" to proceed.',
  CONFIRMATION_EXPIRED:
    "Trade confirmation expired. Please initiate the trade again.",
  SETUP_REQUIRED:
    "Trading not set up. Run POLYMARKET_SETUP_TRADING first to configure your wallet.",
  API_CREDENTIALS_MISSING:
    "API credentials not available. Run POLYMARKET_SETUP_TRADING to derive credentials.",
} as const;

// ============================================================================
// Risk Warnings
// ============================================================================

export const RISK_WARNING = `
⚠️ **RISK WARNING**

Prediction markets carry significant risk:
- Your position could lose 100% of its value if the outcome is incorrect
- Markets can be volatile and prices may change rapidly
- Liquidity may be limited, affecting your ability to exit positions
- Past performance does not guarantee future results

By confirming this trade, you acknowledge that you understand these risks.
`;

export const US_DISCLAIMER = `
Note: Polymarket is not available to US residents. Trading while circumventing 
geographic restrictions violates their Terms of Service and may result in 
account termination and loss of funds.
`;
