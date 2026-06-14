# Codex-Led External Worker Pool Design

## Summary

`external-subagents-mcp` will remain a read-only labor pool led by Codex.

Codex is always responsible for understanding the user's goal, planning,
architectural judgment, implementation decisions, file edits, shell commands,
approvals, verification, and final acceptance. External delegates perform
bounded repetitive, simple, or high-context work and return evidence-backed
advice. They do not own the project or choose the final implementation.

This design improves delegation timing and introduces a bounded read-only
exploration loop without granting external models write or shell access.

## Goals

- Make Codex decide whether to delegate before it reads large amounts of source.
- Delegate useful labor early without transferring project ownership.
- Let an external model independently search and read an authorized workspace
  for one focused investigation.
- Reduce repeated Codex-to-MCP round trips for file discovery followed by
  summaries.
- Preserve the existing provider-neutral routing, authorization, cache,
  recovery, telemetry, and unified report model.
- Make failures cheap: Codex immediately takes over when delegation is
  unavailable, low-quality, or repeatedly unsuccessful.

## Non-Goals

- External models will not edit files, apply patches, run shell commands,
  install packages, execute tests, perform migrations, or publish releases.
- External models will not own entire projects, choose architecture, approve
  implementation plans, or make final decisions.
- The MCP server will not attempt to enforce Codex behavior technically.
  Delegation timing is guided through server instructions and installable
  Codex instructions.
- The first version will not provide streaming checkpoints or interactive
  mid-task clarification.

## Responsibility Boundary

### Codex Responsibilities

- Understand the user request and identify success criteria.
- Decide whether delegation is economical and appropriate.
- Split work into bounded labor units.
- Perform planning, architecture, trade-off analysis, and final judgment.
- Verify external evidence before using it.
- Make all repository changes and run all commands.
- Own testing, acceptance, communication, and fallback behavior.

### External Delegate Responsibilities

- Search authorized files for a focused question.
- Read and summarize large source sets.
- Extract facts, symbols, relationships, patterns, and evidence.
- Analyze logs and repetitive data.
- Perform initial review and enumerate possible concerns.
- Return concise evidence-backed reports for Codex to evaluate.

## Delegation Timing Protocol

For every non-trivial task, Codex performs an early delegation check before
large source reads, content grep, or log ingestion.

Codex may inspect lightweight scope metadata first:

- directory and file names
- file counts and sizes
- repository status
- user-provided task context
- external documentation

Codex should delegate when there is a focused labor unit that is:

- repetitive or mechanical
- primarily search, reading, extraction, summarization, or initial review
- likely to consume substantial main-model context
- independently verifiable by Codex

Codex should keep the work when it is:

- architectural or requires cross-domain judgment
- a root-cause investigation requiring tight iterative reasoning
- a tiny task whose delegation overhead exceeds the likely benefit
- dependent on sensitive or unavailable context
- explicitly requested by the user to remain with Codex

Delegation is not mandatory merely because a task touches multiple files. Codex
remains responsible for deciding whether the labor unit is economical.

## Installable Codex Instructions

The package will provide a generated instruction block that teaches Codex when
and how to use the MCP tools.

New CLI commands:

```bash
external-subagents-mcp codex-instructions
external-subagents-mcp install-codex-instructions
```

`codex-instructions` prints the maintained instruction block to stdout.

`install-codex-instructions` installs or updates a clearly marked block in
`~/.codex/instructions.md`. It must:

- preserve unrelated user content
- be idempotent
- refuse ambiguous or malformed existing markers
- support a dry-run mode
- never modify project `AGENTS.md` automatically

The instruction block defines:

- the Codex/external delegate responsibility boundary
- the early delegation check
- suitable and unsuitable labor units
- preferred path-based calls
- verification and fallback behavior
- explicit user controls such as "do not delegate"

MCP server instructions will contain a shorter equivalent policy so clients
that do not install the Codex instructions still receive basic guidance.

## Read-Only Exploration Loop

### New Tool

```text
delegate_explore_workspace
```

Input:

```json
{
  "workspace_root": "/absolute/project/root",
  "question": "Focused investigation question",
  "scope_globs": ["src/**/*.ts", "tests/**/*.ts"],
  "focus": "Facts and evidence Codex needs",
  "max_turns": 8,
  "max_files": 40,
  "max_total_bytes": 1048576,
  "output_budget": 2500,
  "cache_mode": "read_write"
}
```

The external model receives a small tool loop with read-only operations:

- `list_files`
- `search_text`
- `read_file`
- `read_file_range`

The loop cannot access any path or content that the existing workspace policy
would deny. Every operation is additionally bounded by the exploration limits.

### Exploration Limits

Limits are enforced by the MCP server, not merely requested in prompts:

- maximum model turns
- maximum files opened
- maximum total source bytes read
- maximum search matches returned
- maximum bytes returned by one tool call
- maximum final report output tokens
- provider timeout and cancellation signal

When a limit is reached, the delegate must return the best available report and
record the limit under `omitted`.

### Exploration Output

The result uses the existing `DelegateReport` and recovery pipeline.

Evidence must cite paths and line ranges whenever available. Findings are
advisory. The report should emphasize discovered facts and uncertainty rather
than deciding implementation.

Exploration-specific job telemetry includes:

```json
{
  "exploration": {
    "turns": 6,
    "toolCalls": 11,
    "filesRead": 8,
    "sourceBytesRead": 84231,
    "searchMatchesReturned": 54,
    "limitsHit": []
  }
}
```

## Tool Suite Positioning

Existing task tools remain useful:

- `delegate_summarize_paths`: Codex already knows the exact files.
- `delegate_review_diff`: Codex wants initial review of known code or a diff.
- `delegate_find_relevant_files`: cheap filename-only ranking.
- `delegate_analyze_log`: a log source is already known.
- `delegate_explore_workspace`: the question is focused, but relevant files and
  relationships are not yet known.

The exploration tool must not replace all other tools. It has higher startup
cost and should be used only when autonomous read-only exploration avoids
several main-model reads or multiple MCP calls.

## Provider Routing

Add the job kind `explore_workspace` and role `explorer`.

The role uses the existing provider/profile/auto-routing system. Example:

```json
{
  "roles": {
    "explorer": {
      "provider": "mimo",
      "max_output_tokens": 2500
    }
  }
}
```

Existing configurations without an explicit `explorer` role remain valid. The
server derives it from the first available role in this order:

1. `file_finder`
2. `summarizer`
3. first configured role

Provider compatibility must be checked because the exploration loop requires
OpenAI-compatible tool calling. Providers that do not return usable tool calls
produce a structured `BLOCKED` report, and Codex takes over.

## Failure And Fallback Policy

- Missing provider or API key: Codex takes over immediately.
- Provider/network failure: no automatic repeated task delegation; Codex takes
  over or explicitly retries once.
- Repaired or salvaged report: Codex uses available evidence and decides
  whether missing context justifies another call.
- Exploration limit reached: return partial evidence with explicit omissions.
- Low-quality evidence twice in one session: Codex stops delegating similar
  work during that session.
- External report contradicts verified source: Codex trusts verified source.

## Security

- Existing deny-first workspace authorization remains mandatory.
- The target root must directly contain `.external-subagents-mcp.json`.
- No write, edit, shell, network, package-install, or test tools are exposed to
  external models.
- Tool arguments are validated and resolved inside the authorized workspace.
- Symlinks cannot escape the workspace.
- Raw file content is not written to cache or logs.
- Telemetry records paths, counts, byte totals, provider usage, and reports,
  but not source text or prompts.
- Existing prompt-injection defenses remain active for all file content.

## Delegation Effectiveness Telemetry

Jobs will expose enough data for Codex and users to assess whether delegation
was useful:

- provider and route
- external API call state
- input and output token usage
- elapsed time
- cache hit
- report recovery mode
- exploration turns and tool calls
- files and source bytes read
- enforced limits reached

The server will not claim exact main-model token savings because Codex does not
expose reliable per-tool main-model token accounting.

## Testing

### Unit Tests

- Codex instruction rendering and idempotent installation.
- Marker collision and malformed-marker refusal.
- New role and job-kind routing compatibility.
- Exploration limit accounting.
- Denied paths, binary files, large files, and symlink escape attempts.
- Read ranges and bounded search results.
- Tool-call argument validation.
- Provider without tool-calling support.
- Exploration telemetry and cache serialization.

### Integration Tests

- MCP tools list includes `delegate_explore_workspace`.
- External model mock performs several read-only calls and returns a report.
- Cancellation stops an exploration loop.
- A limit-hit exploration returns a partial usable report.
- Existing configurations without `explorer` continue to start.
- Existing four task tools preserve behavior.

### Scenario Tests

- Codex delegates early repository discovery before reading source.
- A known-file task uses `delegate_summarize_paths`, not exploration.
- A tiny task stays with Codex.
- An architectural decision stays with Codex.
- A failed exploration causes immediate Codex takeover.
- No external operation can modify the workspace.

## Delivery Phases

### Phase 1: Delegation Timing

- Add maintained Codex instruction template.
- Add print/install CLI commands.
- Update MCP server instructions and README.
- Add tests for installation and guidance.

### Phase 2: Read-Only Explorer

- Add explorer role and job kind.
- Add bounded read-only exploration tools and loop.
- Add `delegate_explore_workspace`.
- Add telemetry, cancellation, caching, and tests.

### Phase 3: Effectiveness Feedback

- Improve job summaries with exploration metrics.
- Document economic selection guidance.
- Add scenario benchmarks comparing direct reads with early delegation.

## Acceptance Criteria

- Codex receives explicit guidance to consider delegation before large reads.
- Users can install or print that guidance without installing a marketplace
  plugin.
- External delegates can independently investigate a focused question using
  only bounded read-only tools.
- Codex remains solely responsible for decisions, edits, commands, and
  acceptance.
- Existing configurations and task tools remain backward compatible.
- External delegates cannot modify or execute anything in the workspace.
- Failure and partial-result behavior is visible, bounded, and recoverable.
