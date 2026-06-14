# Codex-Led External Worker Pool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add early-delegation guidance and a bounded read-only workspace explorer while keeping Codex solely responsible for decisions, edits, commands, and acceptance.

**Architecture:** A maintained instruction template is exposed through CLI commands and abbreviated MCP server instructions. A new `explore_workspace` job uses an OpenAI-compatible tool-calling loop whose only tools are bounded workspace reads and searches; it returns the existing recovered `DelegateReport` plus exploration telemetry.

**Tech Stack:** TypeScript, Node.js, MCP TypeScript SDK, Zod, Vitest, OpenAI-compatible chat completions.

---

### Task 1: Installable Codex Delegation Instructions

**Files:**
- Create: `src/codex-instructions.ts`
- Modify: `src/cli.ts`
- Modify: `src/server.ts`
- Modify: `README.md`
- Test: `tests/codex-instructions.test.ts`
- Test: `tests/cli.test.ts`
- Test: `tests/mcp.test.ts`

- [ ] **Step 1: Write failing instruction rendering and installation tests**

Cover:

```ts
expect(renderCodexInstructions()).toContain("Codex remains the primary owner");
expect(renderCodexInstructions()).toContain("before large source reads");
expect(await installCodexInstructions({ target, dryRun: false })).toMatchObject({ changed: true });
expect(await readFile(target, "utf8")).toContain(BEGIN_MARKER);
expect(await installCodexInstructions({ target, dryRun: false })).toMatchObject({ changed: false });
```

Also prove unrelated content is preserved, dry-run does not write, and malformed or duplicated markers are rejected.

- [ ] **Step 2: Run focused tests and confirm failure**

Run:

```bash
npm test -- tests/codex-instructions.test.ts tests/cli.test.ts tests/mcp.test.ts
```

Expected: FAIL because instruction rendering, installation, and CLI commands do not exist.

- [ ] **Step 3: Implement instruction rendering and safe installation**

Create a maintained instruction block containing:

```text
Codex remains the primary owner: understand, plan, decide, edit, execute, verify, and accept.
Before large source reads, content searches, or log ingestion, perform an early delegation check.
Delegate bounded repetitive, simple, search/read/summarize/log-analysis/initial-review labor.
Do not delegate architecture, final implementation decisions, edits, shell, tests, or acceptance.
```

Implement marked-block replacement with idempotency, parent-directory creation, dry-run, and refusal on ambiguous markers.

Add CLI commands:

```bash
external-subagents-mcp codex-instructions
external-subagents-mcp install-codex-instructions [--dry-run] [--target <path>]
```

Update `SERVER_INSTRUCTIONS` with the shorter equivalent policy.

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- tests/codex-instructions.test.ts tests/cli.test.ts tests/mcp.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/codex-instructions.ts src/cli.ts src/server.ts README.md tests/codex-instructions.test.ts tests/cli.test.ts tests/mcp.test.ts
git commit -m "feat: add Codex delegation instructions"
```

### Task 2: OpenAI-Compatible Tool-Calling Provider Interface

**Files:**
- Modify: `src/types.ts`
- Modify: `src/provider.ts`
- Test: `tests/provider.test.ts`

- [ ] **Step 1: Write failing provider tool-loop tests**

Prove a provider can:

```ts
const turn = await provider.runToolTurn({
  system: "Read only",
  messages: [{ role: "user", content: "Find auth flow" }],
  tools: [{ type: "function", function: { name: "read_file", description: "...", parameters: {} } }],
  maxOutputTokens: 1000
});
expect(turn.toolCalls[0]).toMatchObject({ name: "read_file" });
expect(turn.usage?.totalTokens).toBe(120);
```

Also cover malformed arguments, final text response, finish reason, absent tool calls, timeout, and non-tool-capable provider responses.

- [ ] **Step 2: Run focused tests and confirm failure**

Run:

```bash
npm test -- tests/provider.test.ts
```

Expected: FAIL because `runToolTurn` and tool-loop types do not exist.

- [ ] **Step 3: Implement provider tool-turn support**

Add provider-neutral types for tool schemas, conversation messages, normalized tool calls, and per-turn results. Extend `OpenAICompatibleProvider` with `runToolTurn` while preserving `runReport`.

The normalized result must include:

```ts
{
  assistantMessage,
  text,
  toolCalls,
  usage,
  finishReason
}
```

Tool arguments remain raw JSON strings until the explorer validates them.

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- tests/provider.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/provider.ts tests/provider.test.ts
git commit -m "feat: support provider tool-calling turns"
```

### Task 3: Bounded Read-Only Workspace Explorer

**Files:**
- Create: `src/explorer.ts`
- Modify: `src/workspace.ts`
- Modify: `src/types.ts`
- Modify: `src/config.ts`
- Modify: `src/factory.ts`
- Test: `tests/explorer.test.ts`
- Test: `tests/workspace.test.ts`
- Test: `tests/config.test.ts`
- Test: `tests/factory.test.ts`

- [ ] **Step 1: Write failing explorer tests**

Use a scripted fake provider to prove the loop can call:

```text
list_files → search_text → read_file_range → final report
```

Assert:

```ts
expect(result.report.summary).toContain("authentication");
expect(result.exploration).toMatchObject({
  turns: 4,
  toolCalls: 3,
  filesRead: 1
});
expect(result.exploration.sourceBytesRead).toBeGreaterThan(0);
```

Also cover invalid JSON arguments, denied paths, repeated reads, max turns, max files, total-byte limit, bounded search matches, cancellation, and a provider that never produces tool calls or a final report.

- [ ] **Step 2: Run focused tests and confirm failure**

Run:

```bash
npm test -- tests/explorer.test.ts tests/workspace.test.ts tests/config.test.ts tests/factory.test.ts
```

Expected: FAIL because the explorer loop, search/range workspace operations, role, and telemetry do not exist.

- [ ] **Step 3: Implement bounded workspace operations**

Extend `WorkspaceReader` with bounded operations:

```ts
listAllowedFiles(globs?: string[], maxResults?: number): Promise<string[]>
searchAllowedText(query: string, globs: string[] | undefined, maxMatches: number): Promise<SearchMatch[]>
readAllowedFileRange(path: string, lineStart: number, lineEnd: number): Promise<WorkspaceDocument>
```

All operations must reuse deny-first path resolution, binary rejection, file-size limits, total-byte limits, and symlink containment.

- [ ] **Step 4: Implement explorer loop and role compatibility**

Implement `ReadOnlyExplorer.run()` with enforced defaults and hard caps:

```ts
maxTurns: 8
maxFiles: 40
maxTotalBytes: 1_048_576
maxSearchMatches: 100
maxToolResultBytes: 131_072
```

Expose only `list_files`, `search_text`, `read_file`, and `read_file_range`. The system prompt states that the delegate discovers facts and evidence but does not decide implementation.

Add `explore_workspace` job kind and derive a missing explorer role from `file_finder`, then `summarizer`, then the first configured role.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- tests/explorer.test.ts tests/workspace.test.ts tests/config.test.ts tests/factory.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/explorer.ts src/workspace.ts src/types.ts src/config.ts src/factory.ts tests/explorer.test.ts tests/workspace.test.ts tests/config.test.ts tests/factory.test.ts
git commit -m "feat: add bounded read-only explorer"
```

### Task 4: MCP Tool, Job Telemetry, Cache, And Documentation

**Files:**
- Modify: `src/app.ts`
- Modify: `src/jobs.ts`
- Modify: `src/cache.ts`
- Modify: `src/server.ts`
- Modify: `src/types.ts`
- Modify: `README.md`
- Modify: `.external-subagents-mcp.example.json`
- Modify: `scripts/smoke-stdio.mjs`
- Test: `tests/app.test.ts`
- Test: `tests/jobs.test.ts`
- Test: `tests/cache.test.ts`
- Test: `tests/mcp.test.ts`

- [ ] **Step 1: Write failing MCP and telemetry tests**

Prove `delegate_explore_workspace` is listed and returns an asynchronous job. Verify completed and cached jobs preserve:

```ts
exploration: {
  turns,
  toolCalls,
  filesRead,
  sourceBytesRead,
  searchMatchesReturned,
  limitsHit
}
```

Verify compact job summaries include exploration metrics and no source content.

- [ ] **Step 2: Run focused tests and confirm failure**

Run:

```bash
npm test -- tests/app.test.ts tests/jobs.test.ts tests/cache.test.ts tests/mcp.test.ts
```

Expected: FAIL because the MCP tool and telemetry propagation do not exist.

- [ ] **Step 3: Integrate explorer jobs**

Register `delegate_explore_workspace` with bounded schemas. Add `ExternalSubagentsApp.delegateExploreWorkspace`, start it asynchronously, propagate exploration telemetry through jobs and cache, and render compact metrics.

Keep all existing tools backward compatible.

- [ ] **Step 4: Update public documentation and examples**

Document:

- Codex remains project owner.
- Early delegation check.
- Choosing explorer versus existing tools.
- Explorer limits and provider tool-calling requirement.
- CLI instructions installation.
- Failure/fallback behavior.
- Exploration telemetry.

Update the example config with an optional `explorer` role.

- [ ] **Step 5: Run full verification**

Run:

```bash
npm test
npm run typecheck
npm run build
npm run smoke:stdio
npm pack --dry-run
git diff --check
```

Expected: all commands succeed and stdio smoke reports 11 tools.

- [ ] **Step 6: Perform external read-only review**

Delegate a path-based review of changed files to an external reviewer. Codex verifies every actionable finding before modifying code.

- [ ] **Step 7: Commit**

```bash
git add src/app.ts src/jobs.ts src/cache.ts src/server.ts src/types.ts README.md .external-subagents-mcp.example.json scripts/smoke-stdio.mjs tests/app.test.ts tests/jobs.test.ts tests/cache.test.ts tests/mcp.test.ts
git commit -m "feat: expose read-only workspace explorer"
```

### Task 5: Final Integration Review

**Files:**
- Review: all changed files

- [ ] **Step 1: Check spec coverage**

Confirm every acceptance criterion in
`docs/superpowers/specs/2026-06-14-codex-led-worker-pool-design.md` has an
implementation or a documented reason for exclusion.

- [ ] **Step 2: Run final verification**

Run:

```bash
npm test
npm run typecheck
npm run build
npm run smoke:stdio
git status --short
git log --oneline --decorate -8
```

Expected: tests and builds succeed; only intentional changes remain.

- [ ] **Step 3: Commit any review corrections**

```bash
git add <reviewed-files>
git commit -m "fix: address worker-pool integration review"
```
