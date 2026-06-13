# Workspace Routing and Usage Telemetry Design

## Goal

Make path-based delegation work safely across Codex projects while exposing enough provider usage data to measure whether delegation actually saves expensive-model context.

This iteration becomes `v0.2.0` because it extends every read-heavy task tool's public input and every job record's public output.

## Scope

The iteration adds:

- An optional `workspace_root` input to `delegate_summarize_paths`, `delegate_review_diff`, `delegate_find_relevant_files`, and `delegate_analyze_log`.
- Explicit target-project authorization through a `.external-subagents-mcp.json` file located directly in the requested root.
- Per-job provider usage telemetry when the OpenAI-compatible provider returns usage fields.
- Clear cache-call semantics and input-size metadata.
- MCP instructions and documentation that steer Codex toward `workspace_root` plus paths instead of embedding large source text.

The iteration does not add:

- Shell or Git execution inside the MCP.
- Multi-stage summarization or prompt compression.
- Streaming checkpoints.
- Automatic discovery of arbitrary project roots.
- Provider pricing or estimated monetary savings.
- A Codex plugin wrapper.

## Workspace Authorization Model

Each task tool accepts an optional absolute `workspace_root`.

When omitted, the server uses the workspace from its startup configuration exactly as it does today.

When supplied:

1. The path must be absolute.
2. The requested directory must exist and resolve to a directory.
3. The directory must directly contain `.external-subagents-mcp.json`. Upward config search is not used.
4. The target config is parsed with the normal strict schema.
5. Only the target config's normalized `workspace` section is used for file access.
6. The target config's normalized workspace root must remain inside the requested directory. A `workspace.root` pointing outside is rejected.
7. Providers, roles, routing, concurrency, API keys, diagnostics, and cache remain controlled by the MCP server's startup configuration.

This makes the target project's config an explicit local authorization marker without allowing a project to silently change which external API receives its source.

The effective workspace root is included in the cache input. Identical relative paths from different projects therefore cannot collide.

## Architecture

`WorkspaceResolver` becomes the boundary between task inputs and safe file access.

- `createWorkspace(config)` continues to create one `WorkspaceReader`.
- `createWorkspaceResolver(config)` owns the default reader and resolves optional requested roots.
- `ExternalSubagentsApp` requests an effective workspace before reading paths or listing candidates.
- The resolver returns both the reader and authorization metadata needed for cache identity and job telemetry.

The app continues to assemble prompts and start jobs. It does not parse target configs itself.

## Provider Usage Telemetry

Provider execution returns a new `ProviderRunResult`:

```ts
{
  report: DelegateReport;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}
```

The OpenAI-compatible client reads these common response fields:

- `usage.prompt_tokens`
- `usage.completion_tokens`
- `usage.total_tokens`

Each field is optional because compatible providers vary. Values must be finite, non-negative integers. Invalid values are ignored rather than causing an otherwise useful report to fail.

`JobRecord` adds:

- `workspaceRoot?: string`
- `inputBytes?: number`
- `externalApiCalled: boolean`
- `usage?: ProviderUsage`

For normal provider jobs, `externalApiCalled` is `true` once provider execution begins. For cache hits it is `false`. Failed HTTP attempts still count as external API calls, but usage remains absent unless the provider supplied valid usage.

No exact token estimate is fabricated when a provider omits usage. `inputBytes` remains available for rough human analysis.

Cached results persist the original provider usage as historical metadata. A cache-hit job exposes that usage while also setting `externalApiCalled: false`, making it clear that those tokens were consumed by the original run, not the current request.

## MCP Output and Guidance

Task tool descriptions explain that:

- `workspace_root` is an absolute target project root.
- The target root must contain `.external-subagents-mcp.json`.
- Path-based delegation is preferred over embedding large `diff_text` or `log_text` when the files are available.

Server instructions tell Codex to pass the current project root for cross-project path tasks. Compact job summaries include provider, elapsed time, external API call state, and usage totals when available.

## Error Handling

Workspace authorization failures occur before provider execution and before a job is queued. Errors clearly distinguish:

- non-absolute root
- missing or non-directory root
- missing direct authorization config
- invalid target config
- target `workspace.root` escaping the requested project root
- denied, oversized, binary, or escaping file paths

Provider usage parsing never converts a successful report into a failure.

## Testing

Tests cover:

- Default workspace behavior remains unchanged.
- A directly authorized second workspace can be summarized by path.
- Missing direct config, relative roots, and escaping target workspace roots are rejected.
- Cache identity differs across workspace roots.
- Provider usage fields are normalized and attached to completed jobs.
- Invalid or absent usage fields are ignored.
- Cache hits set `externalApiCalled: false` while retaining historical usage.
- Failed provider attempts set `externalApiCalled: true`.
- MCP tool schemas expose `workspace_root`.
- Compact summaries expose call state and token totals.
- Full test suite, typecheck, build, and stdio smoke test pass.

## Compatibility and Release

Existing configs and tool calls remain valid because `workspace_root` is optional. Existing third-party `ProviderClient` implementations need to return `ProviderRunResult`, making this a TypeScript API change but not an MCP wire break.

The release updates the package and server version to `0.2.0`, adds a changelog entry, and documents the cross-project authorization and telemetry behavior.
