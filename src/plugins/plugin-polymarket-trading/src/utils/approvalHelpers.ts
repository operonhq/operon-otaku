/**
 * Approval Helpers
 *
 * Utilities for checking and managing USDC approvals
 * on Polymarket exchange contracts.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  formatUnits,
  parseUnits,
  type Hex,
} from "viem";
import { polygon } from "viem/chains";
import { toAccount } from "viem/accounts";
import type { EvmServerAccount } from "@coinbase/cdp-sdk";
import type { AllowanceStatus } from "../types";
import {
  CONTRACTS,
  ERC20_ABI,
  USDC_DECIMALS,
  MAX_APPROVAL,
} from "../constants";

// ERC1155 ABI for CTF token approvals (needed for selling)
const ERC1155_ABI = [
  {
    name: "isApprovedForAll",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "operator", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "setApprovalForAll",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
  },
] as const;

/**
 * Create a public client for Polygon
 *
 * @param rpcUrl - Polygon RPC URL
 * @returns Viem public client
 */
export function createPolygonPublicClient(rpcUrl: string) {
  return createPublicClient({
    chain: polygon,
    transport: http(rpcUrl),
  });
}

/**
 * Create a wallet client for Polygon using CDP account
 *
 * @param cdpAccount - CDP server account
 * @param rpcUrl - Polygon RPC URL
 * @returns Viem wallet client
 */
export function createPolygonWalletClient(
  cdpAccount: EvmServerAccount,
  rpcUrl: string
) {
  return createWalletClient({
    account: toAccount(cdpAccount),
    chain: polygon,
    transport: http(rpcUrl),
  });
}

/**
 * Check USDC allowance for a spender
 *
 * @param publicClient - Viem public client
 * @param owner - Token owner address
 * @param spender - Spender address
 * @returns Allowance amount as string
 */
export async function checkAllowance(
  publicClient: ReturnType<typeof createPublicClient>,
  owner: Hex,
  spender: Hex
): Promise<string> {
  const allowance = await publicClient.readContract({
    address: CONTRACTS.USDC_BRIDGED,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [owner, spender],
  });

  return formatUnits(allowance, USDC_DECIMALS);
}

/**
 * Check USDC allowances for all Polymarket contracts
 *
 * @param publicClient - Viem public client
 * @param owner - Token owner address
 * @returns Allowance status for all exchanges
 */
export async function checkAllAllowances(
  publicClient: ReturnType<typeof createPublicClient>,
  owner: Hex
): Promise<AllowanceStatus> {
  const [ctfAllowance, negRiskAllowance, negRiskAdapterAllowance] = await Promise.all([
    checkAllowance(publicClient, owner, CONTRACTS.CTF_EXCHANGE),
    checkAllowance(publicClient, owner, CONTRACTS.NEG_RISK_CTF_EXCHANGE),
    checkAllowance(publicClient, owner, CONTRACTS.NEG_RISK_ADAPTER),
  ]);

  // Consider "unlimited" if allowance is greater than 1 trillion USDC
  const isUnlimited =
    parseFloat(ctfAllowance) > 1_000_000_000_000 &&
    parseFloat(negRiskAllowance) > 1_000_000_000_000 &&
    parseFloat(negRiskAdapterAllowance) > 1_000_000_000_000;

  return {
    ctfExchange: ctfAllowance,
    negRiskExchange: negRiskAllowance,
    negRiskAdapter: negRiskAdapterAllowance,
    isUnlimited,
  };
}

/**
 * Approve USDC spending for a spender
 *
 * @param walletClient - Viem wallet client
 * @param publicClient - Viem public client
 * @param spender - Spender address to approve
 * @param amount - Amount to approve (defaults to unlimited)
 * @returns Transaction hash
 */
export async function approveUsdc(
  walletClient: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
  spender: Hex,
  amount: bigint = BigInt(MAX_APPROVAL)
): Promise<Hex> {
  // @ts-expect-error - Account is attached to wallet client but types don't fully infer
  const hash = await walletClient.writeContract({
    address: CONTRACTS.USDC_BRIDGED,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [spender, amount],
    chain: polygon,
  });

  // Wait for transaction confirmation
  await publicClient.waitForTransactionReceipt({ hash });

  return hash;
}

/**
 * Check if an operator is approved for all CTF tokens
 */
export async function checkCtfApproval(
  publicClient: ReturnType<typeof createPublicClient>,
  owner: Hex,
  operator: Hex
): Promise<boolean> {
  return await publicClient.readContract({
    address: CONTRACTS.CONDITIONAL_TOKENS,
    abi: ERC1155_ABI,
    functionName: "isApprovedForAll",
    args: [owner, operator],
  });
}

/**
 * Check all CTF token operator approvals
 */
export async function checkAllCtfApprovals(
  publicClient: ReturnType<typeof createPublicClient>,
  owner: Hex
): Promise<{
  ctfExchange: boolean;
  negRiskExchange: boolean;
  negRiskAdapter: boolean;
}> {
  const [ctf, negRisk, negRiskAdapter] = await Promise.all([
    checkCtfApproval(publicClient, owner, CONTRACTS.CTF_EXCHANGE),
    checkCtfApproval(publicClient, owner, CONTRACTS.NEG_RISK_CTF_EXCHANGE),
    checkCtfApproval(publicClient, owner, CONTRACTS.NEG_RISK_ADAPTER),
  ]);

  return {
    ctfExchange: ctf,
    negRiskExchange: negRisk,
    negRiskAdapter: negRiskAdapter,
  };
}

/**
 * Approve an operator for all CTF tokens (ERC1155 setApprovalForAll)
 * Required for SELLING shares on Polymarket
 */
export async function approveCtfOperator(
  walletClient: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
  operator: Hex
): Promise<Hex> {
  // @ts-expect-error - Account is attached to wallet client but types don't fully infer
  const hash = await walletClient.writeContract({
    address: CONTRACTS.CONDITIONAL_TOKENS,
    abi: ERC1155_ABI,
    functionName: "setApprovalForAll",
    args: [operator, true],
    chain: polygon,
  });

  // Wait for transaction confirmation
  await publicClient.waitForTransactionReceipt({ hash });

  return hash;
}

/**
 * Approve USDC AND CTF tokens for all Polymarket exchange contracts
 * 
 * USDC approval is needed for BUYING shares.
 * CTF approval is needed for SELLING shares.
 *
 * @param cdpAccount - CDP server account
 * @param rpcUrl - Polygon RPC URL
 * @param skipIfApproved - Skip approval if already approved
 * @returns Object with transaction hashes for each approval
 */
export async function approveAllPolymarketContracts(
  cdpAccount: EvmServerAccount,
  rpcUrl: string,
  skipIfApproved: boolean = true
): Promise<{
  ctfExchange: Hex | null;
  negRiskExchange: Hex | null;
  negRiskAdapter: Hex | null;
  ctfTokenApprovals?: {
    ctfExchange: Hex | null;
    negRiskExchange: Hex | null;
    negRiskAdapter: Hex | null;
  };
}> {
  const publicClient = createPolygonPublicClient(rpcUrl);
  const walletClient = createPolygonWalletClient(cdpAccount, rpcUrl);
  const owner = cdpAccount.address as Hex;

  const results: { 
    ctfExchange: Hex | null; 
    negRiskExchange: Hex | null; 
    negRiskAdapter: Hex | null;
    ctfTokenApprovals: {
      ctfExchange: Hex | null;
      negRiskExchange: Hex | null;
      negRiskAdapter: Hex | null;
    };
  } = {
    ctfExchange: null,
    negRiskExchange: null,
    negRiskAdapter: null,
    ctfTokenApprovals: {
      ctfExchange: null,
      negRiskExchange: null,
      negRiskAdapter: null,
    },
  };

  // Check existing USDC allowances
  const allowances = await checkAllAllowances(publicClient, owner);
  
  // Check existing CTF token approvals (for selling)
  const ctfApprovals = await checkAllCtfApprovals(publicClient, owner);

  // ========== USDC APPROVALS (for buying) ==========
  
  // Approve CTF Exchange if needed
  if (!skipIfApproved || parseFloat(allowances.ctfExchange) < 1_000_000) {
    results.ctfExchange = await approveUsdc(
      walletClient,
      publicClient,
      CONTRACTS.CTF_EXCHANGE
    );
  }

  // Approve Neg Risk Exchange if needed
  if (!skipIfApproved || parseFloat(allowances.negRiskExchange) < 1_000_000) {
    results.negRiskExchange = await approveUsdc(
      walletClient,
      publicClient,
      CONTRACTS.NEG_RISK_CTF_EXCHANGE
    );
  }

  // Approve Neg Risk Adapter if needed (required for neg risk markets like Fed rate decisions)
  if (!skipIfApproved || parseFloat(allowances.negRiskAdapter) < 1_000_000) {
    results.negRiskAdapter = await approveUsdc(
      walletClient,
      publicClient,
      CONTRACTS.NEG_RISK_ADAPTER
    );
  }

  // ========== CTF TOKEN APPROVALS (for selling) ==========
  
  // Approve CTF Exchange to transfer tokens
  if (!skipIfApproved || !ctfApprovals.ctfExchange) {
    results.ctfTokenApprovals.ctfExchange = await approveCtfOperator(
      walletClient,
      publicClient,
      CONTRACTS.CTF_EXCHANGE
    );
  }

  // Approve Neg Risk Exchange to transfer tokens
  if (!skipIfApproved || !ctfApprovals.negRiskExchange) {
    results.ctfTokenApprovals.negRiskExchange = await approveCtfOperator(
      walletClient,
      publicClient,
      CONTRACTS.NEG_RISK_CTF_EXCHANGE
    );
  }

  // Approve Neg Risk Adapter to transfer tokens
  if (!skipIfApproved || !ctfApprovals.negRiskAdapter) {
    results.ctfTokenApprovals.negRiskAdapter = await approveCtfOperator(
      walletClient,
      publicClient,
      CONTRACTS.NEG_RISK_ADAPTER
    );
  }

  return results;
}

/**
 * Check USDC balance
 *
 * @param publicClient - Viem public client
 * @param address - Wallet address
 * @returns USDC balance as string
 */
export async function checkUsdcBalance(
  publicClient: ReturnType<typeof createPublicClient>,
  address: Hex
): Promise<string> {
  const balance = await publicClient.readContract({
    address: CONTRACTS.USDC_BRIDGED,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [address],
  });

  return formatUnits(balance, USDC_DECIMALS);
}

/**
 * Check MATIC balance for gas
 *
 * @param publicClient - Viem public client
 * @param address - Wallet address
 * @returns MATIC balance as string
 */
export async function checkMaticBalance(
  publicClient: ReturnType<typeof createPublicClient>,
  address: Hex
): Promise<string> {
  const balance = await publicClient.getBalance({ address });
  return formatUnits(balance, 18);
}

/**
 * Verify wallet has sufficient balance for a trade
 *
 * @param publicClient - Viem public client
 * @param address - Wallet address
 * @param requiredUsdc - Required USDC amount
 * @param requiredMatic - Required MATIC for gas (default: 0.01)
 * @returns Object with balance check results
 */
export async function verifyBalances(
  publicClient: ReturnType<typeof createPublicClient>,
  address: Hex,
  requiredUsdc: number,
  requiredMatic: number = 0.01
): Promise<{
  hasUsdc: boolean;
  hasMatic: boolean;
  usdcBalance: string;
  maticBalance: string;
  shortfall: { usdc: number; matic: number };
}> {
  const [usdcBalance, maticBalance] = await Promise.all([
    checkUsdcBalance(publicClient, address),
    checkMaticBalance(publicClient, address),
  ]);

  const usdcNum = parseFloat(usdcBalance);
  const maticNum = parseFloat(maticBalance);

  return {
    hasUsdc: usdcNum >= requiredUsdc,
    hasMatic: maticNum >= requiredMatic,
    usdcBalance,
    maticBalance,
    shortfall: {
      usdc: Math.max(0, requiredUsdc - usdcNum),
      matic: Math.max(0, requiredMatic - maticNum),
    },
  };
}
