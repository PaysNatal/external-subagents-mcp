# Workspace Routing and Usage Telemetry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely delegate path-based work across explicitly authorized project roots and expose real provider token usage plus external-call state in every job.

**Architecture:** Add a workspace resolver that keeps the startup workspace as the default and directly validates target-project configs for optional cross-project calls. Change provider execution to return a report plus optional normalized usage, then carry that metadata through jobs, cache, compact MCP output, and documentation.

**Tech Stack:** TypeScript, Node.js filesystem APIs, Zod, MCP TypeScript SDK, Vitest

---

### Task 1: Resolve Explicitly Authorized Workspaces

**Files:**
- Modify: `src/workspace.ts`
- Modify: `src/config.ts`
- Test: `tests/workspace.test.ts`
- Test: `tests/config.test.ts`

- [ ] **Step 1: Write failing workspace resolver tests**

Add tests that call the wished-for resolver API:

```ts
const resolver = createWorkspaceResolver(defaultConfig);
const resolved = await resolver.resolve(secondRoot);
expect((await resolved.workspace.readAllowedFile("src/other.ts")).text).toContain("other");
expect(resolved.requestedRoot).toBe(await realpath(secondRoot));
```

Also assert rejection for a relative root, missing direct `.external-subagents-mcp.json`, and a target config whose `workspace.root` escapes its project.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npx vitest run tests/workspace.test.ts tests/config.test.ts
```

Expected: FAIL because `createWorkspaceResolver` and direct target-config loading do not exist.

- [ ] **Step 3: Implement direct config loading and workspace resolution**

Add a config helper with direct-file semantics:

```ts
export function loadConfigFile(configPath: string): NormalizedConfig {
  const absolute = path.resolve(configPath);
  return normalizeConfig(JSON.parse(readFileSync(absolute, "utf8")), path.dirname(absolute), absolute);
}
```

Add `WorkspaceResolver`, `ResolvedWorkspace`, and `createWorkspaceResolver`. Require an absolute requested root, canonicalize it, require a directly contained config, load it, and reject normalized target workspace roots outside the requested directory.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
npx vitest run tests/workspace.test.ts tests/config.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/workspace.ts src/config.ts tests/workspace.test.ts tests/config.test.ts
git commit -m "feat: resolve explicitly authorized workspaces"
```

### Task 2: Route Task Tools Through the Effective Workspace

**Files:**
- Modify: `src/app.ts`
- Modify: `src/factory.ts`
- Modify: `src/server.ts`
- Test: `tests/app.test.ts`
- Test: `tests/mcp.test.ts`
- Test: `tests/factory.test.ts`

- [ ] **Step 1: Write failing cross-project app and MCP schema tests**

Add `workspace_root?: string` to the wished-for calls in tests. Verify a second authorized workspace can be summarized by path, the provider receives that file content, and the task job records the canonical effective root. Verify the MCP tool schemas expose `workspace_root`.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npx vitest run tests/app.test.ts tests/mcp.test.ts tests/factory.test.ts
```

Expected: FAIL because task inputs do not accept or resolve `workspace_root`.

- [ ] **Step 3: Implement effective workspace routing**

Replace the app's static `workspace` option with `workspaceResolver`. For each path-based tool:

```ts
const resolved = await this.options.workspaceResolver.resolve(input.workspace_root);
const { documents, omitted } = await resolved.workspace.readAllowedFiles(input.paths);
```

Pass `resolved.effectiveRoot` into cache identity and `JobManager.start`. Update the factory and add a bounded absolute-path `workspace_root` schema to all four read-heavy MCP tools.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
npx vitest run tests/app.test.ts tests/mcp.test.ts tests/factory.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app.ts src/factory.ts src/server.ts tests/app.test.ts tests/mcp.test.ts tests/factory.test.ts
git commit -m "feat: route task tools to authorized project roots"
```

### Task 3: Normalize Provider Token Usage

**Files:**
- Modify: `src/types.ts`
- Modify: `src/provider.ts`
- Modify: `src/diagnostics.ts`
- Test: `tests/provider.test.ts`
- Test: `tests/diagnostics.test.ts`

- [ ] **Step 1: Write failing provider usage tests**

Use a mock chat-completions response containing:

```json
{
  "usage": {
    "prompt_tokens": 1200,
    "completion_tokens": 340,
    "total_tokens": 1540
  }
}
```

Assert `runReport()` returns `{ report, usage }`. Add cases proving absent and invalid fields leave usage undefined without failing the report.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npx vitest run tests/provider.test.ts tests/diagnostics.test.ts
```

Expected: FAIL because provider results currently contain only the report.

- [ ] **Step 3: Implement normalized provider run results**

Define:

```ts
export interface ProviderUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ProviderRunResult {
  report: DelegateReport;
  usage?: ProviderUsage;
}
```

Update `ProviderClient.runReport`, normalize valid usage fields in `OpenAICompatibleProvider`, and adjust provider smoke diagnostics to unwrap `result.report`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
npx vitest run tests/provider.test.ts tests/diagnostics.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/provider.ts src/diagnostics.ts tests/provider.test.ts tests/diagnostics.test.ts
git commit -m "feat: normalize provider token usage"
```

### Task 4: Persist and Report Job Telemetry

**Files:**
- Modify: `src/types.ts`
- Modify: `src/jobs.ts`
- Modify: `src/cache.ts`
- Modify: `src/app.ts`
- Modify: `src/server.ts`
- Test: `tests/jobs.test.ts`
- Test: `tests/cache.test.ts`
- Test: `tests/app.test.ts`
- Test: `tests/mcp.test.ts`

- [ ] **Step 1: Write failing job and cache telemetry tests**

Assert completed provider jobs expose `inputBytes`, `workspaceRoot`, `externalApiCalled: true`, and normalized usage. Assert failed attempts still mark the external call. Assert cache hits expose `externalApiCalled: false` and preserve historical usage.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npx vitest run tests/jobs.test.ts tests/cache.test.ts tests/app.test.ts tests/mcp.test.ts
```

Expected: FAIL because telemetry fields do not exist.

- [ ] **Step 3: Implement telemetry propagation**

Extend `JobRecord`, `CachedJobResult`, `StartJobInput`, and `publicJob`. Mark API-call state immediately before `provider.runReport()`, attach returned usage, and persist usage with successful cached results. Include effective workspace roots in job starts and cache identity.

Update compact job summaries to append:

```text
api=called usage=1540 tokens
```

or:

```text
api=cache-hit
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
npx vitest run tests/jobs.test.ts tests/cache.test.ts tests/app.test.ts tests/mcp.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/jobs.ts src/cache.ts src/app.ts src/server.ts tests/jobs.test.ts tests/cache.test.ts tests/app.test.ts tests/mcp.test.ts
git commit -m "feat: expose delegation usage telemetry"
```

### Task 5: Release Documentation and Version

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `.external-subagents-mcp.example.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/server.ts`
- Test: `tests/mcp.test.ts`

- [ ] **Step 1: Write failing release metadata assertion**

Update the MCP integration test to expect server version `0.2.0` or export a version constant that can be asserted consistently.

- [ ] **Step 2: Run focused test and verify RED**

Run:

```bash
npx vitest run tests/mcp.test.ts
```

Expected: FAIL while server metadata remains `0.1.2`.

- [ ] **Step 3: Update release surface**

Set package and server version to `0.2.0`. Add README sections explaining:

- Use `workspace_root` for another authorized project.
- The requested root must directly contain `.external-subagents-mcp.json`.
- Providers and API keys remain controlled by the running server.
- `externalApiCalled`, `inputBytes`, and optional usage fields.
- Prefer path delegation over embedding large source text.

Add a `v0.2.0` changelog entry and a comment-level explanation in the example config.

- [ ] **Step 4: Run focused test and verify GREEN**

Run:

```bash
npx vitest run tests/mcp.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md .external-subagents-mcp.example.json package.json package-lock.json src/server.ts tests/mcp.test.ts
git commit -m "chore: prepare v0.2.0"
```

### Task 6: Full Verification and Real Delegation

**Files:**
- No production changes expected

- [ ] **Step 1: Run static and automated verification**

Run:

```bash
npm test
npm run typecheck
npm run build
npm run smoke:stdio
git diff --check main...HEAD
```

Expected: all commands exit zero.

- [ ] **Step 2: Run real configured provider diagnostics**

Using the installed/configured MiMo environment, run provider status and smoke diagnostics. Then delegate a path-based review against an explicitly authorized non-default project root and retrieve its result.

Expected: the job records the requested workspace root, `externalApiCalled: true`, and provider usage when MiMo returns it. The main-model prompt does not embed the file body.

- [ ] **Step 3: Review the complete branch diff**

Inspect `git diff --stat main...HEAD` and `git diff main...HEAD`. Confirm the implementation matches the design, preserves deny-first workspace access, does not expose secrets, and leaves unrelated files untouched.

- [ ] **Step 4: Commit verification-only corrections if required**

If verification exposes a defect, reproduce it with a failing test, fix it, rerun the full verification set, and commit the correction.
