# Changelog

All notable changes to `external-subagents-mcp` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The project uses semantic versioning for published npm releases.

## [0.3.1] - 2026-06-18

### Changed

- Reframed MCP server instructions so Codex treats external delegates as the
  default path for read-heavy file discovery, summarization, log analysis, and
  initial review.
- Rewrote installed Codex instructions to present delegation as the default for
  bounded read-heavy labor while keeping Codex responsible for decisions,
  edits, commands, verification, and acceptance.
- Strengthened task-tool descriptions with explicit `Use WHEN` triggers and
  context-saving benefits.
- Softened provider status and smoke-test wording so those diagnostics read as
  optional session-start checks, not mandatory gates before every delegation.

### Security

- Updated the transitive `hono` dependency in the lockfile to address published
  advisories affecting versions below `4.12.25`.

## [0.3.0] - 2026-06-15

### Added

- Added `delegate_explore_workspace`, a bounded multi-turn read-only explorer
  for focused investigation of unfamiliar repositories.
- Added OpenAI-compatible tool-calling support for external providers.
- Added read-only explorer tools for file listing, bounded text search, full
  file reads, and line-range reads.
- Added the `explorer` role and `explore_workspace` job kind to profiles,
  automatic routing, dynamic budgets, caching, cancellation, and async jobs.
- Added backward-compatible explorer-role derivation for existing configs:
  `file_finder`, then `summarizer`, then the first configured role.
- Added exploration telemetry for turns, tool calls, files read, source bytes,
  search matches, and limits reached.
- Added installable Codex delegation guidance:
  `codex-instructions` and `install-codex-instructions`.
- Added a dedicated complete configuration reference and Chinese user guide.

### Changed

- Clarified the core responsibility boundary: Codex owns understanding,
  planning, decisions, edits, commands, testing, verification, and acceptance;
  external delegates are a read-only labor pool.
- Encouraged an early delegation check before large source reads, content
  searches, and log ingestion.
- Improved compact job summaries with exploration metrics and accurate
  external API-call state.
- Reframed the README as a concise product homepage focused on Codex users and
  cost-conscious high-context work.
- Expanded the generated config's deny list to match the built-in safe
  workspace defaults.

### Fixed

- Explorer jobs that stop locally because the provider lacks tool calling no
  longer report a false external API call.
- Search-result truncation is now visible in exploration telemetry and report
  omissions.

## [0.2.1] - 2026-06-14

### Added

- Added progressive provider-output recovery: strict JSON parsing, JSON repair,
  complete-finding salvage, structured-text extraction, and bounded raw-advice
  fallback.
- Added recovery metadata to jobs and cache entries, including parse mode,
  truncation state, discarded tail bytes, warnings, and estimated completeness.

### Changed

- Made external-model output more tolerant of malformed JSON, incomplete nested
  fields, and truncated responses.
- Preserved useful recovered reports instead of automatically discarding or
  retrying them.
- Exposed recovery state in compact MCP summaries so Codex can decide whether
  additional context is worth another call.

## [0.2.0] - 2026-06-13

### Added

- Added explicitly authorized cross-project path delegation through
  `workspace_root`.
- Added normalized provider token usage and `externalApiCalled` job telemetry.
- Added effective workspace root and input-byte telemetry.

### Changed

- Made path-based delegation the preferred workflow so large source and logs do
  not need to be copied into Codex tool calls.
- Made cache hits report `externalApiCalled: false` while preserving historical
  usage from the original run.
- Kept providers, keys, routing, concurrency, and cache under the running
  server's control when reading an authorized second project.

### Security

- Required cross-project roots to directly contain
  `.external-subagents-mcp.json`.
- Rejected target `workspace.root` values that escape the explicitly requested
  project.

## [0.1.2] - 2026-06-09

### Security

- Added prompt-injection defenses and explicit untrusted-file markers.
- Hardened workspace walking with depth limits, symlink-cycle detection,
  escape prevention, and graceful permission handling.
- Added bounded MCP input schemas and configuration limits.
- Added restrictive cache permissions and serialized cache writes.
- Added graceful shutdown and desensitized startup errors.
- Cleared completed job prompts from memory.

### Changed

- Raised the minimum Node.js version to 20.3.
- Preserved useful internal symlinks while blocking escapes.

## [0.1.1] - 2026-06-09

### Fixed

- Ensured early job failures receive a completion timestamp.
- Prevented cache-write callback failures from overwriting successful job
  states.
- Aligned routing-rule labels between diagnostics and job execution.

## [0.1.0] - 2026-06-08

### Added

- Added the TypeScript stdio MCP server, OpenAI-compatible provider client,
  async job manager, disk cache, and deny-first workspace reader.
- Added task tools for known-file summarization, diff review, candidate-file
  ranking, log analysis, waiting, results, status, cancellation, and provider
  diagnostics.
- Added roles, reusable profiles, automatic provider routing, dynamic output
  budgets, and lazy API-key requirements.
- Added provider endpoint compatibility for standard and nonstandard
  chat-completions paths.
- Added compact-aware dual-layer MCP output and severity-sorted findings.
- Added optional finding `phase` and `depends_on` fields.
- Added the `init`, `doctor`, and `smoke` CLI commands.

### Changed

- Adopted `standard`, `lite`, and `pro` as provider-routing labels.
- Reduced the minimum required external report contract to `status` and
  `summary`, allowing more third-party models to return useful partial reports.

[0.3.1]: https://github.com/PaysNatal/external-subagents-mcp/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/PaysNatal/external-subagents-mcp/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/PaysNatal/external-subagents-mcp/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/PaysNatal/external-subagents-mcp/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/PaysNatal/external-subagents-mcp/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/PaysNatal/external-subagents-mcp/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/PaysNatal/external-subagents-mcp/releases/tag/v0.1.0
