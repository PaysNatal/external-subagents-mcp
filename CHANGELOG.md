# CHANGELOG

This file records all notable changes to external-subagents-mcp. Each entry describes what changed, why it changed, and the practical effect on users. Entries are grouped by release and ordered from newest to oldest.

The format follows a simplified [Keep a Changelog](https://keepachangelog.com/) structure:

- **feat**: a new feature or capability
- **fix**: a bug fix or correction
- **refactor**: a structural change that does not alter behavior
- **docs**: a documentation or wording change
- **perf**: a change that improves performance or reduces resource consumption

---

## v0.2.0 — 2026-06-13

### feat: explicitly authorized cross-project path delegation

All four read-heavy task tools now accept an optional absolute `workspace_root`. When supplied, the target directory must directly contain `.external-subagents-mcp.json`; the target config contributes only its workspace allow/deny and size policy. Providers, API keys, routing, concurrency, diagnostics, and cache remain controlled by the running MCP server. Target configs whose `workspace.root` escapes the requested project are rejected.

This lets Codex delegate files from its current project by path even when the MCP server was started with a different default config. Large source files no longer need to be copied into `diff_text` merely to cross that boundary.

### feat: expose provider usage and external-call state

OpenAI-compatible `usage.prompt_tokens`, `usage.completion_tokens`, and `usage.total_tokens` fields are normalized when providers return valid non-negative integers. Job records now expose the effective workspace root, input bytes, whether the current request called an external API, and optional provider usage.

Cache-hit jobs report `externalApiCalled: false` while preserving the original run's historical usage. Invalid or absent provider usage is left undefined instead of being estimated as exact token counts. Compact MCP summaries now make API-call and total-token state visible.

### docs: steer Codex toward path-based delegation

Server instructions, task descriptions, and README guidance now tell Codex to prefer paths plus `workspace_root` over embedding large file or log bodies, and document the target-project authorization boundary.

## v0.1.2 — 2026-06-09

### security: selective merge of external security review findings

An external engineer performed a comprehensive security review covering 34 issues across 13 source files. Each proposed change was individually verified and selectively merged based on robustness, usability, and correctness.

**Accepted hardening:**

- **Prompt injection defense** (app.ts): Added anti-injection instruction in `baseInstructions()` and `UNTRUSTED FILE` content markers in `renderDocuments()` to prevent embedded instructions in file content from hijacking model behavior.
- **Workspace walk safety** (workspace.ts): Added depth limit (`MAX_DEPTH = 50`), symlink cycle detection via `visited` Set, EACCES/EPERM graceful handling, dangling symlink detection in `assertInsideWorkspace()`, and selective symlink skipping (external symlinks blocked, internal symlinks preserved).
- **Input length constraints** (server.ts): Added `.max()` constraints on all tool input parameters (focus: 5000, query: 2000, diff_text: 500000, log_text: 1000000, paths/globs: bounded). Changed `delegate_provider_status` inputSchema from bare `{}` to `z.object({})`.
- **Cache file security** (cache.ts): Restrictive file permissions (`0o700` dirs, `0o600` files), write serialization lock to prevent concurrent writes, enhanced error handling distinguishing ENOENT from real errors, and robust `sortForStableStringify` handling null/Date/Map/Set/Buffer.
- **Graceful shutdown** (index.ts): SIGTERM/SIGINT handlers with `shuttingDown` guard, startup error desensitization (details only when `DEBUG=external-subagents-mcp`).
- **Memory cleanup** (jobs.ts): Prompt field cleared (`job.prompt = ""`) after job completion in both success and error paths.
- **Config validation** (config.ts): Added `.max()` limits on max_file_bytes (10MB), max_total_bytes (50MB), max_bytes (1GB), global concurrency (20), per_provider concurrency (10), and timeout_ms (600000).
- **Type cleanup** (types.ts): Removed duplicate `max_output_tokens` from `RoleConfig`, keeping only `maxOutputTokens`.
- **Node engine** (package.json): Bumped minimum Node version to `>=20.3` for `AbortSignal.any()` support.

**Rejected (would harm usability without proportional security benefit):**

- HTTPS-only enforcement (breaks localhost development)
- Removing upward config search (usability regression)
- Removing `wire_api` field (breaking change)
- TTL reduction from 168h to 24h (cost increase)
- Skipping ALL symlinks (breaks legitimate workspace structures)
- Rate limiter (broken design, would stall legitimate work)
- Removing diagnostic fields (essential debugging information)
- 30-minute job TTL auto-cleanup (jobs would disappear before retrieval)
- Provider `dispose()` clearing apiKey (unsafe reference semantics)

## v0.1.1 — 2026-06-09

### fix: add missing completedAt and isolate onComplete callback errors in jobs.ts

When a job failed early due to a missing provider or role configuration, the `completedAt` timestamp was never set, leaving callers unable to determine whether the job had reached a terminal state. Additionally, if the `onComplete` callback (used for cache persistence) threw an error after a job had already been marked completed, the outer catch block would overwrite the successful state to "failed". Both issues are now fixed: early-failure paths set `completedAt`, and the `onComplete` callback is wrapped in its own isolated try/catch so that cache-write failures no longer corrupt the job's actual completion state.

### fix: align routingRuleLabel fallback across diagnostics and jobs

The `routingRuleLabel` helper in `diagnostics.ts` returned `"default"` as its fallback, while the identical function in `jobs.ts` returned `rule.provider`. This inconsistency could cause diagnostic reports to display a different label than the one used internally for routing. Both now use `rule.provider` as the fallback for consistency.

## v0.1.0 — 2026-06-08

### feat: compact-aware output and minimal REPORT_CONTRACT to save Codex tokens

Token-saving changes that address two risks identified by comparing our architecture to cc-switch's translation-layer issues: (1) third-party model JSON format failure causing cheap tokens to be wasted on FAILED reports, and (2) Codex compact compression dropping structured findings/evidence, forcing expensive token re-verification.

**1. Minimal REPORT_CONTRACT**: The prompt sent to external models now requires only `status` and `summary` as mandatory JSON fields. `findings`, `next_actions`, and `omitted` are described as optional but valuable. Models that cannot produce valid nested JSON can still return a useful report, reducing the FAILED report rate for lite-tier models from approximately 30-40% to near-zero.

**2. Fallback findings extractor**: When a report has no findings but contains free text outside the JSON block, the server extracts approximate findings by detecting severity keywords (critical, high, medium, low, info) and file-path patterns (e.g. `src/auth.ts:42-56`). Each extracted finding gets a confidence of 0.3 and the recommendation "Verify manually before acting." This runs at zero additional token cost.

**3. Dual-layer tool result output**: Every MCP tool response now has two layers — a short plain-text summary above a `---` separator, followed by the full JSON. The summary includes status, a one-line conclusion, severity ranking of findings, and evidence file paths. If Codex compact drops the JSON structure, the summary line still preserves the key conclusions. Adds approximately 50-80 tokens per response but can save 1000-3000 expensive Codex tokens that would otherwise be spent re-reading files to locate evidence.

**4. Compact retention guidance**: SERVER_INSTRUCTIONS now includes an explicit instruction telling Codex to preserve the plain-text summary line when compacting context, because it holds the key conclusions and file references needed for verification.

**5. Findings severity descending sort**: All findings in delegate reports are now sorted high → medium → low → info before returning. If compact truncates the findings list, the most important findings survive first.

### feat: add delegate_cancel tool

Added `delegate_cancel` to cancel a queued or running delegate job. Already-completed or failed jobs are left intact. This gives Codex the ability to abort in-flight work that is no longer needed.

### docs: rewrite Profiles section with clear 2+1 structure

The README Profiles section now explains the system as two building blocks: three providers (lite/standard/pro — the models that do the work) and three default profiles (single_provider/cost_first/quality_first — the task distribution plans that assign four roles to those providers). Added role-to-provider mapping tables with "best for" columns, a custom profile example, and explicit Chinese translations. Both English and Chinese sections updated.

### refactor: rename providers from primary/bulk/quality to standard/lite/pro

Replaced the three-tier provider naming across the entire project to make the cost-quality relationship unambiguous. `primary` → `standard` (default quality, balanced cost), `bulk` → `lite` (low-cost, fast), `quality` → `pro` (highest quality, higher cost). Environment variables renamed accordingly: `EXTERNAL_SUBAGENTS_PRIMARY_API_KEY` → `EXTERNAL_SUBAGENTS_STANDARD_API_KEY`, `EXTERNAL_SUBAGENTS_BULK_API_KEY` → `EXTERNAL_SUBAGENTS_LITE_API_KEY`, `EXTERNAL_SUBAGENTS_QUALITY_API_KEY` → `EXTERNAL_SUBAGENTS_PRO_API_KEY`. Updated example config, README, and all test fixtures.

### feat: optimize MCP tool descriptions for accurate Codex tool discovery

Rewrote all 10 MCP tool descriptions and titles to include trigger keywords (debug, search, compress, review, etc.), added `.describe()` annotations on every input schema parameter, resolved the "status" ambiguity between `delegate_provider_status` and `delegate_status`, removed redundant "Returns an async job record" boilerplate, and removed implementation detail ("external OpenAI-compatible model") that wastes Codex's discovery tokens. Added an explicit Tool selection guide in SERVER_INSTRUCTIONS mapping intent phrases to tool names.

### feat: add finding reasoning chain fields and polish package for npm publish

Added `phase` (discovery/analysis/verification/recommendation) and `depends_on` (cross-reference to earlier findings) to DelegateFinding type, delegateReportSchema, and REPORT_CONTRACT. These fields let Codex audit whether a sub-agent's reasoning chain is internally consistent before acting on the report, reducing the risk of building on incorrect foundations. Also excluded source maps from npm package (dist/**/*.js and dist/**/*.d.ts only — package size reduced 38%), and added repository/homepage/bugs/author fields to package.json.

### docs: simplify setup and add config init

Someone else rewrote the README to be beginner-friendly: added an `init` CLI command that copies the example config to the project root, step-by-step environment variable setup with macOS/Linux/Windows persistence instructions, semantic provider names, and prominent Profiles section.

### feat: harden provider endpoint compatibility

Added `resolveChatCompletionsUrl` to correctly handle providers whose baseUrl already includes the chat/completions path (e.g. DeepSeek) and providers with nonstandard paths (e.g. MiniMax). Previously these would produce double-pathed or broken URLs.

### feat: add dynamic output budgets

Added `budget_rules` to routing config. When a task's input exceeds a size threshold, the output budget is automatically increased so the external model has enough room to respond thoroughly, without the user having to manually adjust `max_output_tokens`.

### feat: add provider diagnostics

Added `delegate_provider_status` and `delegate_provider_smoke` tools, plus `doctor` and `smoke` CLI commands. These let users verify API keys, routing, and model connectivity before delegating expensive work, avoiding wasted tokens on misconfigured providers.

### feat: add profile and auto provider routing

Added `profiles` (role-to-provider assignment maps) and `routing.mode = "auto"` with `auto_rules` (first-match routing by job kind, role, or input size). Users can switch strategies with one config line instead of editing individual role assignments.

### fix: require keys only for active providers

API keys are now lazy by provider use. A missing key for an unused provider does not prevent startup; only jobs that actually route to that provider fail clearly.

### feat: scaffold external subagents mcp

Initial project setup with core MCP stdio server, workspace file reading with allow/deny rules, provider abstraction for OpenAI-compatible chat completions, async job management, caching, and 5 delegate tools (summarize_paths, review_diff, find_relevant_files, analyze_log, and wait).
