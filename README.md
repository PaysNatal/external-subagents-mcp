# external-subagents-mcp

A read-only MCP server that lets Codex delegate large-context review and summarization work to external OpenAI-compatible models such as GLM or MiMo.

Codex stays in charge of editing files, running shell commands, applying patches, approvals, and final judgment. External models act only as advisory explorer/reviewer/summarizer/log analyst delegates.

## Why MCP, not a Codex plugin?

This is distributed as an independent MCP server so users explicitly configure local file access, API keys, and model routing. That is a better fit for workflows that read local project files and call third-party model APIs.

## Install

```bash
npm install -g external-subagents-mcp
```

During local development:

```bash
npm install
npm run build
```

## Configure

Create `.external-subagents-mcp.json` in your project root, or set `EXTERNAL_SUBAGENTS_CONFIG` to an absolute config path.

```json
{
  "workspace": {
    "allow": ["src/**", "tests/**", "docs/**", "package.json", "README.md"],
    "deny": ["**/.env*", "**/node_modules/**", "**/dist/**", "**/*.pem"],
    "max_file_bytes": 262144,
    "max_total_bytes": 2097152
  },
  "cache": {
    "dir": ".external-subagents/cache",
    "ttl_hours": 168,
    "max_bytes": 524288000
  },
  "concurrency": {
    "global": 3,
    "per_provider": 2
  },
  "providers": {
    "glm": {
      "base_url": "https://api.z.ai/api/paas/v4",
      "api_key_env": "ZAI_API_KEY",
      "model": "glm-5.1",
      "wire_api": "chat_completions"
    },
    "mimo": {
      "base_url": "https://token-plan-cn.xiaomimimo.com/v1",
      "api_key_env": "MIMO_API_KEY",
      "model": "mimo-v2.5-pro",
      "wire_api": "chat_completions"
    },
    "fast": {
      "base_url": "https://api.example.com/v1",
      "api_key_env": "FAST_API_KEY",
      "model": "fast-code-model",
      "wire_api": "chat_completions"
    }
  },
  "routing": {
    "profile": "code_quality_first",
    "mode": "auto",
    "auto_rules": [
      { "kind": "find_relevant_files", "provider": "fast", "max_output_tokens": 1200 },
      { "role": "log_analyst", "min_input_bytes": 100000, "provider": "glm", "max_output_tokens": 3000 }
    ]
  },
  "profiles": {
    "cost_first": {
      "summarizer": "mimo",
      "reviewer": { "provider": "glm", "max_output_tokens": 3000 },
      "log_analyst": "mimo",
      "file_finder": "mimo"
    },
    "code_quality_first": {
      "summarizer": { "provider": "mimo", "max_output_tokens": 2000 },
      "reviewer": { "provider": "glm", "max_output_tokens": 3000 },
      "log_analyst": { "provider": "glm", "max_output_tokens": 2500 },
      "file_finder": { "provider": "glm", "max_output_tokens": 1800 }
    },
    "balanced_three_model": {
      "summarizer": "mimo",
      "reviewer": { "provider": "glm", "max_output_tokens": 3000 },
      "log_analyst": { "provider": "glm", "max_output_tokens": 2500 },
      "file_finder": { "provider": "fast", "max_output_tokens": 1200 }
    }
  }
}
```

API keys must stay in environment variables:

```bash
export ZAI_API_KEY=...
export MIMO_API_KEY=...
```

For MiMo Token Plan, set `base_url` to the Base URL shown on the subscription page. Current regional examples are:

- China: `https://token-plan-cn.xiaomimimo.com/v1`
- Singapore: `https://token-plan-sgp.xiaomimimo.com/v1`
- Europe: `https://token-plan-ams.xiaomimimo.com/v1`

If you are testing MiMo only, point every role at `mimo` and only `MIMO_API_KEY` is required. The `model` value should match the model UID shown for your token plan when MiMo provides a plan-specific UID.

Z.AI setup notes:

- General OpenAI-compatible endpoint: `https://api.z.ai/api/paas/v4`
- GLM Coding Plan endpoint: `https://api.z.ai/api/coding/paas/v4`
- The Z.AI docs currently show `glm-5.1` with chat completions examples.
- Prefer the Base URL shown in your Z.AI console or plan page, then verify with `smoke`.

Official references:

- Z.AI API introduction: https://docs.z.ai/api-reference/introduction
- MiMo Token Plan subscription instructions: https://platform.xiaomimimo.com/docs/en-US/tokenplan/subscription

### Profiles and routing

Use `profiles` when you have two or more providers and want a one-line strategy switch:

- `cost_first`: MiMo handles bulk summary/log/file discovery; GLM handles code review.
- `code_quality_first`: GLM handles code review, log analysis, and file discovery; MiMo handles bulk summarization.
- `balanced_three_model`: a third fast/cheap model handles file discovery; GLM handles code judgment; MiMo handles summarization.

Set the active strategy with:

```json
{
  "routing": { "profile": "code_quality_first" }
}
```

`routing.mode = "auto"` adds first-match provider selection rules on top of the active profile. Auto routing only chooses the provider and optional output budget. It does not summarize, compress, rewrite, or otherwise transform the prompt before sending it to the selected provider.

```json
{
  "routing": {
    "profile": "code_quality_first",
    "mode": "auto",
    "auto_rules": [
      { "kind": "find_relevant_files", "provider": "fast" },
      { "role": "log_analyst", "min_input_bytes": 100000, "provider": "glm", "max_output_tokens": 3000 }
    ]
  }
}
```

API keys are lazy by provider use. Missing keys do not prevent server startup; a job fails clearly only if it routes to a provider whose `api_key_env` is not set. Cached results can still be read without the provider key.

## Provider diagnostics

Use `doctor` before connecting Codex or after changing keys/base URLs:

```bash
external-subagents-mcp doctor
external-subagents-mcp doctor --json
```

The report shows:

- which providers are configured
- which providers are used by the active profile or auto rules
- which `api_key_env` variables are set or missing
- issues without printing secrets

Smoke-test one provider with a minimal chat completion call:

```bash
external-subagents-mcp smoke --provider mimo
external-subagents-mcp smoke --provider glm --json
```

During local development:

```bash
npm run build
node dist/index.js doctor --json
node dist/index.js smoke --provider mimo --json
```

## Codex MCP config

Add the stdio server to Codex:

```toml
[mcp_servers.external_subagents]
command = "npx"
args = ["-y", "external-subagents-mcp"]
env_vars = ["ZAI_API_KEY", "MIMO_API_KEY", "EXTERNAL_SUBAGENTS_CONFIG"]
startup_timeout_sec = 20
tool_timeout_sec = 300
```

For local development, point Codex at the built CLI:

```toml
[mcp_servers.external_subagents]
command = "node"
args = ["/absolute/path/to/external-subagents-mcp/dist/index.js"]
env_vars = ["ZAI_API_KEY", "MIMO_API_KEY", "EXTERNAL_SUBAGENTS_CONFIG"]
```

## Tools

- `delegate_summarize_paths`: read allowed paths and summarize them.
- `delegate_review_diff`: review supplied diff text and optional file context.
- `delegate_find_relevant_files`: rank allowed files for a query.
- `delegate_analyze_log`: analyze supplied log text or an allowed log path.
- `delegate_provider_status`: inspect active routing, provider usage, and key status without exposing secrets.
- `delegate_provider_smoke`: smoke-test one provider with a minimal chat completion call.
- `delegate_wait`: wait for async jobs.
- `delegate_result`: fetch one job result.
- `delegate_status`: list job statuses.
- `delegate_cancel`: cancel queued or running work.

All task tools return a job record. Use `delegate_wait` and `delegate_result` to retrieve the structured report.

## Safety model

- Read-only: no shell, no patches, no file writes to the repo.
- Deny rules win over allow rules.
- Default deny rules block `.env`, dependencies, build output, keys, certs, archives, images, PDFs, and git internals.
- Symlinks may not escape the workspace root.
- Cache stores input hashes and model reports, not raw source text.
- External model reports are advisory. Codex should verify cited files and lines before editing.

## Superpowers-style use

When Codex is following Superpowers workflows such as `dispatching-parallel-agents` or `subagent-driven-development`, use this MCP for read-heavy explorer/reviewer/log analyst/file finder work. Do not use it as an implementer.

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

The implementation uses the stable `@modelcontextprotocol/sdk` package. The scoped `@modelcontextprotocol/server` package currently exists on npm only as an alpha package, so this project uses the official stable SDK package for the first release.
