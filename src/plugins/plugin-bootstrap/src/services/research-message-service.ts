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

/** Result type for multi-step action tracking */
interface ActionTrace {
  actionName: string;
  success: boolean;
  text?: string;
  error?: string;
}

const MAX_ITERATIONS = 4;
const MAX_PARSE_RETRIES = 3;

export class ResearchMessageService implements IMessageService {
  /**
   * Main entry point - called by ElizaOS Telegram client for each message.
   */
  async handleMessage(
    runtime: IAgentRuntime,
    message: Memory,
    callback?: HandlerCallback,
    _options?: MessageProcessingOptions
  ): Promise<MessageProcessingResult> {
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

    // 2. Save incoming message to memory
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

    // 3. shouldRespond check
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

    // 3.5. Handle /start, /help commands and first-message welcome
    const commandResult = await this.handleCommandsAndWelcome(runtime, message, callback);
    if (commandResult) return commandResult;

    // 4. Multi-step tool loop
    const { traces, state: loopState } = await this.runToolLoop(runtime, message);

    // 5. Generate summary response
    const responseContent = await this.generateSummary(runtime, message, traces);

    // 6. Send response via callback and persist to memory
    let responseMessages: Memory[] = [];
    if (responseContent) {
      if (callback) {
        await callback(responseContent);
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

    // 7. Run evaluators (reflection, etc.)
    await runtime.evaluate(message, loopState, !!responseContent, callback, responseMessages);

    return {
      didRespond: !!responseContent,
      responseContent: responseContent ?? null,
      responseMessages,
      state: loopState,
      mode: responseContent ? 'simple' : 'none',
    };
  }

  /** Welcome text shown on /start and first message from a new user. */
  private static readonly WELCOME_TEXT = [
    'Welcome to Operon Research. I cover DeFi protocols, yields, swap routes, and risk assessment. When I recommend a tool, it is matched via a quality-weighted auction on Operon.',
    '',
    'Try one of these:',
    '- "What\'s the cheapest way to swap ETH to USDC?"',
    '- "Best way to bridge from Arbitrum to Base?"',
    '- "Compare Aave and Compound yields"',
    '- "Is Uniswap safe to use right now?"',
    '- "Gas-optimized swap route for stablecoins"',
  ].join('\n');

  /** Help text shown on /help. */
  private static readonly HELP_TEXT = [
    'Here are some things you can ask me:',
    '',
    '- "What\'s the cheapest way to swap ETH to USDC?"',
    '- "Best way to bridge from Arbitrum to Base?"',
    '- "Compare Aave and Compound yields"',
    '- "Is Uniswap safe to use right now?"',
    '- "Gas-optimized swap route for stablecoins"',
    '',
    'I focus on DeFi research - protocols, yields, swap routes, and risk assessment.',
  ].join('\n');

  /**
   * Handle /start, /help commands and first-message welcome.
   * Returns a MessageProcessingResult to short-circuit if handled, or null to continue.
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

      const content: Content = { text: responseText, actions: [], simple: true };
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

    // First-message detection: if this user has no prior messages in this room,
    // send the welcome before continuing to the normal tool loop.
    // When a first real query triggers this, the user receives two messages:
    // the welcome (here) and then the research response (from the tool loop).
    try {
      const roomMessages = await runtime.getMemoriesByRoomIds({
        tableName: 'messages',
        roomIds: [message.roomId],
        limit: 10,
      });
      const userPrior = roomMessages.filter(
        (m) => m.entityId === message.entityId && m.id !== message.id
      );
      if (userPrior.length === 0) {
        runtime.logger.info('[Research] First message from user, sending welcome');
        const welcomeContent: Content = {
          text: ResearchMessageService.WELCOME_TEXT,
          actions: [],
          simple: true,
        };
        if (callback) await callback(welcomeContent);
        await runtime.createMemory(
          {
            id: asUUID(v4()),
            entityId: runtime.agentId,
            agentId: runtime.agentId,
            content: welcomeContent,
            roomId: message.roomId,
            createdAt: Date.now(),
          },
          'messages'
        );
      }
    } catch (err) {
      runtime.logger.warn(`[Research] First-message check failed: ${err}`);
    }

    // Continue to normal processing
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
      const parsed = await retryParse(async () => {
        const raw = await runtime.useModel(ModelType.TEXT_LARGE, { prompt });
        return parseKeyValueXml(raw);
      }, MAX_PARSE_RETRIES, `decision-${i}`);

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

        // Store params in state for action handlers
        if (Object.keys(actionParams).length > 0) {
          state.data.actionParams = actionParams;
        }

        const actionContent: Content = {
          text: `Executing action: ${cleanAction}`,
          actions: [cleanAction],
          thought: thought ?? '',
        };
        if (Object.keys(actionParams).length > 0) {
          (actionContent as Content & { actionParams: unknown; actionInput: unknown }).actionParams = actionParams;
          (actionContent as Content & { actionParams: unknown; actionInput: unknown }).actionInput = actionParams;
        }

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
    const providerList = ['RECENT_MESSAGES', 'ACTION_STATE', 'OPERON_PLACEMENT', 'CHARACTER', 'TIME'];
    const state = await runtime.composeState(message, providerList, true);
    state.data.actionResults = traces;

    const prompt = composePromptFromState({
      state,
      template: runtime.character.templates?.multiStepSummaryTemplate || multiStepSummaryTemplate,
    });

    logState(runtime.logger, 'summary', state, providerList);
    logPrompt(runtime.logger, 'summary', prompt);

    const summary = await retryParse(async () => {
      const raw = await runtime.useModel(ModelType.TEXT_LARGE, { prompt });
      const parsed = parseKeyValueXml(raw);
      return parsed?.text ? parsed : null;
    }, MAX_PARSE_RETRIES, 'summary');

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
    const memories = await runtime.getMemoriesByRoomIds({
      tableName: 'messages',
      roomIds: [roomId],
    });
    for (const memory of memories) {
      if (memory.id) {
        try { await runtime.deleteMemory(memory.id); } catch { /* continue */ }
      }
    }
  }
}
