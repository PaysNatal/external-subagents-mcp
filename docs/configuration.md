# Complete Configuration Guide

[Project homepage](../README.md) · [中文指南](README.zh-CN.md) · [Changelog](../CHANGELOG.md)

This guide documents every supported configuration area in
`external-subagents-mcp`. For the shortest working setup, start with the
[five-minute setup](../README.md#five-minute-setup).

## Configuration Lookup

The server loads one JSON configuration using this order:

1. The file path in `EXTERNAL_SUBAGENTS_CONFIG`
2. `.external-subagents-mcp.json`, searched upward from the current directory
3. `~/.config/external-subagents-mcp/config.json`

The directory containing the selected project config is the default workspace
unless `workspace.root` narrows it to a subdirectory.

API keys are never accepted inside the JSON config. They are read only from
environment variables named by each provider's `api_key_env`.

## Initialize A Project

Run `init` from the root of the project external workers may read:

```bash
cd /path/to/your-project
external-subagents-mcp init
```

This copies the packaged example to:

```text
/path/to/your-project/.external-subagents-mcp.json
```

`init` refuses to overwrite an existing config. The generated file includes
safe workspace defaults, three example providers, and three routing profiles.

The config also acts as an explicit authorization marker. When Codex asks the
running server to read a different project through `workspace_root`, that
project root must directly contain `.external-subagents-mcp.json`.

## Providers

Providers are named OpenAI-compatible chat-completions endpoints:

```json
{
  "providers": {
    "standard": {
      "base_url": "https://your-provider.example/v1",
      "api_key_env": "EXTERNAL_SUBAGENTS_STANDARD_API_KEY",
      "model": "your-model-name",
      "wire_api": "chat_completions",
      "timeout_ms": 120000
    }
  }
}
```

| Field | Required | Meaning |
|---|---:|---|
| `base_url` | yes | Provider API base URL |
| `api_key_env` | yes | Name of the environment variable containing the secret |
| `model` | yes | Provider model identifier |
| `wire_api` | no | Currently only `chat_completions`; defaults to it |
| `chat_completions_path` | no | Override for a provider's nonstandard completion path |
| `timeout_ms` | no | Request timeout; default `120000`, maximum `600000` |

`wire_api` is validated as a compatibility marker, not a protocol switch in
0.3.x. The only implemented wire API is OpenAI-compatible
`chat_completions`.

The server normally appends `chat/completions` to `base_url`. It also handles a
base URL that already includes the completion path. Set
`chat_completions_path` only when the provider uses a different path.

Provider names such as `standard`, `lite`, and `pro` are routing labels, not
vendor names. Each may point to any compatible provider. You may add or remove
providers freely.

Keys are lazy by actual provider use. A missing key for an unused provider does
not prevent the server from starting; a job fails clearly only when active
routing selects that provider.

## API Key Environment Variables

The config stores the variable name:

```json
"api_key_env": "EXTERNAL_SUBAGENTS_STANDARD_API_KEY"
```

The environment stores the real key:

```bash
export EXTERNAL_SUBAGENTS_STANDARD_API_KEY="your-api-key"
```

Never write the secret into `.external-subagents-mcp.json`, Codex
`config.toml`, or a committed project file.

### Persistent macOS And Linux Setup

Keep the secret file outside the project:

```bash
mkdir -p ~/.config/external-subagents-mcp
chmod 700 ~/.config/external-subagents-mcp
${EDITOR:-nano} ~/.config/external-subagents-mcp/env
```

Add only the providers you use:

```bash
export EXTERNAL_SUBAGENTS_STANDARD_API_KEY="your-api-key"
export EXTERNAL_SUBAGENTS_LITE_API_KEY="your-api-key"
export EXTERNAL_SUBAGENTS_PRO_API_KEY="your-api-key"
```

Protect and load it:

```bash
chmod 600 ~/.config/external-subagents-mcp/env
echo 'source "$HOME/.config/external-subagents-mcp/env"' >> ~/.zshrc
source ~/.zshrc
```

Use `~/.bashrc` instead of `~/.zshrc` when Bash is your shell. Restart Codex
after changing persistent environment variables.

### Persistent Windows PowerShell Setup

```powershell
[Environment]::SetEnvironmentVariable(
  "EXTERNAL_SUBAGENTS_STANDARD_API_KEY",
  "your-api-key",
  "User"
)
```

Restart the terminal and Codex afterward.

## Connect To Codex

Add this to `~/.codex/config.toml` on macOS/Linux or
`%USERPROFILE%\.codex\config.toml` on Windows:

```toml
[mcp_servers.external_subagents]
command = "npx"
args = ["-y", "external-subagents-mcp"]
env_vars = [
  "EXTERNAL_SUBAGENTS_STANDARD_API_KEY",
  "EXTERNAL_SUBAGENTS_LITE_API_KEY",
  "EXTERNAL_SUBAGENTS_PRO_API_KEY",
  "EXTERNAL_SUBAGENTS_CONFIG"
]
startup_timeout_sec = 20
tool_timeout_sec = 300
```

`env_vars` contains variable names only. Remove provider variables you do not
use. Include `EXTERNAL_SUBAGENTS_CONFIG` only when you use it to point at a
specific config file.

Restart Codex after changing MCP configuration.

To encourage early delegation before large source reads:

```bash
external-subagents-mcp install-codex-instructions
```

Related commands:

```bash
external-subagents-mcp codex-instructions
external-subagents-mcp install-codex-instructions --dry-run
external-subagents-mcp install-codex-instructions --target /custom/instructions.md
```

The installer preserves unrelated content, updates only its marked block, and
refuses malformed or duplicated markers.

## Roles And Profiles

A role defines which provider handles one kind of labor and its default output
budget.

```json
{
  "roles": {
    "explorer": {
      "provider": "pro",
      "max_output_tokens": 3000
    },
    "summarizer": "lite",
    "reviewer": "pro",
    "log_analyst": "lite",
    "file_finder": "lite"
  }
}
```

Role values may be a provider-name string or an object containing `provider`
and optional `max_output_tokens`.

Default output budgets:

| Role | Default output tokens |
|---|---:|
| `explorer` | 2500 |
| `summarizer` | 2000 |
| `reviewer` | 3000 |
| `log_analyst` | 2500 |
| `file_finder` | 1500 |

Existing configs without `explorer` remain valid. The server derives it from
`file_finder`, then `summarizer`, then the first configured role.

Profiles are reusable role maps:

```json
{
  "routing": {
    "profile": "cost_first",
    "mode": "profile"
  },
  "profiles": {
    "cost_first": {
      "explorer": "lite",
      "summarizer": "lite",
      "reviewer": "pro",
      "log_analyst": "lite",
      "file_finder": "lite"
    }
  }
}
```

When `routing.profile` is set, the matching profile supplies the active roles.
When no profile is selected, define `roles` directly.

## Automatic Provider Routing

Set `routing.mode` to `auto` to allow first-match provider routing by role,
job kind, or initial input size:

```json
{
  "routing": {
    "profile": "cost_first",
    "mode": "auto",
    "auto_rules": [
      {
        "kind": "explore_workspace",
        "provider": "pro",
        "max_output_tokens": 3500
      },
      {
        "role": "summarizer",
        "min_input_bytes": 50000,
        "provider": "standard"
      }
    ]
  }
}
```

Supported `kind` values:

- `explore_workspace`
- `summarize_paths`
- `review_diff`
- `find_relevant_files`
- `analyze_log`

`kind` may be one string or an array. Rules are evaluated in order; the first
matching rule selects the provider. Optional fields:

- `role`
- `kind`
- `min_input_bytes`
- `max_input_bytes`
- `provider`
- `max_output_tokens`

Automatic routing does not compress or rewrite prompts. For explorer jobs,
input-size routing sees the initial task prompt, not source discovered later in
the tool loop.

## Dynamic Output Budgets

Budget rules increase or reduce output room without changing the selected
provider:

```json
{
  "routing": {
    "budget_rules": [
      {
        "name": "large_reviews",
        "kind": "review_diff",
        "min_input_bytes": 50000,
        "max_output_tokens": 5000
      },
      {
        "name": "long_logs",
        "role": "log_analyst",
        "min_input_bytes": 20000,
        "max_output_tokens": 3500
      }
    ]
  }
}
```

Budget rules are evaluated in order. The first match wins. An explicit
`output_budget` passed in a tool call overrides role defaults and budget rules.

## Workspace Authorization

The workspace section controls what external workers may read:

```json
{
  "workspace": {
    "root": ".",
    "allow": ["src/**", "tests/**", "docs/**", "package.json", "README.md"],
    "deny": ["**/.env*", "**/node_modules/**", "**/dist/**", "**/*.pem"],
    "max_file_bytes": 262144,
    "max_total_bytes": 2097152
  }
}
```

| Field | Default | Limit |
|---|---:|---:|
| `root` | config directory | Must remain inside an explicitly requested cross-project root |
| `allow` | source, tests, docs, package, README | Glob allowlist |
| `deny` | sensitive files, dependencies, build output, binaries, archives, Git internals | Deny always wins |
| `max_file_bytes` | 262144 (256 KiB) | Maximum 10485760 (10 MiB) |
| `max_total_bytes` | 2097152 (2 MiB) | Maximum 52428800 (50 MiB) |

The default deny policy blocks:

- `.env` files
- `node_modules`, `dist`, `build`, and `.git`
- private keys and certificates
- images, PDFs, archives, and other common binary inputs

Binary files are rejected. Symlinks cannot escape the workspace root.

`max_total_bytes` limits source bytes the server reads from the workspace on
its own. Caller-supplied `diff_text` and `log_text` are bounded separately by
MCP tool schemas, because Codex explicitly chose to send that text.

File-discovery results expose truncation when a candidate list exceeds its
limit. `delegate_find_relevant_files` adds this to report `omitted`, and
explorer `list_files` tool results include a `truncated` flag.

Authorized source and logs are sent to the third-party provider you configure
and remain subject to that provider's data policy.

## Cross-Project Delegation

Task tools accept an optional absolute `workspace_root`:

```json
{
  "workspace_root": "/absolute/path/to/another-project",
  "paths": ["src/app.ts"],
  "focus": "public API and important dependencies"
}
```

The requested root must:

1. Be an absolute directory path
2. Directly contain `.external-subagents-mcp.json`
3. Keep any configured `workspace.root` inside the requested project

Only the target config's workspace policy controls file access. The running
server retains its own providers, API keys, routing, concurrency, and cache.

Prefer path-based delegation over copying full source or logs into `diff_text`
or `log_text`.

## Cache And Concurrency

```json
{
  "cache": {
    "dir": ".external-subagents/cache",
    "ttl_hours": 168,
    "max_bytes": 524288000
  },
  "concurrency": {
    "global": 3,
    "per_provider": 2
  }
}
```

| Field | Default | Maximum |
|---|---:|---:|
| `cache.dir` | `.external-subagents/cache` | n/a |
| `cache.ttl_hours` | 168 | n/a |
| `cache.max_bytes` | 524288000 (500 MiB) | 1073741824 (1 GiB) |
| `concurrency.global` | 3 | 20 |
| `concurrency.per_provider` | 2 | 10 |

Cache stores input hashes, metadata, telemetry, and model reports. It does not
store raw source files.

Task tools accept:

- `cache_mode: "read_write"`: reuse and write cache entries; default
- `cache_mode: "read_only"`: reuse existing entries but do not write
- `cache_mode: "skip"`: bypass cache

A cache hit reports `externalApiCalled: false`. Attached usage and exploration
telemetry describe the original historical run.

Completed job records are retained in memory for recent `delegate_result` and
`delegate_status` lookups. The default window keeps the latest 200 final jobs;
older job IDs may return as unknown during very long server sessions.

## Explorer Requirements And Limits

`delegate_explore_workspace` is for a focused question whose relevant files
and relationships are not yet known. It requires a provider that supports
OpenAI-compatible tool calling.

The external model receives only:

- `list_files`
- `search_text`
- `read_file`
- `read_file_range`

It never receives edit, shell, package, migration, test, or release tools.

| Explorer limit | Default | Public maximum |
|---|---:|---:|
| Provider turns | 8 | 20 |
| Distinct files read | 40 | 200 |
| Total source bytes read | 1048576 (1 MiB) | 5242880 (5 MiB) |
| Search matches returned per call | 100 | fixed internal bound |
| Bytes returned by one internal tool result | 131072 (128 KiB) | fixed internal bound |

Public tool-call fields:

- `question`
- `focus`
- `scope_globs`
- `max_turns`
- `max_files`
- `max_total_bytes`
- `output_budget`
- `cache_mode`
- `workspace_root`

If the provider cannot call tools, the explorer returns a structured `BLOCKED`
report without pretending an external API call occurred. When limits are hit,
the report and telemetry disclose them.

## Diagnostics And Troubleshooting

### CLI Diagnostics

```bash
external-subagents-mcp doctor
external-subagents-mcp doctor --json
external-subagents-mcp smoke --provider standard
external-subagents-mcp smoke --provider standard --json
```

`doctor` shows:

- active profile and routing mode
- configured providers and models
- key status and environment-variable names
- roles and rules that use each provider
- final chat-completions URLs
- configuration issues

It never prints secret values.

`smoke` sends one small provider request. Use it after `doctor` to distinguish
an unset key from an incorrect endpoint, model ID, or response format.

### MCP Diagnostics

Codex can call:

- `delegate_provider_status`
- `delegate_provider_smoke`

### Common Failures

**Missing API key**

Set the environment variable named by `api_key_env`, ensure it is listed in
Codex `env_vars`, then restart Codex.

**Unknown or unused provider**

Check `routing.profile`, active roles, and ordered `auto_rules` with `doctor`.

**Provider fetch failure**

Run `smoke`, verify the provider URL and network access, and check whether the
provider needs `chat_completions_path`.

**Explorer returns BLOCKED before calling the API**

The selected provider client does not expose compatible tool calling. Use a
known-path task tool or route `explorer` to a tool-capable provider.

**Cross-project root rejected**

Run `external-subagents-mcp init` in the exact requested project root and
ensure `workspace.root` does not escape it.

**Useful report is repaired or salvaged**

Inspect `recovery.parseMode`, `outputTruncated`, warnings, and completeness.
Codex should verify evidence and decide whether another call is economical.

## Full Example

This example matches the packaged `.external-subagents-mcp.example.json`:

```json
{
  "workspace": {
    "allow": ["src/**", "tests/**", "docs/**", "package.json", "README.md"],
    "deny": [
      "**/.env*",
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.git/**",
      "**/*.pem",
      "**/*.key",
      "**/*.p12",
      "**/*.crt",
      "**/*.der",
      "**/*.png",
      "**/*.jpg",
      "**/*.jpeg",
      "**/*.gif",
      "**/*.webp",
      "**/*.pdf",
      "**/*.zip",
      "**/*.tar",
      "**/*.gz"
    ],
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
    "standard": {
      "base_url": "https://api.example.com/v1",
      "api_key_env": "EXTERNAL_SUBAGENTS_STANDARD_API_KEY",
      "model": "provider-model-name",
      "wire_api": "chat_completions"
    },
    "lite": {
      "base_url": "https://api.example.com/v1",
      "api_key_env": "EXTERNAL_SUBAGENTS_LITE_API_KEY",
      "model": "provider-model-name",
      "wire_api": "chat_completions"
    },
    "pro": {
      "base_url": "https://api.example.com/v1",
      "api_key_env": "EXTERNAL_SUBAGENTS_PRO_API_KEY",
      "model": "provider-model-name",
      "wire_api": "chat_completions"
    }
  },
  "routing": {
    "profile": "single_provider",
    "mode": "profile",
    "budget_rules": [
      {
        "name": "long_logs",
        "role": "log_analyst",
        "min_input_bytes": 20000,
        "max_output_tokens": 3500
      },
      {
        "name": "large_reviews",
        "kind": "review_diff",
        "min_input_bytes": 50000,
        "max_output_tokens": 5000
      },
      {
        "name": "large_summaries",
        "kind": "summarize_paths",
        "min_input_bytes": 50000,
        "max_output_tokens": 4500
      }
    ]
  },
  "profiles": {
    "single_provider": {
      "explorer": "standard",
      "summarizer": "standard",
      "reviewer": "standard",
      "log_analyst": "standard",
      "file_finder": "standard"
    },
    "cost_first": {
      "explorer": "lite",
      "summarizer": "lite",
      "reviewer": "pro",
      "log_analyst": "lite",
      "file_finder": "lite"
    },
    "quality_first": {
      "explorer": "pro",
      "summarizer": "lite",
      "reviewer": "pro",
      "log_analyst": "pro",
      "file_finder": "pro"
    }
  }
}
```
