import { logger } from '@elizaos/core';

const RETRY_BASE_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 10000;
const RETRY_BACKOFF_MULTIPLIER = 2;

function getRetryDelay(attempt: number): number {
  const delay = RETRY_BASE_DELAY_MS * Math.pow(RETRY_BACKOFF_MULTIPLIER, attempt - 1);
  return Math.min(delay, RETRY_MAX_DELAY_MS);
}

/**
 * Retry a function that may fail to parse, with exponential backoff.
 * Returns the parsed result or null if all attempts fail.
 */
export async function retryParse<T>(
  fn: () => Promise<T | null>,
  maxRetries: number,
  label: string
): Promise<T | null> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      if (result !== null && result !== undefined) {
        logger.debug(`[${label}] Parsed on attempt ${attempt}`);
        return result;
      }
      logger.warn(`[${label}] Parse returned null on attempt ${attempt}/${maxRetries}`);
    } catch (error) {
      logger.error(`[${label}] Error on attempt ${attempt}/${maxRetries}: ${error}`);
      if (attempt >= maxRetries) return null;
    }
    if (attempt < maxRetries) {
      const delay = getRetryDelay(attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  return null;
}
