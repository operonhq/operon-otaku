/**
 * CDP Signer Adapter
 *
 * Bridges Coinbase Developer Platform (CDP) server accounts to
 * the ethers.js v5 Signer interface expected by @polymarket/clob-client.
 *
 * The CLOB client uses `signer._signTypedData(domain, types, value)` for
 * EIP-712 signing, while CDP accounts use viem's `signTypedData({ domain, types, primaryType, message })`.
 * This adapter translates between the two interfaces.
 */

import type { EvmServerAccount } from "@coinbase/cdp-sdk";
import type {
  TypedDataDomain,
  TypedDataField,
  ICdpSignerAdapter,
} from "../types";
import { POLYGON_CHAIN_ID } from "../constants";

/**
 * Adapter that bridges CDP EvmServerAccount to ethers.js v5 Signer interface.
 *
 * Polymarket CLOB client expects ethers v5 `_signTypedData()` method.
 * This adapter wraps CDP's viem-compatible `signTypedData()` method.
 *
 * @example
 * ```typescript
 * const cdpAccount = await cdpClient.evm.getOrCreateAccount({ name: userId });
 * const signer = new CdpSignerAdapter(cdpAccount);
 *
 * // Now use with CLOB client
 * const clobClient = new ClobClient(CLOB_HOST, POLYGON_CHAIN_ID, signer);
 * ```
 */
export class CdpSignerAdapter implements ICdpSignerAdapter {
  private cdpAccount: EvmServerAccount;
  public readonly address: string;

  constructor(cdpAccount: EvmServerAccount) {
    this.cdpAccount = cdpAccount;
    this.address = cdpAccount.address;
  }

  /**
   * Get wallet address (async version for ethers compatibility)
   */
  async getAddress(): Promise<string> {
    return this.address;
  }

  /**
   * Bridge ethers v5 _signTypedData to CDP signTypedData
   *
   * ethers v5: _signTypedData(domain, types, value) -> signature
   * viem/CDP: signTypedData({ domain, types, primaryType, message }) -> signature
   *
   * The key difference is that viem requires an explicit `primaryType` parameter,
   * while ethers v5 infers it from the types object (first non-EIP712Domain type).
   *
   * @param domain - EIP-712 domain
   * @param types - Type definitions (first non-EIP712Domain key is the primary type)
   * @param value - The message to sign
   * @returns Hex-encoded signature
   */
  async _signTypedData(
    domain: TypedDataDomain,
    types: Record<string, TypedDataField[]>,
    value: Record<string, unknown>
  ): Promise<string> {
    // Extract primary type from types object
    // ethers v5 convention: the primary type is the first key that isn't 'EIP712Domain'
    const primaryType = Object.keys(types).find((t) => t !== "EIP712Domain");

    if (!primaryType) {
      throw new Error("No primary type found in types object");
    }

    // Call CDP's signTypedData with viem-compatible parameters
    const signature = await this.cdpAccount.signTypedData({
      domain: domain as any,
      types: types as any,
      primaryType: primaryType as any,
      message: value as any,
    });

    return signature;
  }

  /**
   * Sign an arbitrary message
   *
   * @param message - Message to sign (string or bytes)
   * @returns Hex-encoded signature
   */
  async signMessage(message: string | Uint8Array): Promise<string> {
    const messageStr =
      typeof message === "string" ? message : Buffer.from(message).toString();

    return this.cdpAccount.signMessage({ message: messageStr });
  }

  /**
   * Provider stub for network info
   *
   * The CLOB client may query the network to verify chain ID.
   * This provides a minimal implementation.
   */
  get provider(): { getNetwork: () => Promise<{ chainId: number; name: string }> } {
    return {
      getNetwork: async () => ({
        chainId: POLYGON_CHAIN_ID,
        name: "polygon",
      }),
    };
  }

  /**
   * Get the underlying CDP account
   *
   * Useful for direct interactions with the CDP SDK
   */
  getCdpAccount(): EvmServerAccount {
    return this.cdpAccount;
  }
}

export default CdpSignerAdapter;

