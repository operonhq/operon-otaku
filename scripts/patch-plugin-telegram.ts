#!/usr/bin/env tsx
/**
 * Patches @elizaos/plugin-telegram to fix corrupted markdown link regex.
 *
 * Bug: The tsup/esbuild bundler corrupted the regex for matching markdown links.
 *      \[ became $begin:math:display$ and \( became $begin:math:text$ etc.
 *      This means [text](url) markdown links are never detected, so they get
 *      escaped as literal text: \[text\]\(url\) — rendered as plain text in Telegram.
 *
 * Fix: Replace the corrupted regex with the correct one.
 *
 * Run automatically via postinstall or manually: bun run scripts/patch-plugin-telegram.ts
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

for (const filePath of files) {
  let content = readFileSync(filePath, 'utf-8');

  const CORRUPTED = '$begin:math:display$([^$end:math:display$]+)]$begin:math:text$([^)]+)$end:math:text$';
  const CORRECT = '\\[([^\\]]+)\\]\\(([^)]+)\\)';

  if (content.includes(CORRECT)) {
    console.log('✅ Telegram markdown link regex (already fixed)');
    continue;
  }

  if (!content.includes(CORRUPTED)) {
    console.log('⚠️  Telegram markdown link regex (corrupted pattern not found - may be fixed upstream)');
    continue;
  }

  content = content.replace(CORRUPTED, CORRECT);
  writeFileSync(filePath, content);
  console.log('🔧 Telegram markdown link regex (fixed)');
}
