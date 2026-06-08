# external-subagents-mcp

> [中文文档](#中文文档)

A read-only MCP server that lets Codex delegate large-context review and summarization work to external OpenAI-compatible models such as GLM, MiMo, or DeepSeek.

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
    ],
    "budget_rules": [
      { "name": "long_logs", "role": "log_analyst", "min_input_bytes": 20000, "max_output_tokens": 3500 },
      { "name": "huge_logs", "role": "log_analyst", "min_input_bytes": 80000, "max_output_tokens": 5000 },
      { "name": "large_reviews", "kind": "review_diff", "min_input_bytes": 50000, "max_output_tokens": 5000 },
      { "name": "large_summaries", "kind": "summarize_paths", "min_input_bytes": 50000, "max_output_tokens": 4500 }
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

### OpenAI-compatible provider URLs

Each provider uses the standard chat-completions wire format by default:

- `base_url` is the provider or plan base URL.
- `chat_completions_path` is optional and defaults to `chat/completions`.
- The final request URL is normally `<base_url>/chat/completions`.
- If `base_url` already ends with `/chat/completions`, the server will not append it a second time.
- For nonstandard endpoints, set `chat_completions_path` explicitly.

Examples:

```json
{
  "providers": {
    "deepseek": {
      "base_url": "https://api.deepseek.com",
      "api_key_env": "DEEPSEEK_API_KEY",
      "model": "deepseek-chat"
    },
    "mimo": {
      "base_url": "https://token-plan-cn.xiaomimimo.com/v1",
      "api_key_env": "MIMO_API_KEY",
      "model": "mimo-v2.5-pro"
    },
    "minimax": {
      "base_url": "https://api.minimax.io/v1",
      "chat_completions_path": "text/chatcompletion_v2",
      "api_key_env": "MINIMAX_API_KEY",
      "model": "MiniMax-M3"
    },
    "qwen": {
      "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "api_key_env": "DASHSCOPE_API_KEY",
      "model": "qwen-plus"
    },
    "hunyuan": {
      "base_url": "https://api.hunyuan.cloud.tencent.com/v1",
      "api_key_env": "HUNYUAN_API_KEY",
      "model": "hunyuan-turbos-latest"
    }
  }
}
```

These are starting points, not vendor-specific adapters. Always use the Base URL, model name, and API key environment variable from your own provider console or plan page, then run `doctor --json` to confirm the computed `chat_completions_url` and `smoke --provider <name>` to verify a real call.

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
- DeepSeek API quick start: https://api-docs.deepseek.com/
- MiniMax text generation endpoint: https://platform.minimax.io/docs/api-reference/text-post
- Qwen/DashScope OpenAI-compatible chat: https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions
- Tencent Hunyuan OpenAI-compatible examples: https://cloud.tencent.com/document/product/1729/111007

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

### Dynamic output budgets

Use `routing.budget_rules` to raise `max_output_tokens` for large or complex tasks without changing the selected provider and without compressing or rewriting inputs.

```json
{
  "routing": {
    "budget_rules": [
      { "name": "long_logs", "role": "log_analyst", "min_input_bytes": 20000, "max_output_tokens": 3500 },
      { "name": "huge_logs", "role": "log_analyst", "min_input_bytes": 80000, "max_output_tokens": 5000 },
      { "name": "large_reviews", "kind": "review_diff", "min_input_bytes": 50000, "max_output_tokens": 5000 },
      { "name": "large_summaries", "kind": "summarize_paths", "min_input_bytes": 50000, "max_output_tokens": 4500 }
    ]
  }
}
```

Budget precedence is:

1. Tool input `output_budget`
2. First matching `routing.budget_rules` entry
3. Matching `auto_rules.max_output_tokens`
4. Role/profile default `max_output_tokens`

Job records include `maxOutputTokens` and `budgetSource`, so Codex can see whether a budget came from `input:output_budget`, `budget_rule:<name>`, `auto_rule:<rule>`, or `role:<role>`.

## Provider diagnostics

Use `doctor` before connecting Codex or after changing keys/base URLs:

```bash
external-subagents-mcp doctor
external-subagents-mcp doctor --json
```

The report shows:

- which providers are configured
- each provider's computed `chat_completions_url`
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
env_vars = ["ZAI_API_KEY", "MIMO_API_KEY", "FAST_API_KEY", "EXTERNAL_SUBAGENTS_CONFIG"]
```

## Tools

All task tools return a job record. Use `delegate_wait` then `delegate_result` to retrieve the structured report.

| Tool | Purpose | Key trigger words |
|------|---------|-------------------|
| `delegate_summarize_paths` | Read and summarize the specified files | compress, digest, condense, summarize |
| `delegate_review_diff` | Review a code diff for correctness, security, regressions | review, diff, PR, code review |
| `delegate_find_relevant_files` | Search, locate, or discover files relevant to a query | search, find, locate, discover |
| `delegate_analyze_log` | Debug and analyze logs for root causes and failure patterns | debug, analyze, troubleshoot, error, crash |
| `delegate_provider_status` | Check provider routing, API key setup, and role assignments | check, inspect, diagnose provider |
| `delegate_provider_smoke` | Smoke-test one provider's connectivity and response format | smoke-test, verify, test provider |
| `delegate_wait` | Wait for one or more delegate jobs to finish | wait, poll |
| `delegate_result` | Retrieve the structured report from a completed job | get result, retrieve, fetch |
| `delegate_status` | List the state of all delegate jobs (queued/running/completed/failed) | job status, progress |
| `delegate_cancel` | Cancel a queued or running delegate job | cancel, abort |

### Reasoning chain (phase and depends_on)

Each finding in the structured report may include two optional fields that let Codex audit the reasoning chain before acting on the report:

- `phase`: labels the reasoning stage of the finding. Recommended values are `discovery`, `analysis`, `verification`, and `recommendation`.
- `depends_on`: references earlier findings that this finding's conclusion depends on, using the format `"phase#index"`, e.g. `"discovery#0"`.

Example report with reasoning chain:

```json
{
  "status": "DONE_WITH_CONCERNS",
  "summary": "Two security issues found in the authentication module.",
  "findings": [
    {
      "phase": "discovery",
      "depends_on": [],
      "severity": "high",
      "title": "MD5 hashing in password storage",
      "description": "auth.ts uses MD5 for password hashing, which is cryptographically broken.",
      "evidence": [{"path": "src/auth.ts", "line_start": 42, "line_end": 45}],
      "recommendation": "Replace MD5 with bcrypt or argon2.",
      "confidence": 0.95
    },
    {
      "phase": "analysis",
      "depends_on": ["discovery#0"],
      "severity": "medium",
      "title": "Session token collision risk",
      "description": "Because MD5 is used, session tokens derived from hashed passwords may collide.",
      "evidence": [{"path": "src/session.ts", "line_start": 18}],
      "recommendation": "After replacing MD5, verify session token uniqueness.",
      "confidence": 0.7
    }
  ],
  "next_actions": ["Verify auth.ts:42-45", "Replace MD5 with bcrypt"],
  "omitted": []
}
```

How Codex uses the reasoning chain:

1. Check whether `discovery` findings have high confidence (> 0.5). If the foundation is shaky, later `analysis` findings that depend on it may be unreliable.
2. Check whether `depends_on` references are valid. A finding that depends on a high-severity discovery means the analysis is built on a known defect — Codex should address the foundation first.
3. Use `evidence` paths from foundational findings to directly verify the claims before acting on dependent findings.

Both fields are optional. If the external model does not emit them, Codex receives the same flat finding list as before — no behavior change, no parsing error.

## Safety model

- Read-only: no shell, no patches, no file writes to the repo.
- Deny rules win over allow rules.
- Default deny rules block `.env`, dependencies, build output, keys, certs, archives, images, PDFs, and git internals.
- Symlinks may not escape the workspace root.
- Cache stores input hashes and model reports, not raw source text.
- External model reports are advisory. Codex should verify cited files and lines before editing.

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
npm run smoke:stdio
```

The implementation uses the stable `@modelcontextprotocol/sdk` package. The scoped `@modelcontextprotocol/server` package currently exists on npm only as an alpha package, so this project uses the official stable SDK package for the first release.

## License

MIT

---

# 中文文档

> [English documentation](#external-subagents-mcp)

一个只读 MCP 服务器，让 Codex 将大上下文的审查和摘要工作委托给外部 OpenAI 兼容模型（如 GLM、MiMo、DeepSeek 等）。

Codex 始终负责编辑文件、运行 shell 命令、应用补丁、审批和最终判断。外部模型仅作为顾问性质的探索者/审查者/摘要者/日志分析师代理。

## 为什么用 MCP，而不是 Codex 插件？

以独立 MCP 服务器形式分发，用户可以显式配置本地文件访问权限、API 密钥和模型路由。这更适合读取本地项目文件并调用第三方模型 API 的工作流。

## 安装

```bash
npm install -g external-subagents-mcp
```

本地开发：

```bash
npm install
npm run build
```

## 配置

在项目根目录创建 `.external-subagents-mcp.json`，或设置 `EXTERNAL_SUBAGENTS_CONFIG` 为绝对配置路径。

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
    ],
    "budget_rules": [
      { "name": "long_logs", "role": "log_analyst", "min_input_bytes": 20000, "max_output_tokens": 3500 },
      { "name": "huge_logs", "role": "log_analyst", "min_input_bytes": 80000, "max_output_tokens": 5000 },
      { "name": "large_reviews", "kind": "review_diff", "min_input_bytes": 50000, "max_output_tokens": 5000 },
      { "name": "large_summaries", "kind": "summarize_paths", "min_input_bytes": 50000, "max_output_tokens": 4500 }
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

API 密钥必须存储在环境变量中：

```bash
export ZAI_API_KEY=...
export MIMO_API_KEY=...
```

### OpenAI 兼容 provider URL

每个 provider 默认使用标准 chat-completions 线格式：

- `base_url` 是 provider 或套餐的基础 URL。
- `chat_completions_path` 可选，默认为 `chat/completions`。
- 最终请求 URL 通常为 `<base_url>/chat/completions`。
- 如果 `base_url` 已以 `/chat/completions` 结尾，服务器不会重复拼接。
- 对于非标准端点，显式设置 `chat_completions_path`。

示例：

```json
{
  "providers": {
    "deepseek": {
      "base_url": "https://api.deepseek.com",
      "api_key_env": "DEEPSEEK_API_KEY",
      "model": "deepseek-chat"
    },
    "mimo": {
      "base_url": "https://token-plan-cn.xiaomimimo.com/v1",
      "api_key_env": "MIMO_API_KEY",
      "model": "mimo-v2.5-pro"
    },
    "minimax": {
      "base_url": "https://api.minimax.io/v1",
      "chat_completions_path": "text/chatcompletion_v2",
      "api_key_env": "MINIMAX_API_KEY",
      "model": "MiniMax-M3"
    },
    "qwen": {
      "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "api_key_env": "DASHSCOPE_API_KEY",
      "model": "qwen-plus"
    },
    "hunyuan": {
      "base_url": "https://api.hunyuan.cloud.tencent.com/v1",
      "api_key_env": "HUNYUAN_API_KEY",
      "model": "hunyuan-turbos-latest"
    }
  }
}
```

这些是起点配置，不是厂商专用适配器。请始终使用你自己 provider 控制台或套餐页面中的 Base URL、模型名称和 API 密钥环境变量，然后运行 `doctor --json` 确认计算出的 `chat_completions_url`，运行 `smoke --provider <name>` 验证实际调用。

MiMo Token Plan 需将 `base_url` 设为订阅页面上的 Base URL。当前区域示例：

- 中国：`https://token-plan-cn.xiaomimimo.com/v1`
- 新加坡：`https://token-plan-sgp.xiaomimimo.com/v1`
- 欧洲：`https://token-plan-ams.xiaomimimo.com/v1`

如果仅测试 MiMo，将所有角色指向 `mimo`，只需要 `MIMO_API_KEY`。`model` 值应与你的 token plan 提供的模型 UID 匹配。

Z.AI 配置说明：

- 通用 OpenAI 兼容端点：`https://api.z.ai/api/paas/v4`
- GLM Coding Plan 端点：`https://api.z.ai/api/coding/paas/v4`
- Z.AI 文档当前显示 `glm-5.1` 的 chat completions 示例。
- 请优先使用 Z.AI 控制台或套餐页面的 Base URL，然后用 `smoke` 验证。

官方参考：

- Z.AI API 简介：https://docs.z.ai/api-reference/introduction
- MiMo Token Plan 订阅说明：https://platform.xiaomimimo.com/docs/en-US/tokenplan/subscription
- DeepSeek API 快速入门：https://api-docs.deepseek.com/
- MiniMax 文本生成端点：https://platform.minimax.io/docs/api-reference/text-post
- Qwen/DashScope OpenAI 兼容聊天：https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions
- 腾讯混元 OpenAI 兼容示例：https://cloud.tencent.com/document/product/1729/111007

### Profile 与路由

当你有两个或更多 provider 时，使用 `profiles` 实现一键策略切换：

- `cost_first`：MiMo 处理批量摘要/日志/文件发现；GLM 处理代码审查。
- `code_quality_first`：GLM 处理代码审查、日志分析和文件发现；MiMo 处理批量摘要。
- `balanced_three_model`：第三个快速/低成本模型处理文件发现；GLM 处理代码判断；MiMo 处理摘要。

设置活跃策略：

```json
{
  "routing": { "profile": "code_quality_first" }
}
```

`routing.mode = "auto"` 在活跃 profile 上叠加首匹配 provider 选择规则。自动路由仅选择 provider 和可选输出预算。它不会摘要、压缩、重写或在发送给所选 provider 之前转换 prompt。

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

API 密钥按 provider 使用情况延迟生效。缺少密钥不会阻止服务器启动；只有在路由到 `api_key_env` 未设置的 provider 时任务才会明确失败。缓存结果在没有 provider 密钥的情况下仍可读取。

### 动态输出预算

使用 `routing.budget_rules` 在不更换所选 provider 和不压缩/重写输入的情况下，为大型或复杂任务提升 `max_output_tokens`。

```json
{
  "routing": {
    "budget_rules": [
      { "name": "long_logs", "role": "log_analyst", "min_input_bytes": 20000, "max_output_tokens": 3500 },
      { "name": "huge_logs", "role": "log_analyst", "min_input_bytes": 80000, "max_output_tokens": 5000 },
      { "name": "large_reviews", "kind": "review_diff", "min_input_bytes": 50000, "max_output_tokens": 5000 },
      { "name": "large_summaries", "kind": "summarize_paths", "min_input_bytes": 50000, "max_output_tokens": 4500 }
    ]
  }
}
```

预算优先级：

1. 工具输入 `output_budget`
2. 第一个匹配的 `routing.budget_rules` 条目
3. 匹配的 `auto_rules.max_output_tokens`
4. 角色/profile 默认 `max_output_tokens`

Job 记录包含 `maxOutputTokens` 和 `budgetSource`，Codex 可以看到预算来自 `input:output_budget`、`budget_rule:<name>`、`auto_rule:<rule>` 还是 `role:<role>`。

## Provider 诊断

在连接 Codex 或更改密钥/base URL 后，使用 `doctor`：

```bash
external-subagents-mcp doctor
external-subagents-mcp doctor --json
```

报告显示：

- 配置了哪些 provider
- 每个 provider 计算出的 `chat_completions_url`
- 哪些 provider 被活跃 profile 或 auto rules 使用
- 哪些 `api_key_env` 变量已设置或缺失
- 问题列表（不打印密钥）

用最小 chat completion 调用 smoke-test 一个 provider：

```bash
external-subagents-mcp smoke --provider mimo
external-subagents-mcp smoke --provider glm --json
```

本地开发：

```bash
npm run build
node dist/index.js doctor --json
node dist/index.js smoke --provider mimo --json
```

## Codex MCP 配置

将 stdio 服务器添加到 Codex：

```toml
[mcp_servers.external_subagents]
command = "npx"
args = ["-y", "external-subagents-mcp"]
env_vars = ["ZAI_API_KEY", "MIMO_API_KEY", "EXTERNAL_SUBAGENTS_CONFIG"]
startup_timeout_sec = 20
tool_timeout_sec = 300
```

本地开发时，将 Codex 指向已构建的 CLI：

```toml
[mcp_servers.external_subagents]
command = "node"
args = ["/absolute/path/to/external-subagents-mcp/dist/index.js"]
env_vars = ["ZAI_API_KEY", "MIMO_API_KEY", "FAST_API_KEY", "EXTERNAL_SUBAGENTS_CONFIG"]
```

## 工具

所有任务工具返回一个 job 记录。使用 `delegate_wait` 然后 `delegate_result` 获取结构化报告。

| 工具 | 用途 | 关键触发词 |
|------|------|-----------|
| `delegate_summarize_paths` | 读取并摘要指定文件 | compress、digest、condense、summarize |
| `delegate_review_diff` | 审查代码 diff 的正确性、安全性、回归 | review、diff、PR、code review |
| `delegate_find_relevant_files` | 搜索、定位或发现与查询相关的文件 | search、find、locate、discover |
| `delegate_analyze_log` | 调试和分析日志的根本原因与故障模式 | debug、analyze、troubleshoot、error、crash |
| `delegate_provider_status` | 检查 provider 路由、API 密钥配置和角色分配 | check、inspect、diagnose provider |
| `delegate_provider_smoke` | Smoke-test 一个 provider 的连通性和响应格式 | smoke-test、verify、test provider |
| `delegate_wait` | 等待一个或多个委托任务完成 | wait、poll |
| `delegate_result` | 从已完成任务获取结构化报告 | get result、retrieve、fetch |
| `delegate_status` | 列出所有委托任务的状态（queued/running/completed/failed） | job status、progress |
| `delegate_cancel` | 取消排队或运行中的委托任务 | cancel、abort |

### 推理链（phase 和 depends_on）

结构化报告中每个 finding 可以包含两个可选字段，让 Codex 在行动之前审查推理链的内部一致性：

- `phase`：标注该 finding 的推理阶段。建议值为 `discovery`（发现）、`analysis`（分析）、`verification`（验证）、`recommendation`（建议）。
- `depends_on`：引用该 finding 结论所依赖的前置 finding，使用 `"phase#index"` 格式，如 `"discovery#0"`。

含推理链的报告示例：

```json
{
  "status": "DONE_WITH_CONCERNS",
  "summary": "认证模块中发现两个安全问题。",
  "findings": [
    {
      "phase": "discovery",
      "depends_on": [],
      "severity": "high",
      "title": "密码存储使用 MD5 哈希",
      "description": "auth.ts 使用 MD5 进行密码哈希，这在密码学上已被破解。",
      "evidence": [{"path": "src/auth.ts", "line_start": 42, "line_end": 45}],
      "recommendation": "将 MD5 替换为 bcrypt 或 argon2。",
      "confidence": 0.95
    },
    {
      "phase": "analysis",
      "depends_on": ["discovery#0"],
      "severity": "medium",
      "title": "会话令牌碰撞风险",
      "description": "由于使用了 MD5，从哈希密码派生的会话令牌可能发生碰撞。",
      "evidence": [{"path": "src/session.ts", "line_start": 18}],
      "recommendation": "替换 MD5 后，验证会话令牌的唯一性。",
      "confidence": 0.7
    }
  ],
  "next_actions": ["验证 auth.ts:42-45", "将 MD5 替换为 bcrypt"],
  "omitted": []
}
```

Codex 如何使用推理链：

1. 检查 `discovery` 阶段的 findings 的置信度是否普遍较高（> 0.5）。如果基础 findings 置信度低，后续依赖它们的 `analysis` findings 可能不可靠。
2. 检查 `depends_on` 引用是否有效。一个 finding 依赖于高严重度的 discovery，意味着分析建立在已知缺陷之上——Codex 应优先处理基础问题。
3. 使用基础 findings 的 `evidence` 路径直接验证声明，再根据依赖 findings 的建议采取行动。

两个字段均为可选。如果外部模型不输出它们，Codex 收到与之前完全相同的扁平 findings 列表——没有行为变化，没有解析错误。

## 安全模型

- 只读：无 shell、无补丁、不对仓库写入文件。
- deny 规则优先于 allow 规则。
- 默认 deny 规则阻止 `.env`、依赖、构建产物、密钥、证书、压缩包、图片、PDF 和 git 内部文件。
- 符号链接不可逃逸 workspace 根目录。
- 缓存存储输入哈希和模型报告，不存储原始源文本。
- 外部模型报告仅供参考。Codex 在编辑前应验证引用的文件和行号。

## 开发

```bash
npm install
npm test
npm run typecheck
npm run build
npm run smoke:stdio
```

实现使用稳定的 `@modelcontextprotocol/sdk` 包。scoped `@modelcontextprotocol/server` 包目前在 npm 上仅作为 alpha 包存在，因此本项目使用官方稳定 SDK 包作为首个发布版本。

## 许可证

MIT