#!/usr/bin/env tsx
/**
 * Patches @elizaos/plugin-telegram for Operon Research bot.
 *
 * Patches:
 * 1. Fix corrupted markdown link regex (pre-existing tsup/esbuild bug)
 * 2. Add callback_query to allowedUpdates (for inline keyboard buttons)
 * 3. Add callback button kind to convertToTelegramButtons
 * 4. Inline keyboard layout: one button per row (mobile-friendly)
 * 5. Graceful reply fallback (allow_sending_without_reply for invalid message_ids)
 * 6. Add callback_query handler (routes button taps through message pipeline)
 *
 * Run: bun run scripts/patch-plugin-telegram.ts (also runs via postinstall)
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { globSync } from 'glob';

// Find the plugin-telegram dist file in pnpm store
const pattern = join(
  new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'),
  '../node_modules/.pnpm/*plugin-telegram*/node_modules/@elizaos/plugin-telegram/dist/index.js'
);

const files = globSync(pattern.replace(/\\/g, '/'));

if (files.length === 0) {
  console.log('⏭️  @elizaos/plugin-telegram not installed, skipping patches');
  process.exit(0);
}

interface Patch {
  name: string;
  find: string;
  replace: string;
  /** Unique string that only exists after this patch is applied */
  alreadyApplied: string;
  /** If true, failure to apply is a hard error (interdependent patches) */
  critical?: boolean;
}

const CORRUPTED_REGEX = '$begin:math:display$([^$end:math:display$]+)]$begin:math:text$([^)]+)$end:math:text$';
const CORRECT_REGEX = '\\[([^\\]]+)\\]\\(([^)]+)\\)';

const patches: Patch[] = [
  // --- Pre-existing: fix corrupted markdown link regex ---
  {
    name: 'markdown link regex',
    find: CORRUPTED_REGEX,
    replace: CORRECT_REGEX,
    alreadyApplied: CORRECT_REGEX,
  },

  // --- Patch 2: receive callback_query updates from Telegram ---
  {
    name: 'allowed updates (add callback_query)',
    find: 'allowedUpdates: ["message", "message_reaction"]',
    replace: 'allowedUpdates: ["message", "message_reaction", "callback_query"]',
    alreadyApplied: '"message_reaction", "callback_query"',
    critical: true,
  },

  // --- Patch 3: support callback buttons in convertToTelegramButtons ---
  {
    name: 'callback button kind',
    find: [
      '      case "url":',
      '        telegramButton = Markup.button.url(button.text, button.url);',
      '        break;',
      '      default:',
    ].join('\n'),
    replace: [
      '      case "url":',
      '        telegramButton = Markup.button.url(button.text, button.url);',
      '        break;',
      '      case "callback":',
      '        telegramButton = Markup.button.callback(button.text, button.url || button.text);',
      '        break;',
      '      default:',
    ].join('\n'),
    alreadyApplied: 'case "callback":',
    critical: true,
  },

  // --- Patch 4: one button per row for mobile readability ---
  {
    name: 'inline keyboard one-per-row',
    find: '...Markup2.inlineKeyboard(telegramButtons)',
    replace: '...(telegramButtons.length > 0 ? Markup2.inlineKeyboard(telegramButtons.map(function(b) { return [b]; })) : {})',
    alreadyApplied: 'telegramButtons.map(function(b)',
    critical: true,
  },

  // --- Patch 5: graceful reply fallback for synthetic message_ids ---
  {
    name: 'reply_parameters allow_sending_without_reply',
    find: '{ message_id: replyToMessageId } : void 0',
    replace: '{ message_id: replyToMessageId, allow_sending_without_reply: true } : void 0',
    alreadyApplied: 'allow_sending_without_reply',
    critical: true,
  },

  // --- Patch 6: route callback_query (button taps) through the message pipeline ---
  // SYNC: ALLOWED_CB below must match EXAMPLE_PROMPTS in research-message-service.ts.
  {
    name: 'callback_query handler',
    find: [
      '"Error handling reaction");',
      '      }',
      '    });',
      '  }',
    ].join('\n'),
    replace: [
      '"Error handling reaction");',
      '      }',
      '    });',
      '    this.bot?.on("callback_query", async (ctx) => {',
      '      try {',
      '        const data = ctx.callbackQuery?.data;',
      '        if (!data) { await ctx.answerCbQuery(); return; }',
      '        var ALLOWED_CB = ["What\'s the cheapest way to swap ETH to USDC?", "Best way to bridge from Arbitrum to Base?", "Compare Aave and Compound yields", "Is Uniswap safe to use right now?", "Gas-optimized swap route for stablecoins"];',
      '        if (ALLOWED_CB.indexOf(data) === -1) { await ctx.answerCbQuery(); logger3.warn({ src: "plugin:telegram", data: data }, "Unexpected callback_query data, ignoring"); return; }',
      '        await ctx.answerCbQuery();',
      '        const cbChat = ctx.callbackQuery.message?.chat;',
      '        const cbFrom = ctx.callbackQuery.from;',
      '        if (!cbChat || !cbFrom) return;',
      '        Object.defineProperty(ctx, "message", { value: { message_id: Date.now(), date: Math.floor(Date.now() / 1000), chat: cbChat, from: cbFrom, text: data }, configurable: true });',
      '        await this.messageManager.handleMessage(ctx);',
      '      } catch (error) {',
      '        logger3.error({ src: "plugin:telegram", agentId: this.runtime.agentId, error: error instanceof Error ? error.message : String(error) }, "Error handling callback query");',
      '      }',
      '    });',
      '  }',
    ].join('\n'),
    alreadyApplied: '"Error handling callback query"',
    critical: true,
  },
];

for (const filePath of files) {
  let content = readFileSync(filePath, 'utf-8');
  // Normalize line endings for consistent multi-line matching
  content = content.replace(/\r\n/g, '\n');
  let modified = false;
  const failures: string[] = [];

  for (const patch of patches) {
    if (content.includes(patch.alreadyApplied)) {
      console.log(`✅ ${patch.name} (already applied)`);
      continue;
    }

    if (!content.includes(patch.find)) {
      const msg = `${patch.name} (pattern not found - may be fixed upstream or code changed)`;
      if (patch.critical) {
        console.error(`❌ ${msg}`);
        failures.push(patch.name);
      } else {
        console.log(`⚠️  ${msg}`);
      }
      continue;
    }

    content = content.replace(patch.find, patch.replace);
    modified = true;
    console.log(`🔧 ${patch.name} (applied)`);
  }

  if (modified) {
    writeFileSync(filePath, content);
  }

  // Verify interdependent patches: all critical patches must either apply or already be present
  if (failures.length > 0) {
    console.error(`\n🚨 ${failures.length} critical patch(es) failed to apply: ${failures.join(', ')}`);
    console.error('   Inline keyboard buttons will not work. Pin @elizaos/plugin-telegram to 1.6.4.');
    process.exit(1);
  }
}
