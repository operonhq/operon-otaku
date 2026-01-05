/**
 * Polymarket Trading Service
 *
 * Core service for trading on Polymarket using CDP wallets.
 * Wraps the @polymarket/clob-client with CDP signer integration.
 */

import {
  type IAgentRuntime,
  Service,
  logger,
} from "@elizaos/core";
import { CdpClient, type EvmServerAccount } from "@coinbase/cdp-sdk";
import { ClobClient, Side, OrderType } from "@polymarket/clob-client";
import { createPublicClient, type Hex } from "viem";
import { CdpSignerAdapter } from "../adapters/cdp-signer-adapter";
import type {
  TradingSetupResult,
  ApiCredentials,
  OrderParams,
  LimitOrderParams,
  OrderResult,
  OpenOrder,
  CancelOrderResult,
  TradingServiceConfig,
  AllowanceStatus,
  UsdcBalance,
} from "../types";
import {
  POLYGON_CHAIN_ID,
  CLOB_HOST,
  GAMMA_HOST,
  CONTRACTS,
  DEFAULT_MAX_TRADE_AMOUNT,
  API_CREDENTIALS_CACHE_TTL,
} from "../constants";
import {
  checkAllAllowances,
  checkAllCtfApprovals,
  checkUsdcBalance,
  checkMaticBalance,
  approveAllPolymarketContracts,
  createPolygonPublicClient,
} from "../utils/approvalHelpers";

/**
 * Cached user state for trading
 */
interface UserState {
  cdpAccount: EvmServerAccount;
  signer: CdpSignerAdapter;
  apiCredentials?: ApiCredentials;
  lastCredentialsCheck: number;
}

/**
 * Polymarket Trading Service
 *
 * Provides trading capabilities on Polymarket using CDP wallets:
 * - Wallet setup and API credential derivation
 * - USDC approval management
 * - Order placement and cancellation
 * - Position management
 */
export class PolymarketTradingService extends Service {
  static serviceType = "POLYMARKET_TRADING_SERVICE" as const;
  capabilityDescription =
    "Trade on Polymarket prediction markets using CDP wallets with safety confirmations.";

  // CDP client
  private cdpClient: CdpClient | null = null;

  // Configuration
  private polygonRpcUrl: string = "";
  private maxTradeAmount: number = DEFAULT_MAX_TRADE_AMOUNT;
  private requireConfirmation: boolean = true;

  // User state cache
  private userStates: Map<string, UserState> = new Map();

  // Public client for read operations
  private publicClient: ReturnType<typeof createPublicClient> | null = null;

  constructor(runtime: IAgentRuntime) {
    super(runtime);
  }

  /**
   * Static start method required by ElizaOS runtime
   */
  static async start(
    runtime: IAgentRuntime
  ): Promise<PolymarketTradingService> {
    const instance = new PolymarketTradingService(runtime);
    await instance.initialize(runtime);
    return instance;
  }

  /**
   * Initialize the service
   */
  async initialize(runtime: IAgentRuntime): Promise<void> {
    logger.info("[PolymarketTradingService] Initializing...");

    // Check CDP credentials
    const apiKeyId = process.env.CDP_API_KEY_ID;
    const apiKeySecret = process.env.CDP_API_KEY_SECRET;
    const walletSecret = process.env.CDP_WALLET_SECRET;

    if (!apiKeyId || !apiKeySecret || !walletSecret) {
      logger.warn(
        "[PolymarketTradingService] CDP credentials not configured. Trading will not be available."
      );
      return;
    }

    // Initialize CDP client
    this.cdpClient = new CdpClient({
      apiKeyId,
      apiKeySecret,
      walletSecret,
    });

    // Configure RPC URL
    const alchemyKey = process.env.ALCHEMY_API_KEY;
    if (alchemyKey) {
      this.polygonRpcUrl = `https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}`;
    } else {
      this.polygonRpcUrl = "https://polygon-rpc.com";
      logger.warn(
        "[PolymarketTradingService] ALCHEMY_API_KEY not set, using public RPC"
      );
    }

    // Initialize public client
    this.publicClient = createPolygonPublicClient(this.polygonRpcUrl);

    // Load configuration from runtime settings
    const maxTradeAmountSetting = runtime.getSetting(
      "POLYMARKET_MAX_TRADE_AMOUNT"
    ) as string;
    if (maxTradeAmountSetting) {
      const parsed = parseFloat(maxTradeAmountSetting);
      if (!isNaN(parsed) && parsed > 0) {
        this.maxTradeAmount = parsed;
      } else {
        logger.warn(
          `[PolymarketTradingService] Invalid POLYMARKET_MAX_TRADE_AMOUNT "${maxTradeAmountSetting}" - must be a positive number. Using default: $${DEFAULT_MAX_TRADE_AMOUNT}`
        );
      }
    }

    const requireConfirmSetting = runtime.getSetting(
      "POLYMARKET_REQUIRE_CONFIRMATION"
    ) as string;
    if (requireConfirmSetting === "false") {
      this.requireConfirmation = false;
    }

    logger.info(
      `[PolymarketTradingService] Initialized - Max trade: $${this.maxTradeAmount}, Require confirmation: ${this.requireConfirmation}`
    );
  }

  /**
   * Stop the service
   */
  async stop(): Promise<void> {
    this.userStates.clear();
    logger.info("[PolymarketTradingService] Stopped");
  }

  // ============================================================================
  // CDP Client Access
  // ============================================================================

  /**
   * Get CDP client, throwing if not initialized
   */
  private getCdpClient(): CdpClient {
    if (!this.cdpClient) {
      throw new Error(
        "CDP client not initialized. Check environment variables."
      );
    }
    return this.cdpClient;
  }

  /**
   * Get public client for read operations
   */
  private getPublicClient(): ReturnType<typeof createPublicClient> {
    if (!this.publicClient) {
      this.publicClient = createPolygonPublicClient(this.polygonRpcUrl);
    }
    return this.publicClient;
  }

  // ============================================================================
  // User State Management
  // ============================================================================

  /**
   * Get or create user state (CDP account + signer)
   */
  private async getOrCreateUserState(userId: string): Promise<UserState> {
    // Check cache
    const cached = this.userStates.get(userId);
    if (cached) {
      return cached;
    }

    // Create new state
    logger.info(
      `[PolymarketTradingService] Creating user state for: ${userId.substring(0, 20)}...`
    );

    const client = this.getCdpClient();
    const cdpAccount = await client.evm.getOrCreateAccount({ name: userId });

    const signer = new CdpSignerAdapter(cdpAccount);

    const state: UserState = {
      cdpAccount,
      signer,
      lastCredentialsCheck: 0,
    };

    this.userStates.set(userId, state);
    return state;
  }

  // ============================================================================
  // Trading Setup
  // ============================================================================

  /**
   * Setup trading for a user
   *
   * This includes:
   * 1. Get or create CDP wallet
   * 2. Derive L2 API credentials
   * 3. Approve USDC spending on exchanges
   *
   * @param userId - User identifier
   * @returns Setup result with status
   */
  async setupTrading(userId: string): Promise<TradingSetupResult> {
    logger.info(
      `[PolymarketTradingService] Setting up trading for user: ${userId.substring(0, 20)}...`
    );

    const warnings: string[] = [];
    const state = await this.getOrCreateUserState(userId);
    const address = state.cdpAccount.address as Hex;

    // Check balances
    const publicClient = this.getPublicClient();
    const [maticBalance, usdcBalance] = await Promise.all([
      checkMaticBalance(publicClient, address),
      checkUsdcBalance(publicClient, address),
    ]);

    // Warn if low MATIC
    if (parseFloat(maticBalance) < 0.01) {
      warnings.push(
        `Low MATIC balance (${maticBalance}). You may need more for gas fees.`
      );
    }

    // Warn if no USDC
    if (parseFloat(usdcBalance) < 1) {
      warnings.push(
        `Low USDC.e balance (${usdcBalance}). You need USDC.e on Polygon to trade.`
      );
    }

    // Derive API credentials
    let hasApiCredentials = false;
    try {
      const creds = await this.deriveApiCredentials(userId);
      if (creds) {
        state.apiCredentials = creds;
        state.lastCredentialsCheck = Date.now();
        hasApiCredentials = true;
      }
    } catch (error) {
      warnings.push(
        `Failed to derive API credentials: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    // Check USDC allowances (for buying)
    const allowances = await checkAllAllowances(publicClient, address);
    
    // Check CTF token approvals (for selling)
    let ctfApprovals = await checkAllCtfApprovals(publicClient, address);

    // Check if ANY approval is needed
    const needsUsdcApproval = 
      parseFloat(allowances.ctfExchange) < 1_000_000 ||
      parseFloat(allowances.negRiskExchange) < 1_000_000 ||
      parseFloat(allowances.negRiskAdapter) < 1_000_000;
    
    const needsCtfApproval = 
      !ctfApprovals.ctfExchange ||
      !ctfApprovals.negRiskExchange ||
      !ctfApprovals.negRiskAdapter;

    const needsApproval = needsUsdcApproval || needsCtfApproval;

    if (parseFloat(maticBalance) >= 0.01 && needsApproval) {
      try {
        logger.info(`[PolymarketTradingService] Approving contracts - USDC: CTF=${allowances.ctfExchange}, NegRisk=${allowances.negRiskExchange}, NegRiskAdapter=${allowances.negRiskAdapter}`);
        logger.info(`[PolymarketTradingService] Approving CTF tokens - CTF=${ctfApprovals.ctfExchange}, NegRisk=${ctfApprovals.negRiskExchange}, NegRiskAdapter=${ctfApprovals.negRiskAdapter}`);
        
        await approveAllPolymarketContracts(
          state.cdpAccount,
          this.polygonRpcUrl,
          true // skipIfApproved - only approves contracts that need it
        );
        
        // Refresh allowances
        const newAllowances = await checkAllAllowances(publicClient, address);
        Object.assign(allowances, newAllowances);
        
        // Refresh CTF approvals
        ctfApprovals = await checkAllCtfApprovals(publicClient, address);
        
        logger.info(`[PolymarketTradingService] After approval - USDC: CTF=${newAllowances.ctfExchange}, NegRisk=${newAllowances.negRiskExchange}`);
        logger.info(`[PolymarketTradingService] After approval - CTF tokens: CTF=${ctfApprovals.ctfExchange}, NegRisk=${ctfApprovals.negRiskExchange}, NegRiskAdapter=${ctfApprovals.negRiskAdapter}`);
      } catch (error) {
        warnings.push(
          `Failed to approve contracts: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Determine if ready - USDC + CTF approvals required for full trading capability
    const isReady =
      hasApiCredentials &&
      parseFloat(allowances.ctfExchange) > 0 &&
      parseFloat(allowances.negRiskExchange) > 0 &&
      parseFloat(allowances.negRiskAdapter) > 0 &&
      ctfApprovals.ctfExchange &&
      ctfApprovals.negRiskExchange &&
      ctfApprovals.negRiskAdapter &&
      parseFloat(usdcBalance) > 0 &&
      parseFloat(maticBalance) > 0.001;

    const result: TradingSetupResult = {
      walletAddress: address,
      hasApiCredentials,
      ctfExchangeAllowance: allowances.ctfExchange,
      negRiskExchangeAllowance: allowances.negRiskExchange,
      negRiskAdapterAllowance: allowances.negRiskAdapter,
      ctfExchangeTokenApproval: ctfApprovals.ctfExchange,
      negRiskExchangeTokenApproval: ctfApprovals.negRiskExchange,
      negRiskAdapterTokenApproval: ctfApprovals.negRiskAdapter,
      isReady,
      warnings,
    };

    logger.info(
      `[PolymarketTradingService] Setup complete - Ready: ${isReady}, Warnings: ${warnings.length}`
    );

    return result;
  }

  /**
   * Derive L2 API credentials from wallet signature
   */
  private async deriveApiCredentials(
    userId: string
  ): Promise<ApiCredentials | null> {
    logger.info(
      `[PolymarketTradingService] Deriving API credentials for user: ${userId.substring(0, 20)}...`
    );

    const state = await this.getOrCreateUserState(userId);

    // Check cache
    if (
      state.apiCredentials &&
      Date.now() - state.lastCredentialsCheck < API_CREDENTIALS_CACHE_TTL
    ) {
      logger.debug("[PolymarketTradingService] Using cached API credentials");
      return state.apiCredentials;
    }

    try {
      // Create CLOB client with signer
      const clobClient = new ClobClient(
        CLOB_HOST,
        POLYGON_CHAIN_ID,
        state.signer as any
      );

      // Derive or create API credentials
      const creds = await clobClient.createOrDeriveApiKey();

      logger.info("[PolymarketTradingService] API credentials derived");

      const apiKey = (creds as any).apiKey || (creds as any).key;
      return {
        key: apiKey,
        apiKey: apiKey,
        secret: creds.secret,
        passphrase: creds.passphrase,
      };
    } catch (error) {
      logger.error(
        `[PolymarketTradingService] Failed to derive API credentials: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }

  // ============================================================================
  // CLOB Client Management
  // ============================================================================

  /**
   * Get authenticated CLOB client for a user
   */
  async getAuthenticatedClobClient(userId: string): Promise<ClobClient> {
    const state = await this.getOrCreateUserState(userId);

    // Ensure we have API credentials
    if (!state.apiCredentials) {
      const creds = await this.deriveApiCredentials(userId);
      if (!creds) {
        throw new Error("Failed to derive API credentials");
      }
      state.apiCredentials = creds;
    }

    // Create authenticated client
    const client = new ClobClient(
      CLOB_HOST,
      POLYGON_CHAIN_ID,
      state.signer as any,
      state.apiCredentials
    );

    return client;
  }

  // ============================================================================
  // Order Management
  // ============================================================================

  /**
   * Place a market order on Polymarket
   *
   * Uses createAndPostMarketOrder for immediate execution (FOK - Fill or Kill).
   * This ensures orders either fill immediately or fail - no lingering limit orders.
   *
   * IMPORTANT: The API's createAndPostMarketOrder expects different units per side:
   * - BUY: orderAmount = usdcToSpend
   * - SELL: orderAmount = sharesToSell
   *
   * @param userId - User identifier
   * @param params - Order parameters (size = shares, price = price per share)
   * @returns Order result with transaction hash if matched
   */
  async placeOrder(userId: string, params: OrderParams): Promise<OrderResult> {
    const isBuy = params.side === "BUY";
    const usdcToSpend = params.usdcAmount ?? params.size * params.price;
    const sharesToSell = params.size;
    // API expects: USDC for BUY, shares for SELL
    const orderAmount = isBuy ? usdcToSpend : sharesToSell;
    
    logger.info(
      `[PolymarketTradingService] Placing MARKET ${params.side} order for user ${userId.substring(0, 20)}... - ${params.size} shares @ $${params.price} (~$${usdcToSpend.toFixed(2)} USDC)`
    );

    // Basic validation
    if (usdcToSpend < 1) {
      return {
        orderId: "",
        status: "FAILED",
        timestamp: Date.now(),
        error: "Minimum order size is $1 USDC",
      };
    }

    if (usdcToSpend > this.maxTradeAmount) {
      return {
        orderId: "",
        status: "FAILED",
        timestamp: Date.now(),
        error: `Order exceeds maximum trade amount of $${this.maxTradeAmount}`,
      };
    }

    try {
      const client = await this.getAuthenticatedClobClient(userId);

      // Use createAndPostMarketOrder for immediate execution
      // This uses FOK (Fill or Kill) by default - order either fills entirely or fails
      const response = await client.createAndPostMarketOrder({
        tokenID: params.tokenId,
        amount: orderAmount,
        side: isBuy ? Side.BUY : Side.SELL,
        feeRateBps: params.feeRateBps ?? 0,
      });

      // Log full response for debugging
      logger.info(
        `[PolymarketTradingService] CLOB Response: ${JSON.stringify(response)}`
      );

      // Extract response fields
      const orderId = (response as any).orderID || (response as any).order_id || (response as any).id || "";
      const success = (response as any).success;
      const errorMsg = (response as any).error || (response as any).errorMsg || (response as any).error_msg || (response as any).message;
      const responseStatus = (response as any).status;
      const transactionHashes = (response as any).transactionsHashes || (response as any).transactionHashes || [];
      const takingAmount = (response as any).takingAmount;
      const makingAmount = (response as any).makingAmount;
      
      // Check for explicit failure
      if (success === false || (responseStatus && typeof responseStatus === 'number' && responseStatus >= 400) || (errorMsg && !orderId)) {
        logger.error(
          `[PolymarketTradingService] Order rejected by CLOB: ${errorMsg || `Status ${responseStatus}`}`
        );
        return {
          orderId: "",
          status: "FAILED",
          timestamp: Date.now(),
          error: errorMsg || `Order rejected by CLOB (status: ${responseStatus || "unknown"})`,
        };
      }
      
      // Check if order was matched (executed on-chain)
      if (responseStatus === "matched" && transactionHashes.length > 0) {
        logger.info(
          `[PolymarketTradingService] Order MATCHED! TX: ${transactionHashes[0]}, Shares: ${takingAmount}, Cost: $${makingAmount}`
        );
        
        // Calculate executed price safely - ensure both amounts are valid non-zero numbers
        let executedPrice: string | undefined;
        if (makingAmount && takingAmount) {
          const making = parseFloat(makingAmount);
          const taking = parseFloat(takingAmount);
          if (!isNaN(making) && !isNaN(taking) && taking !== 0) {
            executedPrice = (making / taking).toFixed(4);
          }
        }
        
        return {
          orderId,
          status: "FILLED",
          transactionHash: transactionHashes[0],
          executedSize: takingAmount,
          executedPrice,
          timestamp: Date.now(),
        };
      }
      
      // Verify we got an order ID
      if (!orderId) {
        logger.error(
          `[PolymarketTradingService] Order failed - no order ID in response: ${JSON.stringify(response)}`
        );
        return {
          orderId: "",
          status: "FAILED",
          timestamp: Date.now(),
          error: "No order ID returned from CLOB - order may not have been placed",
        };
      }

      // Order is live (shouldn't happen with market orders, but handle gracefully)
      logger.warn(
        `[PolymarketTradingService] Order is live (not matched): ${orderId}`
      );

      return {
        orderId,
        status: "PLACED",
        timestamp: Date.now(),
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[PolymarketTradingService] Order failed: ${errorMsg}`);

      return {
        orderId: "",
        status: "FAILED",
        timestamp: Date.now(),
        error: errorMsg,
      };
    }
  }

  /**
   * Place a LIMIT order on Polymarket (GTC - Good Till Cancelled)
   *
   * Unlike market orders, limit orders sit in the order book until matched.
   * Uses createAndPostOrder with OrderType.GTC for true limit order behavior.
   *
   * @param userId - User identifier
   * @param params - Limit order parameters
   * @returns Order result with order ID if placed successfully
   */
  async placeLimitOrder(userId: string, params: LimitOrderParams): Promise<OrderResult> {
    const usdcValue = params.size * params.price;
    
    logger.info(
      `[PolymarketTradingService] Placing LIMIT ${params.side} order for user ${userId.substring(0, 20)}... - ${params.size} shares @ $${params.price} (~$${usdcValue.toFixed(2)} USDC)`
    );

    // Basic validation
    if (usdcValue < 1) {
      return {
        orderId: "",
        status: "FAILED",
        timestamp: Date.now(),
        error: "Minimum order size is $1 USDC",
      };
    }

    if (usdcValue > this.maxTradeAmount) {
      return {
        orderId: "",
        status: "FAILED",
        timestamp: Date.now(),
        error: `Order exceeds maximum trade amount of $${this.maxTradeAmount}`,
      };
    }

    try {
      const client = await this.getAuthenticatedClobClient(userId);

      // Use createAndPostOrder for limit orders (GTC - Good Till Cancelled)
      // This places the order on the book to wait for a match
      // If tickSize not provided, fetch it from the CLOB API
      const tickSize = params.tickSize || await client.getTickSize(params.tokenId);
      const negRisk = params.negRisk ?? await client.getNegRisk(params.tokenId);
      
      const response = await client.createAndPostOrder(
        {
          tokenID: params.tokenId,
          price: params.price,
          side: params.side === "BUY" ? Side.BUY : Side.SELL,
          size: params.size,
          feeRateBps: params.feeRateBps ?? 0,
        },
        { 
          tickSize, 
          negRisk 
        },
        OrderType.GTC
      );

      // Log full response for debugging
      logger.info(
        `[PolymarketTradingService] CLOB LIMIT order response: ${JSON.stringify(response)}`
      );

      // Extract response fields
      const orderId = (response as any).orderID || (response as any).order_id || (response as any).id || "";
      const success = (response as any).success;
      const errorMsg = (response as any).error || (response as any).errorMsg || (response as any).error_msg || (response as any).message;
      const responseStatus = (response as any).status;
      const transactionHashes = (response as any).transactionsHashes || (response as any).transactionHashes || [];
      
      // Check for explicit failure
      if (success === false || (responseStatus && typeof responseStatus === 'number' && responseStatus >= 400) || (errorMsg && !orderId)) {
        logger.error(
          `[PolymarketTradingService] Limit order rejected by CLOB: ${errorMsg || `Status ${responseStatus}`}`
        );
        return {
          orderId: "",
          status: "FAILED",
          timestamp: Date.now(),
          error: errorMsg || `Order rejected by CLOB (status: ${responseStatus || "unknown"})`,
        };
      }
      
      // Check if order was immediately matched (rare for limit orders but possible)
      if (responseStatus === "matched" && transactionHashes.length > 0) {
        logger.info(
          `[PolymarketTradingService] Limit order IMMEDIATELY MATCHED! TX: ${transactionHashes[0]}`
        );
        return {
          orderId,
          status: "FILLED",
          transactionHash: transactionHashes[0],
          timestamp: Date.now(),
        };
      }
      
      // Verify we got an order ID
      if (!orderId) {
        logger.error(
          `[PolymarketTradingService] Limit order failed - no order ID in response: ${JSON.stringify(response)}`
        );
        return {
          orderId: "",
          status: "FAILED",
          timestamp: Date.now(),
          error: "No order ID returned from CLOB - order may not have been placed",
        };
      }

      // Order is live in the orderbook (expected for limit orders)
      logger.info(
        `[PolymarketTradingService] Limit order PLACED in orderbook: ${orderId}`
      );

      return {
        orderId,
        status: "PLACED",
        timestamp: Date.now(),
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[PolymarketTradingService] Limit order failed: ${errorMsg}`);

      return {
        orderId: "",
        status: "FAILED",
        timestamp: Date.now(),
        error: errorMsg,
      };
    }
  }

  /**
   * Look up the outcome for a token ID from the Gamma API
   *
   * Queries Polymarket's Gamma API to find the market containing the given token ID
   * and returns the corresponding outcome (e.g., "Yes", "No", or alternative outcomes
   * like team names for sports markets).
   *
   * @param tokenId - The ERC1155 token ID to look up
   * @returns The outcome string (e.g., "Yes", "No", "Team A"), or null if not found
   */
  async getTokenOutcome(tokenId: string): Promise<string | null> {
    try {
      // Query Gamma API for markets containing this token
      // The API supports clob_token_ids query parameter
      const url = `${GAMMA_HOST}/markets?clob_token_ids=${tokenId}`;
      logger.debug(`[PolymarketTradingService] Looking up token outcome: ${url}`);

      const response = await fetch(url, {
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        logger.warn(
          `[PolymarketTradingService] Gamma API returned ${response.status} for token lookup`
        );
        return null;
      }

      const markets = (await response.json()) as any[];

      if (!markets || markets.length === 0) {
        logger.warn(
          `[PolymarketTradingService] No market found for token: ${tokenId.substring(0, 20)}...`
        );
        return null;
      }

      const market = markets[0];

      // Parse clobTokenIds and outcomes from the market data
      let tokenIds: string[] = [];
      let outcomes: string[] = [];

      try {
        tokenIds =
          typeof market.clobTokenIds === "string"
            ? JSON.parse(market.clobTokenIds)
            : market.clobTokenIds || [];
        outcomes =
          typeof market.outcomes === "string"
            ? JSON.parse(market.outcomes)
            : market.outcomes || [];
      } catch {
        logger.warn(
          `[PolymarketTradingService] Failed to parse token/outcome data for market`
        );
        return null;
      }

      // Find the index of our token and return the corresponding outcome
      const tokenIndex = tokenIds.findIndex((id: string) => id === tokenId);

      if (tokenIndex >= 0 && tokenIndex < outcomes.length) {
        const outcome = outcomes[tokenIndex];
        logger.debug(
          `[PolymarketTradingService] Token ${tokenId.substring(0, 20)}... maps to outcome: ${outcome}`
        );
        return outcome;
      }

      logger.warn(
        `[PolymarketTradingService] Token ${tokenId.substring(0, 20)}... not found in market token list`
      );
      return null;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(
        `[PolymarketTradingService] Error looking up token outcome: ${errorMsg}`
      );
      return null;
    }
  }

  /**
   * Get open orders for a user
   *
   * Fetches all open orders and enriches them with correct outcome information
   * by looking up token metadata from the Gamma API.
   */
  async getOpenOrders(userId: string): Promise<OpenOrder[]> {
    logger.info(
      `[PolymarketTradingService] Getting open orders for user: ${userId.substring(0, 20)}...`
    );

    try {
      const client = await this.getAuthenticatedClobClient(userId);
      const orders = await client.getOpenOrders();

      // Look up outcomes for all unique token IDs in parallel
      const uniqueTokenIds = Array.from(new Set(orders.map((o: any) => o.asset_id))) as string[];
      const outcomeMap = new Map<string, string>();

      await Promise.all(
        uniqueTokenIds.map(async (tokenId: string) => {
          const outcome = await this.getTokenOutcome(tokenId);
          if (outcome) {
            outcomeMap.set(tokenId, outcome);
          }
        })
      );

      return orders.map((order: any) => {
        // Get the correct outcome from token metadata
        // asset_id in CLOB response is the token ID, not condition ID
        const tokenId = order.asset_id;
        const outcome = outcomeMap.get(tokenId);

        // Normalize outcome to uppercase YES/NO for standard markets
        // For alternative outcomes (e.g., team names), keep as-is
        let normalizedOutcome: string = outcome || "UNKNOWN";
        const lowerOutcome = outcome?.toLowerCase();
        if (lowerOutcome === "yes") {
          normalizedOutcome = "YES";
        } else if (lowerOutcome === "no") {
          normalizedOutcome = "NO";
        }

        return {
          orderId: order.id || order.order_id,
          conditionId: order.market || order.condition_id || tokenId, // Use market/condition_id if available
          tokenId: tokenId,
          outcome: normalizedOutcome,
          side: order.side as "BUY" | "SELL",
          price: order.price,
          originalSize: order.original_size || order.size,
          remainingSize: order.size_matched
            ? String(
                parseFloat(order.original_size || order.size) -
                  parseFloat(order.size_matched)
              )
            : order.size,
          createdAt: order.timestamp || Date.now(),
        };
      });
    } catch (error) {
      logger.error(
        `[PolymarketTradingService] Failed to get open orders: ${error instanceof Error ? error.message : String(error)}`
      );
      return [];
    }
  }

  /**
   * Cancel an order
   */
  async cancelOrder(
    userId: string,
    orderId: string
  ): Promise<CancelOrderResult> {
    logger.info(
      `[PolymarketTradingService] Cancelling order ${orderId} for user: ${userId.substring(0, 20)}...`
    );

    try {
      const client = await this.getAuthenticatedClobClient(userId);
      await client.cancelOrder({ orderID: orderId });

      return {
        orderId,
        success: true,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(
        `[PolymarketTradingService] Cancel order failed: ${errorMsg}`
      );

      return {
        orderId,
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * Cancel all open orders for a user
   */
  async cancelAllOrders(userId: string): Promise<CancelOrderResult[]> {
    logger.info(
      `[PolymarketTradingService] Cancelling all orders for user: ${userId.substring(0, 20)}...`
    );

    const openOrders = await this.getOpenOrders(userId);
    const results: CancelOrderResult[] = [];

    for (const order of openOrders) {
      const result = await this.cancelOrder(userId, order.orderId);
      results.push(result);
    }

    return results;
  }

  // ============================================================================
  // Price Queries
  // ============================================================================

  /**
   * Get current price for a token from the CLOB
   * @param tokenId - The token ID to get price for
   * @param side - 'buy' or 'sell'
   * @returns Price as a number, or null if not available
   */
  async getCurrentPrice(tokenId: string, side: "buy" | "sell" = "buy"): Promise<number | null> {
    try {
      // Use unauthenticated fetch since price is public
      const response = await fetch(
        `${CLOB_HOST}/price?token_id=${tokenId}&side=${side}`
      );

      if (!response.ok) {
        logger.warn(
          `[PolymarketTradingService] Price fetch failed: ${response.status}`
        );
        return null;
      }

      const data = await response.json() as { price?: string };
      const price = parseFloat(data.price || "");

      if (isNaN(price)) {
        logger.warn(
          `[PolymarketTradingService] Invalid price data: ${JSON.stringify(data)}`
        );
        return null;
      }

      logger.info(
        `[PolymarketTradingService] Current ${side} price for token: $${price.toFixed(4)}`
      );
      return price;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(
        `[PolymarketTradingService] Error fetching price: ${errorMsg}`
      );
      return null;
    }
  }

  // ============================================================================
  // Balance & Allowance Queries
  // ============================================================================

  /**
   * Get USDC balance for a user
   */
  async getUsdcBalance(userId: string): Promise<UsdcBalance> {
    const state = await this.getOrCreateUserState(userId);
    const address = state.cdpAccount.address as Hex;
    const publicClient = this.getPublicClient();

    const balance = await checkUsdcBalance(publicClient, address);

    // TODO: Calculate locked amount from open orders
    return {
      available: balance,
      locked: "0",
      total: balance,
    };
  }

  /**
   * Get allowance status for a user
   */
  async getAllowanceStatus(userId: string): Promise<AllowanceStatus> {
    const state = await this.getOrCreateUserState(userId);
    const address = state.cdpAccount.address as Hex;
    const publicClient = this.getPublicClient();

    return checkAllAllowances(publicClient, address);
  }

  /**
   * Approve USDC spending on Polymarket contracts
   */
  async approveUsdc(
    userId: string
  ): Promise<{ ctfExchange: string | null; negRiskExchange: string | null }> {
    logger.info(
      `[PolymarketTradingService] Approving USDC for user: ${userId.substring(0, 20)}...`
    );

    const state = await this.getOrCreateUserState(userId);

    const results = await approveAllPolymarketContracts(
      state.cdpAccount,
      this.polygonRpcUrl,
      false // Force re-approval
    );

    return {
      ctfExchange: results.ctfExchange || null,
      negRiskExchange: results.negRiskExchange || null,
    };
  }

  // ============================================================================
  // Wallet Information
  // ============================================================================

  /**
   * Get wallet address for a user
   */
  async getWalletAddress(userId: string): Promise<string> {
    const state = await this.getOrCreateUserState(userId);
    return state.cdpAccount.address;
  }

  /**
   * Check if trading is set up for a user
   * 
   * Validates all required approvals for full trading capability:
   * - USDC allowances for all 3 exchange contracts (BUY orders)
   * - CTF token operator approvals for all 3 contracts (SELL orders)
   */
  async isSetupComplete(userId: string): Promise<boolean> {
    const state = this.userStates.get(userId);
    if (!state || !state.apiCredentials) {
      return false;
    }

    const address = state.cdpAccount.address as Hex;
    const publicClient = this.getPublicClient();
    
    // Check all USDC allowances (required for BUY orders)
    const allowances = await checkAllAllowances(publicClient, address);
    const hasUsdcAllowances = 
      parseFloat(allowances.ctfExchange) > 0 &&
      parseFloat(allowances.negRiskExchange) > 0 &&
      parseFloat(allowances.negRiskAdapter) > 0;
    
    if (!hasUsdcAllowances) {
      return false;
    }
    
    // Check all CTF token approvals (required for SELL orders)
    const ctfApprovals = await checkAllCtfApprovals(publicClient, address);
    const hasCtfApprovals = 
      ctfApprovals.ctfExchange &&
      ctfApprovals.negRiskExchange &&
      ctfApprovals.negRiskAdapter;

    return hasCtfApprovals;
  }

  // ============================================================================
  // Redemption
  // ============================================================================

  /**
   * Redeem winnings from a resolved market position
   *
   * Calls the Gnosis Conditional Tokens contract's redeemPositions function.
   * This burns the winning outcome tokens and returns USDC collateral.
   *
   * @param userId - User identifier
   * @param conditionId - The condition ID of the resolved market
   * @param indexSets - Array of index sets to redeem (default: [1, 2] for both outcomes)
   * @returns Redemption result with transaction hash
   */
  async redeemPosition(
    userId: string,
    conditionId: string,
    indexSets: number[] = [1, 2]
  ): Promise<import("../types").RedemptionResult> {
    logger.info(
      `[PolymarketTradingService] Redeeming position for condition: ${conditionId.substring(0, 20)}...`
    );

    try {
      const state = await this.getOrCreateUserState(userId);
      const address = state.cdpAccount.address as Hex;

      // Import the ABI dynamically to avoid circular imports
      const { CONDITIONAL_TOKENS_ABI } = await import("../constants");

      // Create wallet client for transaction
      const { createWalletClient, http } = await import("viem");
      const { polygon } = await import("viem/chains");
      const { toAccount } = await import("viem/accounts");

      const walletClient = createWalletClient({
        account: toAccount(state.cdpAccount),
        chain: polygon,
        transport: http(this.polygonRpcUrl),
      });

      const publicClient = this.getPublicClient();

      // Prepare the parent collection ID (null for root positions)
      const parentCollectionId =
        "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;

      // Convert indexSets to bigints
      const indexSetsBigInt = indexSets.map((i) => BigInt(i));

      logger.info(
        `[PolymarketTradingService] Calling redeemPositions on CTF contract...`
      );

      // Call redeemPositions on the Conditional Tokens contract
      const hash = await walletClient.writeContract({
        address: CONTRACTS.CONDITIONAL_TOKENS,
        abi: CONDITIONAL_TOKENS_ABI,
        functionName: "redeemPositions",
        args: [
          CONTRACTS.USDC_BRIDGED, // collateralToken
          parentCollectionId, // parentCollectionId (null for root)
          conditionId as Hex, // conditionId
          indexSetsBigInt, // indexSets
        ],
        chain: polygon,
      });

      logger.info(
        `[PolymarketTradingService] Redemption TX submitted: ${hash}`
      );

      // Wait for confirmation
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status === "success") {
        logger.info(
          `[PolymarketTradingService] Redemption successful! TX: ${hash}`
        );

        return {
          conditionId,
          amount: "0", // TODO: Parse from receipt logs
          transactionHash: hash,
          success: true,
        };
      } else {
        logger.error(
          `[PolymarketTradingService] Redemption TX failed: ${hash}`
        );

        return {
          conditionId,
          amount: "0",
          transactionHash: hash,
          success: false,
          error: "Transaction reverted",
        };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(
        `[PolymarketTradingService] Redemption failed: ${errorMsg}`
      );

      return {
        conditionId,
        amount: "0",
        transactionHash: "",
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * Redeem all redeemable positions for a user
   *
   * Fetches positions from the Data API, filters for redeemable ones,
   * and redeems each one.
   *
   * @param userId - User identifier
   * @returns Array of redemption results
   */
  async redeemAllPositions(
    userId: string
  ): Promise<import("../types").RedemptionResult[]> {
    logger.info(
      `[PolymarketTradingService] Redeeming all positions for user: ${userId.substring(0, 20)}...`
    );

    const results: import("../types").RedemptionResult[] = [];

    try {
      const walletAddress = await this.getWalletAddress(userId);

      // Fetch positions from Data API
      const response = await fetch(
        `https://data-api.polymarket.com/positions?user=${walletAddress}`
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch positions: ${response.status}`);
      }

      const positions = (await response.json()) as Array<{
        conditionId: string;
        redeemable: boolean;
        title: string;
        size: number;
        negativeRisk: boolean;
      }>;

      // Filter for redeemable positions
      const redeemablePositions = positions.filter((p) => p.redeemable);

      if (redeemablePositions.length === 0) {
        logger.info(
          `[PolymarketTradingService] No redeemable positions found`
        );
        return [];
      }

      logger.info(
        `[PolymarketTradingService] Found ${redeemablePositions.length} redeemable positions`
      );

      // Redeem each position
      // Group by conditionId to avoid duplicate redemptions
      const uniqueConditions = new Map<
        string,
        { title: string; negativeRisk: boolean }
      >();
      for (const pos of redeemablePositions) {
        if (!uniqueConditions.has(pos.conditionId)) {
          uniqueConditions.set(pos.conditionId, {
            title: pos.title,
            negativeRisk: pos.negativeRisk,
          });
        }
      }

      for (const [conditionId, info] of uniqueConditions) {
        logger.info(
          `[PolymarketTradingService] Redeeming: ${info.title.substring(0, 40)}...`
        );

        // For binary markets, redeem both outcomes [1, 2]
        // The contract will only pay out for the winning outcome
        const result = await this.redeemPosition(userId, conditionId, [1, 2]);
        results.push(result);

        // Small delay between redemptions to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      return results;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(
        `[PolymarketTradingService] Redeem all failed: ${errorMsg}`
      );

      return results;
    }
  }

  // ============================================================================
  // Configuration Accessors
  // ============================================================================

  /**
   * Get current configuration
   */
  getConfig(): TradingServiceConfig {
    return {
      polygonRpcUrl: this.polygonRpcUrl,
      clobHost: CLOB_HOST,
      maxTradeAmount: this.maxTradeAmount,
      requireConfirmation: this.requireConfirmation,
    };
  }

  /**
   * Check if confirmation is required
   */
  isConfirmationRequired(): boolean {
    return this.requireConfirmation;
  }
}

export default PolymarketTradingService;
