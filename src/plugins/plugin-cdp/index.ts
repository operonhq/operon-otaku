import type { Plugin } from "@elizaos/core";

// Services
import { CdpService } from "./services/cdp.service";

// Actions - read-only / informational only
import { cdpWalletInfo } from "./actions/cdp-wallet-info";
import { cdpWalletCheckBalance } from "./actions/cdp-wallet-check-balance";
import { cdpResolveEns } from "./actions/cdp-resolve-ens";
import { cdpTxExplorerLink } from "./actions/cdp-tx-explorer-link";
import { cdpCheckTxConfirmation } from "./actions/cdp-check-tx-confirmation";

// Providers
import { walletStateProvider } from "./providers/walletState";

// Types
export type { CdpNetwork } from "./types";

// Context Matching - re-export for external use
export { shouldCdpPluginBeInContext, cdpKeywordPatterns } from "./matcher";

/**
 * CDP Plugin (Research mode)
 *
 * Read-only Coinbase Developer Platform integration for:
 * - Wallet balance checking and asset viewing
 * - ENS resolution
 * - Transaction explorer links and confirmation checking
 *
 * Execution actions (transfers, swaps, NFT transfers) are disabled.
 * This agent is a research/analysis publisher, not an execution agent.
 */
export const cdpPlugin: Plugin = {
  name: "cdp",
  description:
    "Coinbase Developer Platform plugin providing wallet balance checking, ENS resolution, and transaction verification (read-only mode)",
  evaluators: [],
  providers: [walletStateProvider],
  actions: [
    cdpWalletInfo,
    cdpWalletCheckBalance,
    cdpResolveEns,
    cdpTxExplorerLink,
    cdpCheckTxConfirmation,
  ],
  services: [CdpService],
};

export default cdpPlugin;
