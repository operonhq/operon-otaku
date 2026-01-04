#!/usr/bin/env bun
/**
 * Patches @elizaos/plugin-sql to fix SET LOCAL parameterization bug.
 *
 * Bug: sql`SET LOCAL app.entity_id = ${entityId}` becomes "SET LOCAL app.entity_id = $1"
 *      which PostgreSQL rejects (SET LOCAL doesn't support parameterized queries)
 *
 * Fix: Use sql.raw() for inline interpolation instead
 *
 * Run automatically via postinstall or manually: bun run scripts/patch-plugin-sql.ts
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const PLUGIN_SQL_PATH = join(import.meta.dir, '../node_modules/@elizaos/plugin-sql/dist/node/index.node.js');

const PATCHES = [
  {
    name: 'SET LOCAL app.entity_id parameterization fix',
    search: 'await tx.execute(sql`SET LOCAL app.entity_id = ${entityId}`);',
    // Note: entityId is validated as UUID type upstream in ElizaOS (src/types.ts)
    // The withEntityContext function signature enforces UUID | null type
    // SQL injection risk is mitigated by this type validation before reaching this code
    replace: "await tx.execute(sql.raw(`SET LOCAL app.entity_id = '${entityId}'`));",
  },
  {
    name: 'Exclude user_registry from RLS (auth lookup table)',
    // Fix: user_registry is queried during auth to LOOK UP the entity_id.
    // RLS requires entity context to be set, but auth doesn't have it yet - chicken and egg.
    // user_registry stores auth mappings, not user data, so no entity isolation needed.
    search: `'__drizzle_migrations'  -- Migration tracking
          )`,
    replace: `'__drizzle_migrations', -- Migration tracking
            'user_registry'         -- Auth lookup table (queried before entity context exists)
          )`,
  },
  {
    name: 'PostgreSQL pool configuration (Railway-optimized)',
    // Fix: Railway Postgres proxy silently closes idle connections.
    // - Short idle timeout (10s) to evict stale connections quickly
    // - allowExitOnIdle: true - don't hold process open for idle connections
    // - keepAlive with short delay to detect dead connections
    search: 'const poolConfig = { connectionString };',
    replace: `const poolConfig = {
      connectionString,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000,
      max: 10,
      min: 0,
      keepAlive: true,
      keepAliveInitialDelayMillis: 5000,
      allowExitOnIdle: true,
    };`,
  },
  {
    name: 'Pool error handler (prevent crashes on connection errors)',
    // Fix: pg Pool emits 'error' when a connection dies. Without handler, pool can get into bad state.
    search: `this.pool = new Pool2(poolConfig);
    this.db = drizzle2(this.pool, { casing: "snake_case" });`,
    replace: `this.pool = new Pool2(poolConfig);
    // Handle pool errors to prevent crashes and log connection issues
    this.pool.on('error', (err) => {
      logger13.warn({ src: "plugin:sql", error: err?.message || String(err) }, "Pool client error (connection will be replaced)");
    });
    this.db = drizzle2(this.pool, { casing: "snake_case" });`,
  },
];

function applyPatches() {
  if (!existsSync(PLUGIN_SQL_PATH)) {
    console.log('⏭️  @elizaos/plugin-sql not installed, skipping patches');
    return;
  }

  let content = readFileSync(PLUGIN_SQL_PATH, 'utf-8');
  let patchesApplied = 0;

  for (const patch of PATCHES) {
    if (content.includes(patch.replace)) {
      console.log(`✅ ${patch.name} (already applied)`);
      continue;
    }

    if (!content.includes(patch.search)) {
      console.log(`⚠️  ${patch.name} (pattern not found - may be fixed upstream)`);
      continue;
    }

    content = content.replace(patch.search, patch.replace);
    patchesApplied++;
    console.log(`🔧 ${patch.name} (applied)`);
  }

  if (patchesApplied > 0) {
    writeFileSync(PLUGIN_SQL_PATH, content);
    console.log(`\n✅ Applied ${patchesApplied} patch(es) to @elizaos/plugin-sql`);
  }
}

applyPatches();

