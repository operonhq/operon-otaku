/**
 * Shared utilities for web-search plugin actions.
 */
import type { IAgentRuntime, Memory, State } from "@elizaos/core";

/** Maximum query length sent to external search APIs (Tavily, etc.). */
export const MAX_QUERY_LENGTH = 500;

/**
 * Resolve action parameters from multiple sources in priority order:
 *   1. _state.data.actionParams  (set by processActions via cache spread)
 *   2. message.content.actionParams (set by runToolLoop on the message object)
 *   3. Freshly composed state via composeState (legacy / fallback)
 *
 * The expensive composeState call is skipped when a higher-priority source
 * already provides params.
 *
 * @param runtime  Agent runtime (used only for the composeState fallback)
 * @param message  The original user message
 * @param state    State passed to the action handler by processActions
 * @param legacyKey  Optional legacy key to check in composed state (e.g. "webSearch", "cryptoNews")
 */
export async function resolveActionParams(
  runtime: IAgentRuntime,
  message: Memory,
  state: State | undefined,
  legacyKey?: string,
): Promise<Record<string, unknown>> {
  const stateParams = state?.data?.actionParams as Record<string, unknown> | undefined;
  const contentParams = (message.content as Record<string, unknown>)?.actionParams as
    | Record<string, unknown>
    | undefined;

  if (stateParams) return stateParams;
  if (contentParams) return contentParams;

  // Fallback: compose fresh state (hits providers / cache)
  const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
  const composedParams = composedState?.data?.actionParams as Record<string, unknown> | undefined;
  if (composedParams) return composedParams;

  if (legacyKey) {
    const legacy = composedState?.data?.[legacyKey] as Record<string, unknown> | undefined;
    if (legacy) return legacy;
  }

  return {};
}

/**
 * Extract a string value from an unknown param, with type guard.
 * Returns undefined for non-strings, empty strings, and whitespace-only strings.
 */
export function extractString(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

/**
 * Extract a safe numeric value from an unknown param.
 * Returns undefined for non-numeric values, NaN, and non-positive numbers.
 */
export function extractPositiveInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.max(min, Math.round(n)), max);
}

/**
 * Cap a query string to MAX_QUERY_LENGTH to avoid sending excessively long
 * queries to external APIs (Tavily, etc.). Truncates at a word boundary when
 * possible.
 */
export function capQueryLength(query: string, max = MAX_QUERY_LENGTH): string {
  if (query.length <= max) return query;
  const truncated = query.slice(0, max);
  const lastSpace = truncated.lastIndexOf(" ");
  return lastSpace > max * 0.6 ? truncated.slice(0, lastSpace) : truncated;
}
