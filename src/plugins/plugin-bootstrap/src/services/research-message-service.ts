/**
 * ResearchMessageService - Simplified message service for Operon Research bot.
 *
 * Replaces OtakuMessageService (1,376 lines) with a transparent, debuggable
 * implementation (~250 lines). Removes race tracking, x402 bypass, attachment
 * processing, and run lifecycle events. Adds prompt logging at every LLM call.
 */

import { v4 } from 'uuid';
import {
  type IAgentRuntime,
  type Memory,
  type Content,
  type UUID,
  type State,
  type HandlerCallback,
  type IMessageService,
  type MessageProcessingOptions,
  type MessageProcessingResult,
  type ResponseDecision,
  type Room,
  type MentionContext,
  ChannelType,
  ModelType,
  asUUID,
  composePromptFromState,
  parseKeyValueXml,
  truncateToCompleteSentence,
  logger,
} from '@elizaos/core';

import { multiStepDecisionTemplate, multiStepSummaryTemplate } from '../templates/index.js';
import { retryParse } from '../utils/retry.js';
import { logState, logPrompt } from '../utils/logging.js';

/**
 * Template for LLM-based shouldRespond evaluation.
 * Only used when rules-based check returns skipEvaluation: false (group chats).
 */
const shouldRespondTemplate = `<task>Decide on behalf of {{agentName}} whether they should respond to the message, ignore it or stop the conversation.</task>

<providers>
{{providers}}
</providers>

<instructions>Decide if {{agentName}} should respond to or interact with the conversation.

IMPORTANT RULES FOR RESPONDING:
- If YOUR name ({{agentName}}) is directly mentioned -> RESPOND
- If someone uses a DIFFERENT name (not {{agentName}}) -> IGNORE (they're talking to someone else)
- If you're actively participating in a conversation and the message continues that thread -> RESPOND
- If someone tells you to stop or be quiet -> STOP
- Otherwise -> IGNORE

The key distinction is:
- "Talking TO {{agentName}}" (your name mentioned, replies to you, continuing your conversation) -> RESPOND
- "Talking ABOUT {{agentName}}" or to someone else -> IGNORE
</instructions>

<output>
Do NOT include any thinking, reasoning, or <think> sections in your response.
Go directly to the XML response format without any preamble or explanation.

Respond using XML format like this:
<response>
  <name>{{agentName}}</name>
  <reasoning>Your reasoning here</reasoning>
  <action>RESPOND | IGNORE | STOP</action>
</response>

IMPORTANT: Your response must ONLY contain the <response></response> XML block above. Do not include any text, thinking, or reasoning before or after this XML block. Start your response immediately with <response> and end with </response>.
</output>`;

/** Extended Content with Telegram-specific inline keyboard buttons (processed by patched plugin). */
interface ContentWithButtons extends Content {
  buttons?: Array<{ kind: string; text: string; url: string }>;
}

/** Result type for multi-step action tracking */
interface ActionTrace {
  actionName: string;
  success: boolean;
  text?: string;
  error?: string;
}

const MAX_ITERATIONS = 4;
const MAX_PARSE_RETRIES = 3;
/** Max time for tool loop + summary before we abort and send a timeout message. */
const QUERY_TIMEOUT_MS = 60_000;
/** Per-user rate limit: max queries within the sliding window. */
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;

export class ResearchMessageService implements IMessageService {
  /** Sliding-window rate limiter: entityId -> timestamps of recent queries. */
  private readonly recentQueries = new Map<string, number[]>();

  /**
   * Main entry point - called by ElizaOS Telegram client for each message.
   */
  async handleMessage(
    runtime: IAgentRuntime,
    message: Memory,
    callback?: HandlerCallback,
    _options?: MessageProcessingOptions
  ): Promise<MessageProcessingResult> {
    const tStart = Date.now();

    const emptyResult: MessageProcessingResult = {
      didRespond: false,
      responseContent: null,
      responseMessages: [],
      state: { values: {}, data: {}, text: '' } as State,
      mode: 'none',
    };

    // 1. Skip self-messages
    if (message.entityId === runtime.agentId) {
      return emptyResult;
    }

    runtime.logger.info(
      `[Research] Processing: "${truncateToCompleteSentence(message.content.text || '', 80)}"`
    );

    // 2. Handle /start, /help commands and first-message welcome
    const commandResult = await this.handleCommandsAndWelcome(runtime, message, callback);
    if (commandResult) return commandResult;

    // 3. Save incoming message to memory
    if (message.id) {
      const existing = await runtime.getMemoryById(message.id);
      if (!existing) {
        const id = await runtime.createMemory(message, 'messages');
        message.id = id;
      }
    } else {
      const id = await runtime.createMemory(message, 'messages');
      message.id = id;
    }

    // 4. shouldRespond check
    const room = await runtime.getRoom(message.roomId);
    const metadata = message.content.metadata as Record<string, unknown> | undefined;
    const mentionContext: MentionContext | undefined = metadata
      ? {
          isMention: !!metadata.isMention,
          isReply: !!metadata.isReply,
          isThread: !!metadata.isThread,
          mentionType: metadata.mentionType as MentionContext['mentionType'],
        }
      : undefined;

    const decision = this.shouldRespond(runtime, message, room ?? undefined, mentionContext);
    runtime.logger.debug(`[Research] shouldRespond: ${decision.shouldRespond} (${decision.reason})`);

    if (decision.skipEvaluation) {
      if (!decision.shouldRespond) return emptyResult;
    } else {
      // LLM evaluation for group chats
      const evalState = await runtime.composeState(message, ['RECENT_MESSAGES', 'CHARACTER'], true);
      const prompt = composePromptFromState({
        state: evalState,
        template: shouldRespondTemplate,
      });
      const response = await runtime.useModel(ModelType.TEXT_SMALL, { prompt });
      const parsed = parseKeyValueXml(String(response));
      const action = parsed?.action;
      const shouldAnswer = typeof action === 'string' && !['IGNORE', 'NONE', 'STOP'].includes(action.toUpperCase());
      if (!shouldAnswer) return emptyResult;
    }

    // --- Active query processing starts here ---

    // Per-user rate limit (sliding window)
    const userId = message.entityId;
    const now = Date.now();
    const timestamps = this.recentQueries.get(userId) ?? [];
    const recent = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
    if (recent.length >= RATE_LIMIT_MAX) {
      runtime.logger.warn({ userId, count: recent.length }, '[Research] Rate limit exceeded');
      if (callback) {
        try {
          await callback({ text: 'Slow down - I can handle about 5 queries per minute. Try again shortly.', actions: [], simple: true } as Content);
        } catch { /* best-effort */ }
      }
      return emptyResult;
    }
    recent.push(now);
    this.recentQueries.set(userId, recent);

    // Send instant ack (visible in-thread feedback while LLM works)
    if (callback) {
      try {
        await callback({ text: 'On it. Pulling research. One sec.', actions: [], simple: true } as Content);
      } catch (ackErr) {
        runtime.logger.warn({ err: ackErr }, '[Research] Ack send failed, continuing with query');
      }
    }
    const tAckSent = Date.now();

    // 5. Multi-step tool loop + summary with overall timeout
    let traces: ActionTrace[];
    let loopState: State;
    let responseContent: Content | null;
    let tToolLoopDone: number;
    let tSummaryDone: number;

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('QUERY_TIMEOUT')), QUERY_TIMEOUT_MS);
    });

    try {
      const result = await Promise.race([
        (async () => {
          const loop = await this.runToolLoop(runtime, message);
          const tLoop = Date.now();
          const summary = await this.generateSummary(runtime, message, loop.traces);
          const tSummary = Date.now();
          return { ...loop, responseContent: summary, tLoop, tSummary };
        })(),
        timeoutPromise,
      ]);
      clearTimeout(timeoutHandle);
      traces = result.traces;
      loopState = result.state;
      responseContent = result.responseContent;
      tToolLoopDone = result.tLoop;
      tSummaryDone = result.tSummary;
    } catch (err) {
      clearTimeout(timeoutHandle);
      if (err instanceof Error && err.message === 'QUERY_TIMEOUT') {
        runtime.logger.error('[Research] Query timed out after 60s');
        if (callback) {
          try {
            await callback({ text: 'This one is taking too long. Try a simpler question or ask again in a moment.', actions: [], simple: true } as Content);
          } catch { /* best-effort */ }
        }
        return emptyResult;
      }
      throw err; // re-throw non-timeout errors
    }

    // 7. Send response via callback and persist to memory
    let responseMessages: Memory[] = [];
    if (responseContent) {
      if (callback) {
        try {
          await callback(responseContent);
        } catch (sendErr) {
          runtime.logger.error({ err: sendErr }, '[Research] Failed to send response to Telegram');
        }
      }

      // Persist response to messages table so RECENT_MESSAGES includes it in future turns
      const responseMem: Memory = {
        id: asUUID(v4()),
        entityId: runtime.agentId,
        agentId: runtime.agentId,
        content: responseContent,
        roomId: message.roomId,
        createdAt: Date.now(),
      };
      await runtime.createMemory(responseMem, 'messages');
      responseMessages = [responseMem];
    }
    const tResponseSent = Date.now();

    // 8. Run evaluators (reflection, etc.)
    await runtime.evaluate(message, loopState, !!responseContent, callback, responseMessages);

    // Log latency breakdown
    const uptime = process.uptime();
    runtime.logger.info({
      ms: {
        setupToAck: tAckSent - tStart,
        toolLoop: tToolLoopDone - tAckSent,
        summary: tSummaryDone - tToolLoopDone,
        sendResponse: tResponseSent - tSummaryDone,
        total: tResponseSent - tStart,
      },
      coldStart: uptime < 60,
      uptimeSeconds: Math.round(uptime),
    }, '[Research:Latency] Query breakdown');

    return {
      didRespond: !!responseContent,
      responseContent: responseContent ?? null,
      responseMessages,
      state: loopState,
      mode: responseContent ? 'simple' : 'none',
    };
  }

  /** Welcome/help text shown on /start, /help, and first message from new user. */
  private static readonly WELCOME_TEXT = [
    'Operon Research here. DeFi analysis: protocols, yields, swaps, bridges, risk.',
    '',
    'When a paid tool matches your query, I\'ll surface it inline tagged [sponsored]. When nothing matches, you just get the research.',
    '',
    'Or ask your own.',
  ].join('\n');

  /** Help text (same as welcome). */
  private static readonly HELP_TEXT = ResearchMessageService.WELCOME_TEXT;

  /**
   * Inline keyboard prompts: 3 swap-intent (placement expected), 2 non-swap (research only).
   * SYNC: this list is duplicated in scripts/patch-plugin-telegram.ts (ALLOWED_CB in patch 6).
   * If you add/remove/change prompts here, update the patch script's allowlist too.
   */
  private static readonly EXAMPLE_PROMPTS = [
    "What's the cheapest way to swap ETH to USDC?",
    'Best way to bridge from Arbitrum to Base?',
    'Compare Aave and Compound yields',
    'Is Uniswap safe to use right now?',
    'Gas-optimized swap route for stablecoins',
  ];

  /** Build welcome content with inline keyboard buttons (callback kind, processed by patched plugin). */
  private static buildWelcomeContent(text?: string): ContentWithButtons {
    return {
      text: text ?? ResearchMessageService.WELCOME_TEXT,
      actions: [],
      simple: true,
      // Telegram inline keyboard - patched plugin converts kind:"callback" to Markup.button.callback
      buttons: ResearchMessageService.EXAMPLE_PROMPTS.map(p => ({
        kind: 'callback',
        text: p,
        url: p, // callback data (same as display text, all under 64 bytes)
      })),
    };
  }

  /**
   * Handle /start, /help commands and first-message welcome.
   * Returns a MessageProcessingResult to short-circuit if handled (commands),
   * or null to continue normal processing (first-message welcome fires but query still processes).
   */
  private async handleCommandsAndWelcome(
    runtime: IAgentRuntime,
    message: Memory,
    callback?: HandlerCallback
  ): Promise<MessageProcessingResult | null> {
    const rawText = (message.content.text || '').trim();
    // Strip @botname suffix (Telegram sends /start@operon_research_bot in groups)
    const baseCommand = rawText.toLowerCase().split('@')[0];

    // /start and /help: respond directly, skip tool loop
    if (baseCommand === '/start' || baseCommand === '/help') {
      runtime.logger.info(`[Research] Handling command: ${baseCommand}`);
      const responseText =
        baseCommand === '/start'
          ? ResearchMessageService.WELCOME_TEXT
          : ResearchMessageService.HELP_TEXT;

      const content = ResearchMessageService.buildWelcomeContent(responseText);
      if (callback) await callback(content);

      const responseMem: Memory = {
        id: asUUID(v4()),
        entityId: runtime.agentId,
        agentId: runtime.agentId,
        content,
        roomId: message.roomId,
        createdAt: Date.now(),
      };
      await runtime.createMemory(responseMem, 'messages');

      return {
        didRespond: true,
        responseContent: content,
        responseMessages: [responseMem],
        state: { values: {}, data: {}, text: '' } as State,
        mode: 'simple',
      };
    }

    // First message from new user (no /start): fire welcome before processing query.
    // Covers deep-link arrivals and share-link entry where Start button is skipped.
    const roomMessages = await runtime.getMemoriesByRoomIds({
      tableName: 'messages',
      roomIds: [message.roomId],
      count: 1, // only need to know if any exist
    });
    if (roomMessages.length === 0) {
      runtime.logger.info('[Research] First message from new user - sending welcome before query');
      const welcomeContent = ResearchMessageService.buildWelcomeContent();
      if (callback) await callback(welcomeContent);
      // Don't short-circuit: fall through so the user's actual query gets processed
    }

    return null;
  }

  /**
   * Rules-based shouldRespond with LLM fallback for ambiguous cases.
   */
  shouldRespond(
    runtime: IAgentRuntime,
    message: Memory,
    room?: Room,
    mentionContext?: MentionContext
  ): ResponseDecision {
    if (!room) {
      return { shouldRespond: false, skipEvaluation: true, reason: 'no room context' };
    }

    const alwaysRespondChannels = new Set(
      [ChannelType.DM, ChannelType.VOICE_DM, ChannelType.SELF, ChannelType.API]
        .map((t) => t.toString().toLowerCase())
    );

    const roomType = room.type?.toString().toLowerCase();
    if (alwaysRespondChannels.has(roomType)) {
      return { shouldRespond: true, skipEvaluation: true, reason: `private channel: ${roomType}` };
    }

    // Whitelisted sources
    const sourceStr = message.content.source?.toLowerCase() || '';
    if (sourceStr.includes('client_chat')) {
      return { shouldRespond: true, skipEvaluation: true, reason: `whitelisted source: ${sourceStr}` };
    }

    // Platform mentions and replies
    if (mentionContext?.isMention || mentionContext?.isReply) {
      const type = mentionContext.isMention ? 'mention' : 'reply';
      return { shouldRespond: true, skipEvaluation: true, reason: `platform ${type}` };
    }

    // All other cases: let LLM decide
    return { shouldRespond: false, skipEvaluation: false, reason: 'needs LLM evaluation' };
  }

  /**
   * Multi-step decision loop: LLM picks actions, we execute them, repeat until done.
   */
  private async runToolLoop(
    runtime: IAgentRuntime,
    message: Memory
  ): Promise<{ traces: ActionTrace[]; state: State }> {
    const traces: ActionTrace[] = [];
    let state: State;

    for (let i = 1; i <= MAX_ITERATIONS; i++) {
      // Compose state for decision (onlyInclude=true to avoid pulling all registered providers)
      const providerList = ['RECENT_MESSAGES', 'ACTIONS', 'ACTION_STATE'];
      state = await runtime.composeState(message, providerList, true);
      state.data.actionResults = traces;

      const stateWithContext = {
        ...state,
        iterationCount: i,
        maxIterations: MAX_ITERATIONS,
        traceActionResult: traces,
      };

      const prompt = composePromptFromState({
        state: stateWithContext,
        template: runtime.character.templates?.multiStepDecisionTemplate || multiStepDecisionTemplate,
      });

      logState(runtime.logger, `decision-${i}`, state, providerList);
      logPrompt(runtime.logger, `decision-${i}`, prompt);

      // LLM decides next action
      const tDecisionStart = Date.now();
      const parsed = await retryParse(async () => {
        const raw = await runtime.useModel(ModelType.TEXT_LARGE, { prompt });
        return parseKeyValueXml(raw);
      }, MAX_PARSE_RETRIES, `decision-${i}`);
      const tDecisionEnd = Date.now();

      if (!parsed) {
        runtime.logger.warn(`[Research] Failed to parse decision at step ${i}`);
        traces.push({ actionName: 'parse_error', success: false, error: 'Failed to parse decision' });
        break;
      }

      const { thought, action, isFinish, parameters } = parsed as {
        thought?: string;
        action?: string;
        isFinish?: string | boolean;
        parameters?: string | Record<string, unknown>;
      };

      // No action or empty action - finish the loop
      const cleanAction = action?.replace(/^["']+|["']+$/g, '').trim();
      if (!cleanAction) {
        runtime.logger.info(`[Research] No action at step ${i}, finishing`);
        break;
      }

      // Execute the action
      runtime.logger.info(`[Research] Step ${i}: executing ${cleanAction}`);
      const tActionStart = Date.now();

      try {
        // Parse parameters
        let actionParams: Record<string, unknown> = {};
        if (parameters) {
          if (typeof parameters === 'string') {
            try { actionParams = JSON.parse(parameters); } catch { /* ignore */ }
          } else if (typeof parameters === 'object') {
            actionParams = parameters;
          }
        }

        // Save previous params so we can restore after processActions
        const prevStateParams = state.data.actionParams;
        const prevContentParams = (message.content as Record<string, unknown>).actionParams;

        // Store params for action handlers via both channels
        const hasParams = Object.keys(actionParams).length > 0;
        state.data.actionParams = hasParams ? actionParams : undefined;
        if (hasParams) {
          (message.content as Record<string, unknown>).actionParams = actionParams;
        }

        const actionContent: Content = {
          text: `Executing action: ${cleanAction}`,
          actions: [cleanAction],
          thought: thought ?? '',
        };
        if (hasParams) {
          (actionContent as Content & { actionParams: unknown; actionInput: unknown }).actionParams = actionParams;
          (actionContent as Content & { actionParams: unknown; actionInput: unknown }).actionInput = actionParams;
        }

        try {
          await runtime.processActions(
            message,
            [{
              id: v4() as UUID,
              entityId: runtime.agentId,
              roomId: message.roomId,
              createdAt: Date.now(),
              content: actionContent,
            }],
            state,
            async () => { return []; }
          );
        } finally {
          // Restore both channels to avoid leaking params into next iteration
          state.data.actionParams = prevStateParams;
          (message.content as Record<string, unknown>).actionParams = prevContentParams;
        }

        // Get results via official API
        let lastResult: { success: boolean; text?: string; error?: string | Error } | null = null;
        if (message.id) {
          const actionResults = runtime.getActionResults(message.id as UUID);
          lastResult = actionResults.length > 0 ? actionResults[actionResults.length - 1] : null;
        }

        traces.push({
          actionName: cleanAction,
          success: lastResult?.success ?? false,
          text: lastResult?.text ?? undefined,
          error: lastResult?.success ? undefined : (lastResult?.error?.toString() ?? lastResult?.text ?? undefined),
        });
      } catch (err) {
        runtime.logger.error({ err }, `[Research] Error executing ${cleanAction}`);
        traces.push({
          actionName: cleanAction,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      const tActionEnd = Date.now();

      // Per-step latency (actions run serial, not parallel)
      runtime.logger.info({
        step: i,
        action: cleanAction,
        ms: {
          llmDecision: tDecisionEnd - tDecisionStart,
          actionExecution: tActionEnd - tActionStart,
          stepTotal: tActionEnd - tDecisionStart,
        },
        serial: true,
      }, `[Research:Latency] Step ${i}: ${cleanAction}`);

      // Check if done
      if (isFinish === 'true' || isFinish === true) {
        runtime.logger.info(`[Research] Finished at step ${i}`);
        break;
      }
    }

    // Return final state for summary
    state = await runtime.composeState(message, ['RECENT_MESSAGES', 'ACTION_STATE'], true);
    state.data.actionResults = traces;
    return { traces, state };
  }

  /**
   * Generate final user-facing response from action results.
   */
  private async generateSummary(
    runtime: IAgentRuntime,
    message: Memory,
    traces: ActionTrace[]
  ): Promise<Content | null> {
    const tComposeStart = Date.now();
    const providerList = ['RECENT_MESSAGES', 'ACTION_STATE', 'OPERON_PLACEMENT', 'CHARACTER', 'TIME'];
    const state = await runtime.composeState(message, providerList, true);
    state.data.actionResults = traces;

    const prompt = composePromptFromState({
      state,
      template: runtime.character.templates?.multiStepSummaryTemplate || multiStepSummaryTemplate,
    });

    logState(runtime.logger, 'summary', state, providerList);
    logPrompt(runtime.logger, 'summary', prompt);

    const tLlmStart = Date.now();
    const summary = await retryParse(async () => {
      const raw = await runtime.useModel(ModelType.TEXT_LARGE, { prompt });
      const parsed = parseKeyValueXml(raw);
      return parsed?.text ? parsed : null;
    }, MAX_PARSE_RETRIES, 'summary');
    const tLlmEnd = Date.now();

    runtime.logger.info({
      ms: {
        composeState: tLlmStart - tComposeStart,
        llmSummary: tLlmEnd - tLlmStart,
        total: tLlmEnd - tComposeStart,
      },
    }, '[Research:Latency] Summary generation');

    if (summary?.text) {
      return {
        actions: ['MULTI_STEP_SUMMARY'],
        text: summary.text as string,
        thought: (summary.thought as string) || 'Summary of research results.',
        simple: true,
      };
    }

    // Fallback
    runtime.logger.warn('[Research] Summary generation failed, using fallback');
    return {
      actions: ['MULTI_STEP_SUMMARY'],
      text: 'I completed the research but had trouble generating the summary. Could you try asking again?',
      thought: 'Summary generation failed.',
      simple: true,
    };
  }

  /**
   * Delete a message from memory.
   */
  async deleteMessage(runtime: IAgentRuntime, message: Memory): Promise<void> {
    if (message.id) {
      await runtime.deleteMemory(message.id);
    }
  }

  /**
   * Clear all messages from a channel.
   */
  async clearChannel(runtime: IAgentRuntime, roomId: UUID, _channelId: string): Promise<void> {
    // Paginate in batches to avoid loading unbounded message history
    const BATCH = 500;
    let deleted = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const batch = await runtime.getMemoriesByRoomIds({
        tableName: 'messages',
        roomIds: [roomId],
        count: BATCH,
      });
      if (batch.length === 0) break;
      for (const memory of batch) {
        if (memory.id) {
          try { await runtime.deleteMemory(memory.id); deleted++; } catch { /* continue */ }
        }
      }
      if (batch.length < BATCH) break; // last page
    }
    if (deleted > 0) {
      runtime.logger.info({ roomId, deleted }, '[Research] Channel cleared');
    }
  }
}
