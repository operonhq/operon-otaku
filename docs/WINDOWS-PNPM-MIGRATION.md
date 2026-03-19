# Operon Otaku - Windows/pnpm Migration Report

> Date: 2026-03-19
> Context: Getting operon-otaku (ElizaOS fork) running on Windows with pnpm/tsx instead of bun

## Problem

The Otaku repo was built entirely around bun - build scripts, runtime, path resolution, and shell commands. None of it worked on a Windows dev environment using pnpm + Node.js (tsx).

This document records every issue hit and how it was fixed, so nobody has to debug this again.

---

## Issues Fixed (in order encountered)

### 1. `packageManager` field blocks pnpm install

**Error:** `Unsupported package manager specification (bun@1.2.21)`

**Fix:** Changed `packageManager` in `package.json` from `bun@1.2.21` to `pnpm@10.18.3`.

---

### 2. Missing `pnpm-workspace.yaml`

**Error:** `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND - no package named "@elizaos/api-client" is present in the workspace`

**Cause:** pnpm doesn't read the `workspaces` field in `package.json` (that's a yarn/npm thing). It needs its own config file.

**Fix:** Created `pnpm-workspace.yaml`:
```yaml
packages:
  - "src/packages/*"
```

---

### 3. Postinstall script uses bun

**Error:** `'bun' is not recognized as an internal or external command`

**Cause:** `postinstall` script ran `bun run scripts/patch-plugin-sql.ts || true`. Also, `true` is not a valid command on Windows.

**Fix in `package.json`:**
- `"postinstall": "tsx scripts/patch-plugin-sql.ts || exit 0"`

**Fix in `scripts/patch-plugin-sql.ts`:**
- Changed shebang from `#!/usr/bin/env bun` to `#!/usr/bin/env tsx`
- Replaced `import.meta.dir` (bun-only) with cross-platform path resolution:
  ```ts
  // Before (bun-only):
  const PLUGIN_SQL_PATH = join(import.meta.dir, '../node_modules/...');

  // After (cross-platform):
  const PLUGIN_SQL_PATH = join(
    new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'),
    '../node_modules/...'
  );
  ```
  The regex strips the leading `/` from Windows drive letters (`/C:/` -> `C:/`).

---

### 4. Sub-package build scripts use bun

**Error:** `'bun' is not recognized` during `turbo run build`

**Cause:** `src/packages/api-client/package.json` and `src/packages/server/package.json` both had `"build": "bun run build.ts"`.

**Resolution:** These build scripts use `Bun.build()`, `BunPlugin`, and `Bun.write()` APIs internally - they CANNOT be ported to tsx. Instead of rewriting the build system, we installed bun globally: `npm install -g bun`. The sub-package build scripts stay as-is.

**Key insight:** bun is required for building, tsx is used for runtime. This is the intended split.

---

### 5. Root build script not included in dev command

**Error:** Server starts but `dist/index.js` is missing - the root project was never built.

**Cause:** The `dev` script only ran `turbo run build` (sub-packages) then `tsx start-server.ts`. The root `build.ts` (which produces `dist/index.js`) was never invoked.

**Fix:** Changed dev script to: `"dev": "turbo run build && bun run build.ts && tsx start-server.ts"`

---

### 6. Windows path in ESM dynamic import

**Error:** `ERR_UNSUPPORTED_ESM_URL_SCHEME: Received protocol 'c:'`

**Cause:** `start-server.ts` did `await import(projectPath)` where `projectPath` was a Windows absolute path like `C:\Users\...\dist\index.js`. Node.js ESM requires `file://` URLs on Windows.

**Fix in `start-server.ts`:**
```ts
import { fileURLToPath, pathToFileURL } from 'url';
// ...
const project = await import(pathToFileURL(projectPath).href);
```

---

### 7. `@elizaos/plugin-mcp` version mismatch

**Error:** `SyntaxError: The requested module '@elizaos/core' does not provide an export named 'getRequestContext'`

**Cause:** `package.json` had `"@elizaos/plugin-mcp": "latest"` which resolved to v1.8.2. That version imports `getRequestContext` from `@elizaos/core`, but the project uses core v1.7.0 which doesn't export it.

**Fix:** Pinned `"@elizaos/plugin-mcp": "1.7.0"` to match core version.

**Lesson:** Never use `"latest"` for ElizaOS plugins. Pin to match your `@elizaos/core` version.

---

### 8. `@/` path aliases not resolvable at runtime

**Error:** `ERR_MODULE_NOT_FOUND` for `@/managers/...` and `@/constants/...`

**Cause:** The build system was marking `@/` imports as external (expecting Node.js to resolve them at runtime via the `imports` field in `package.json`). But Node.js `imports` only supports `#` prefix, not `@/`.

**Fix (3 files):**
- `build.ts` - Removed the path-alias-resolver plugin that marked `@/` as external. Now bun resolves and bundles them inline.
- `src/build-utils.ts` - Made `createPathAliasPlugin` a no-op (empty setup function).
- `src/packages/server/build.ts` - Removed `@/managers/*` and `@/constants/*` from the `external` array.
- `package.json` - Changed `imports` field to use `#` prefix (`#managers/*`, `#constants/*`) for correctness, though no longer needed for the build.

---

### 9. Port 3000 conflict

**Symptom:** `curl http://localhost:3000/api/agents` returned a 404 HTML page from a different dev server.

**Fix:** Added `SERVER_PORT=3001` to `.env`. Otaku now runs on 3001, Operon server on 3100.

---

### 10. X402 wallet required

**Error:** `X402_RECEIVING_WALLET is required. Payment protection must be enabled.`

**Fix:** Added placeholder to `.env`: `X402_RECEIVING_WALLET="0x0000000000000000000000000000000000000000"`

---

### 11. Auth not configured for REST API

**Error:** `Authentication required (Bearer token or X-API-KEY)`

**Fix:** Added to `.env`:
```
JWT_SECRET=operon-dev-jwt-secret-32bytes!!
ELIZA_SERVER_AUTH_TOKEN=operon-dev
```
Use `X-API-KEY: operon-dev` header for API requests (not `Authorization: Bearer`).

---

### 12. ElizaOS messaging database schema issue (UNRESOLVED)

**Error:** `Failed to create message in database` - insert into `central_messages` fails.

**Cause:** PGlite (embedded Postgres) messaging schema migration is incomplete. The `author_id` column lacks proper defaults for the REST API flow.

**Status:** Not fixed. This is an ElizaOS infrastructure issue, not an Operon integration issue. Workarounds:
- Use Telegram client instead of REST API (bypasses the messaging DB)
- Connect a real PostgreSQL database via `POSTGRES_URL`
- Use the `test-operon-flow.ts` script to verify the Operon integration directly

---

## Required .env Variables

```env
# Operon SDK
OPERON_URL=http://localhost:3100
OPERON_API_KEY=<from POST /publishers on Operon server>
OPERON_DEFAULT_CATEGORY=market_analysis
OPERON_DEFAULT_INTENT=allocation_advice

# LLM
OPENAI_API_KEY=sk-proj-...

# Server
SERVER_PORT=3001
JWT_SECRET=<any 32+ char string>
ELIZA_SERVER_AUTH_TOKEN=<any string for API access>
X402_RECEIVING_WALLET="0x0000000000000000000000000000000000000000"
```

---

## Runtime Dependencies

- **Node.js v20** (via nvm) - do NOT use Node 22, native modules break
- **pnpm** - package manager
- **bun** - required for building only (`npm install -g bun`)
- **tsx** - TypeScript runtime for Node.js

If `better-sqlite3` or other native modules fail with `NODE_MODULE_VERSION` mismatch, rebuild from the SAME shell you'll run the server from:
```bash
pnpm rebuild better-sqlite3
```

---

## Startup Sequence

```bash
# Terminal 1: Operon server
cd ~/projects/operon
# Ensure .env has MOCK_SCOUTSCORE=true
pnpm dev:operon

# Create a publisher (once):
curl -X POST http://localhost:3100/publishers \
  -H "Authorization: Bearer dev-admin-secret" \
  -H "Content-Type: application/json" \
  -d '{"name":"operon-otaku"}'

# Terminal 2: Otaku agent
cd ~/projects/operon-otaku
pnpm dev

# Terminal 3: Test the flow
cd ~/projects/operon-otaku
npx tsx test-operon-flow.ts
```

---

## Files Modified

| File | Change |
|------|--------|
| `package.json` | packageManager, scripts, imports field, plugin-mcp pinned |
| `pnpm-workspace.yaml` | Created (new) |
| `start-server.ts` | pathToFileURL for Windows ESM |
| `build.ts` | Removed @/ external plugin |
| `src/build-utils.ts` | No-op path alias plugin |
| `src/packages/server/build.ts` | Removed @/ externals |
| `scripts/patch-plugin-sql.ts` | tsx shebang, cross-platform paths |
| `.env` | SERVER_PORT, JWT_SECRET, ELIZA_SERVER_AUTH_TOKEN, X402 |
| `test-operon-flow.ts` | Created (new) - E2E placement test |
