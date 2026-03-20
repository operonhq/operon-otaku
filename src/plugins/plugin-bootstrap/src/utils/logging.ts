import type { State } from '@elizaos/core';

interface Logger {
  info(obj: Record<string, unknown>, msg: string): void;
}

/**
 * Log what composeState assembled - which providers contributed and key metrics.
 */
export function logState(log: Logger, step: string, state: State, providerList?: string[]): void {
  log.info({
    step,
    providers: providerList ?? [],
    chars: state.text?.length ?? 0,
    sponsored: state.text?.includes('[SPONSORED_CONTENT_START]') ?? false,
    valuesKeys: Object.keys(state.values ?? {}),
  }, '[State]');
}

/**
 * Log the assembled prompt before sending to the LLM - truncated preview for readability.
 */
export function logPrompt(log: Logger, step: string, prompt: string): void {
  log.info({
    step,
    chars: prompt.length,
    sponsored: prompt.includes('[SPONSORED_CONTENT_START]'),
    preview: prompt.substring(0, 500),
  }, '[Prompt]');
}
