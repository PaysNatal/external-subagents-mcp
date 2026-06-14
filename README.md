# external-subagents-mcp

> [中文文档](#中文文档)

A read-only MCP server that lets Codex delegate large-context review, summarization, file discovery, and log analysis to external OpenAI-compatible models.

Codex remains responsible for file edits, shell commands, patches, approvals, and final judgment. External models return advisory reports only.

## Quick start

### 1. Install

Requires Node.js 20 or newer.

```bash
npm install -g external-subagents-mcp
```

### 2. Create the project config

Run this in the root of the project that external models may read:

```bash
cd /path/to/your-project
external-subagents-mcp init
```

Replace `/path/to/your-project` with your actual project directory. The directory where you run `init` becomes the default workspace root and receives `.external-subagents-mcp.json`.

The generated config includes safe workspace defaults, a single-provider profile, and optional multi-provider profiles. It refuses to overwrite an existing config.

This file also acts as an explicit authorization marker when a running MCP server is asked to read this project through `workspace_root`.

### 3. Configure your provider

Open `.external-subagents-mcp.json` and edit the provider you want to use:

```json
{
  "providers": {
    "standard": {
      "base_url": "https://your-provider.example/v1",
      "api_key_env": "EXTERNAL_SUBAGENTS_STANDARD_API_KEY",
      "model": "your-model-name"
    }
  }
}
```

Copy `base_url` and `model` from your provider's own documentation or console.

- `base_url`: provider API base URL. The server normally appends `chat/completions`.
- `model`: provider model identifier.
- `api_key_env`: the environment variable name that will contain the API key. This is not the key itself.
- `chat_completions_path`: optional. Set it only when the provider uses a nonstandard path.

Never put an API key inside `.external-subagents-mcp.json`.

### 4. Set API key environment variables

The name in `api_key_env` connects a provider config to an environment variable:

```json
"api_key_env": "EXTERNAL_SUBAGENTS_STANDARD_API_KEY"
```

The matching environment variable must contain the real secret.

For a temporary macOS/Linux shell session:

```bash
export EXTERNAL_SUBAGENTS_STANDARD_API_KEY="your-api-key"
```

For a persistent macOS/Linux setup, keep secrets outside the project:

```bash
mkdir -p ~/.config/external-subagents-mcp
chmod 700 ~/.config/external-subagents-mcp
${EDITOR:-nano} ~/.config/external-subagents-mcp/env
```

Add the required variables to that file:

```bash
export EXTERNAL_SUBAGENTS_STANDARD_API_KEY="your-api-key"
export EXTERNAL_SUBAGENTS_LITE_API_KEY="your-api-key"
export EXTERNAL_SUBAGENTS_PRO_API_KEY="your-api-key"
```

Only add variables for providers you use. Then protect and load the file:

```bash
chmod 600 ~/.config/external-subagents-mcp/env
echo 'source "$HOME/.config/external-subagents-mcp/env"' >> ~/.zshrc
source ~/.zshrc
```

Use `~/.bashrc` instead of `~/.zshrc` when Bash is your shell.

For Windows PowerShell, set a user environment variable:

```powershell
[Environment]::SetEnvironmentVariable("EXTERNAL_SUBAGENTS_STANDARD_API_KEY", "your-api-key", "User")
```

Restart the terminal and Codex after changing persistent environment variables.

### 5. Connect it to Codex

Add this to `~/.codex/config.toml` on macOS/Linux or `%USERPROFILE%\.codex\config.toml` on Windows:

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

`env_vars` contains variable names only, never secret values. Remove names for providers you do not use, then restart Codex.

### 6. Verify the setup

```bash
external-subagents-mcp doctor
external-subagents-mcp smoke --provider standard
```

`doctor` shows active routing, missing environment variables, models, and computed chat-completions URLs without printing secrets.

## Profiles: how tasks are assigned to models

A profile is a task distribution plan. It decides which provider receives each kind of job. You pick one profile as the active strategy; the MCP server then routes every incoming request accordingly.

The system has two building blocks:

**Three providers — the models that do the work**

| Provider | Purpose | When to use |
|----------|---------|-------------|
| `lite` | Low-cost, fast response | Routine tasks where speed matters more than depth |
| `standard` | Default quality, balanced cost | General-purpose work |
| `pro` | Highest quality, higher cost | Tasks where accuracy is critical |

Each provider is defined once under `providers` and points to any OpenAI-compatible API. You can add more providers beyond these three if you need them.

**Three default profiles — the distribution plans**

Each profile assigns four task roles to the providers above. The roles are: `summarizer`, `reviewer`, `log_analyst`, and `file_finder`.

| Profile | Summarizer | Reviewer | Log analyst | File finder | Best for |
|---------|-----------|----------|-------------|-------------|----------|
| `single_provider` | standard | standard | standard | standard | Initial setup — one model does everything |
| `cost_first` | lite | pro | lite | lite | Save cost — only review gets the strong model |
| `quality_first` | lite | pro | pro | pro | Maximize quality — only summarization uses the fast model |

Switch the active profile by changing one line:

```json
{
  "routing": {
    "profile": "cost_first"
  }
}
```

You can also edit or create profiles. A profile is just a role-to-provider map:

```json
{
  "profiles": {
    "my_custom": {
      "summarizer": "standard",
      "reviewer": "pro",
      "log_analyst": "lite",
      "file_finder": "standard"
    }
  }
}
```

Then set `"profile": "my_custom"` in routing.

API keys are lazy by provider use. A missing key does not prevent startup; a job fails clearly only when it routes to that provider.

## Configuration reference

Config lookup order:

1. Path in `EXTERNAL_SUBAGENTS_CONFIG`
2. `.external-subagents-mcp.json`, searched upward from the current project
3. `~/.config/external-subagents-mcp/config.json`

Important sections:

- `workspace.allow`: files external models may read.
- `workspace.deny`: files that are always blocked. Deny rules win.
- `workspace.max_file_bytes`: maximum size (in bytes) of a single file the server will read. Default: 262144 (256 KB).
- `workspace.max_total_bytes`: maximum total bytes across all files read in a single request. Default: 2097152 (2 MB).
- `providers`: OpenAI-compatible endpoints, models, and API-key environment variable names.
- `profiles`: reusable role-to-provider assignments.
- `routing.profile`: active profile.
- `routing.auto_rules`: optional first-match provider routing rules.
- `routing.budget_rules`: optional output-budget increases for large tasks.
- `cache.dir`: directory for cached responses. Default: `.external-subagents/cache`.
- `cache.ttl_hours`: how long cached responses remain valid (hours). Default: 168 (7 days).
- `cache.max_bytes`: maximum total size of the cache directory in bytes. Default: 524288000 (500 MB).
- `concurrency.global`: maximum number of jobs running simultaneously across all providers. Default: 3.
- `concurrency.per_provider`: maximum number of jobs running simultaneously per provider. Default: 2.
- `roles`: explicit role-to-provider mapping (used when no profile is active). Each role can be a provider name string or an object with `provider` and optional `max_output_tokens`.

`routing.mode = "auto"` can select a provider based on job type, role, or input size. It does not compress or rewrite the prompt.

## Cross-project path delegation

Codex should prefer sending file paths instead of copying large source or log bodies into a tool call. If the project is not the MCP server's default workspace, all four task tools accept:

```json
{
  "workspace_root": "/absolute/path/to/project",
  "paths": ["src/app.ts"]
}
```

The requested root must directly contain `.external-subagents-mcp.json`. Its `workspace` section controls which files may be read, but it cannot change the running server's providers, API keys, routing, concurrency, or cache. A target `workspace.root` may narrow access to a subdirectory but may not escape the requested project.

Use `diff_text` or `log_text` when the content has no readable project path. For files already on disk, `workspace_root` plus relative paths keeps their full content out of Codex context.

## Tools

| Tool | Purpose |
|------|---------|
| `delegate_summarize_paths` | Read and summarize allowed files |
| `delegate_review_diff` | Review a supplied code diff |
| `delegate_find_relevant_files` | Rank relevant allowed files |
| `delegate_analyze_log` | Analyze logs and failures |
| `delegate_provider_status` | Inspect routing and API-key status |
| `delegate_provider_smoke` | Test one provider |
| `delegate_wait` | Wait for jobs |
| `delegate_result` | Retrieve one completed report |
| `delegate_status` | List job states |
| `delegate_cancel` | Cancel queued or running work |

All task tools return asynchronous job records. External reports may include optional `phase` and `depends_on` fields so Codex can audit the reasoning chain before acting.

All task tools also accept a `cache_mode` parameter: `read_write` (default — cache and reuse), `read_only` (reuse but don't write), or `skip` (bypass cache entirely).

Job records expose:

- `workspaceRoot`: effective workspace used for the task.
- `inputBytes`: UTF-8 bytes sent to the provider.
- `externalApiCalled`: whether this request actually contacted an external provider.
- `usage`: provider-reported prompt, completion, and total token counts when available.
- `recovery`: how the provider response was parsed, whether it was truncated, discarded tail bytes, warnings, and estimated report completeness.

A cache hit sets `externalApiCalled` to `false`. Attached usage then describes the original cached run, not a new API call. Providers that omit usage remain supported; the server does not invent exact token counts.

Malformed or truncated provider output does not automatically discard the whole job. The server progressively attempts strict parsing, JSON repair, complete-finding salvage, structured text extraction, and finally a bounded `raw_advice` fallback. Recovered reports expose `recovery.parseMode` as `strict`, `repaired`, `salvaged`, `text_fallback`, or `raw_fallback`. A usable recovered report is not automatically retried; Codex decides whether missing context warrants another call.

## Safety model

- The MCP tools are read-only: no shell, patches, migrations, formatting, or test execution.
- Deny rules override allow rules.
- Default deny rules block `.env`, dependencies, build output, keys, certificates, archives, images, PDFs, and Git internals.
- Symlinks may not escape the workspace root.
- Cache stores hashes and model reports, not raw source files.
- API keys are read from environment variables only.
- Allowed source and log content is sent to the user-selected third-party provider and is subject to that provider's data policy.
- External reports are advisory; Codex should verify important evidence before editing.

## License

MIT

---

# 中文文档

> [English documentation](#external-subagents-mcp)

一个只读 MCP 服务器，让 Codex 将大上下文的代码审查、摘要、文件定位和日志分析委托给外部 OpenAI-compatible 模型。

Codex 始终负责文件编辑、shell、补丁、审批和最终判断。外部模型只返回顾问性质的报告。

## 快速开始

### 1. 安装

需要 Node.js 20 或更高版本。

```bash
npm install -g external-subagents-mcp
```

### 2. 自动创建项目配置

进入允许外部模型读取的项目根目录，运行：

```bash
cd /你的项目/实际路径
external-subagents-mcp init
```

请将 `/你的项目/实际路径` 替换为真实项目目录。运行 `init` 时所在的目录会成为默认 workspace root，配置文件 `.external-subagents-mcp.json` 也会创建在这里。

自动生成的配置包含安全的 workspace 默认值、单模型 profile 和可选的多模型 profiles。已有配置不会被覆盖。

当运行中的 MCP 通过 `workspace_root` 读取该项目时，这个文件也会作为项目的显式授权标记。

### 3. 配置你的 Provider

打开 `.external-subagents-mcp.json`，修改要使用的 provider：

```json
{
  "providers": {
    "standard": {
      "base_url": "https://your-provider.example/v1",
      "api_key_env": "EXTERNAL_SUBAGENTS_STANDARD_API_KEY",
      "model": "your-model-name"
    }
  }
}
```

请从 provider 自己的官网文档或控制台复制 `base_url` 和 `model`。

- `base_url`：provider API 基础地址。服务器通常会自动拼接 `chat/completions`。
- `model`：provider 的模型标识符。
- `api_key_env`：保存 API key 的环境变量名称，不是 API key 本身。
- `chat_completions_path`：可选。仅当 provider 使用非标准路径时填写。

不要把 API key 写进 `.external-subagents-mcp.json`。

### 4. 设置 API Key 环境变量

配置中的 `api_key_env` 用于指定环境变量名称：

```json
"api_key_env": "EXTERNAL_SUBAGENTS_STANDARD_API_KEY"
```

同名环境变量中才存放真正的 API key。

macOS/Linux 当前终端临时使用：

```bash
export EXTERNAL_SUBAGENTS_STANDARD_API_KEY="your-api-key"
```

macOS/Linux 持久设置时，建议将密钥文件放在项目之外：

```bash
mkdir -p ~/.config/external-subagents-mcp
chmod 700 ~/.config/external-subagents-mcp
${EDITOR:-nano} ~/.config/external-subagents-mcp/env
```

在打开的文件中填写需要使用的变量：

```bash
export EXTERNAL_SUBAGENTS_STANDARD_API_KEY="your-api-key"
export EXTERNAL_SUBAGENTS_LITE_API_KEY="your-api-key"
export EXTERNAL_SUBAGENTS_PRO_API_KEY="your-api-key"
```

只需填写实际使用的 provider。随后保护并加载这个文件：

```bash
chmod 600 ~/.config/external-subagents-mcp/env
echo 'source "$HOME/.config/external-subagents-mcp/env"' >> ~/.zshrc
source ~/.zshrc
```

使用 Bash 时，将 `~/.zshrc` 替换为 `~/.bashrc`。

Windows PowerShell 可设置用户级环境变量：

```powershell
[Environment]::SetEnvironmentVariable("EXTERNAL_SUBAGENTS_STANDARD_API_KEY", "your-api-key", "User")
```

修改持久环境变量后，请重启终端和 Codex。

### 5. 接入 Codex

在 macOS/Linux 的 `~/.codex/config.toml`，或 Windows 的 `%USERPROFILE%\.codex\config.toml` 中加入：

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

`env_vars` 中只填写变量名，绝不能填写密钥值。删除没有使用的 provider 变量名，然后重启 Codex。

### 6. 验证配置

```bash
external-subagents-mcp doctor
external-subagents-mcp smoke --provider standard
```

`doctor` 会显示当前路由、缺失的环境变量、模型和最终 chat-completions URL，但不会打印密钥。

## Profiles：任务如何分配给模型

Profile 是任务分配方案。它决定哪种任务由哪个 provider 接收。你选择一个 profile 作为活跃策略，MCP 服务器就会按该方案路由所有请求。

系统由两部分构成：

**三种 provider — 执行任务的实际模型**

| Provider | 用途 | 适用场景 |
|----------|------|----------|
| `lite` | 低成本、响应快 | 速度优先、深度次要的批量任务 |
| `standard` | 默认质量、成本适中 | 通用任务 |
| `pro` | 最高质量、成本较高 | 准确性关键的任务 |

每个 provider 在 `providers` 下定义一次，指向任意 OpenAI-compatible API。如果你需要更多层级，可以在这三种之外自行添加。

**三种默认 profile — 任务分配方案**

每个 profile 将四种任务角色分配给上述 provider。角色为：`summarizer`、`reviewer`、`log_analyst`、`file_finder`。

| Profile | Summarizer | Reviewer | Log analyst | File finder | 适用场景 |
|---------|-----------|----------|-------------|-------------|----------|
| `single_provider` | standard | standard | standard | standard | 初始配置 — 一个模型处理所有任务 |
| `cost_first` | lite | pro | lite | lite | 省成本 — 只有代码审查用强模型 |
| `quality_first` | lite | pro | pro | pro | 重质量 — 只有摘要用快模型 |

修改一行即可切换活跃 profile：

```json
{
  "routing": {
    "profile": "cost_first"
  }
}
```

你也可以编辑或新建 profile。Profile 本质就是角色到 provider 的映射：

```json
{
  "profiles": {
    "my_custom": {
      "summarizer": "standard",
      "reviewer": "pro",
      "log_analyst": "lite",
      "file_finder": "standard"
    }
  }
}
```

然后在 routing 中设置 `"profile": "my_custom"`。

API key 按 provider 实际使用情况延迟生效。缺少未使用 provider 的 key 不会阻止启动；只有任务真正路由到它时才会明确失败。

## 配置参考

配置查找顺序：

1. `EXTERNAL_SUBAGENTS_CONFIG` 指定的路径
2. 从当前项目向上查找 `.external-subagents-mcp.json`
3. `~/.config/external-subagents-mcp/config.json`

重要配置段：

- `workspace.allow`：允许外部模型读取的文件。
- `workspace.deny`：始终禁止读取的文件；deny 优先。
- `workspace.max_file_bytes`：单个文件最大读取字节数。默认：262144（256 KB）。
- `workspace.max_total_bytes`：单次请求所有文件的最大总字节数。默认：2097152（2 MB）。
- `providers`：OpenAI-compatible 的端点、模型和 API key 环境变量名称。
- `profiles`：可复用的角色与 provider 分配方案。
- `routing.profile`：当前活跃 profile。
- `routing.auto_rules`：可选的首匹配自动路由规则。
- `routing.budget_rules`：可选的大任务输出预算提升规则。
- `cache.dir`：缓存响应目录。默认：`.external-subagents/cache`。
- `cache.ttl_hours`：缓存有效期（小时）。默认：168（7 天）。
- `cache.max_bytes`：缓存目录最大字节数。默认：524288000（500 MB）。
- `concurrency.global`：所有 provider 同时运行的最大任务数。默认：3。
- `concurrency.per_provider`：每个 provider 同时运行的最大任务数。默认：2。
- `roles`：显式角色到 provider 的映射（未使用 profile 时使用）。每个角色可以是 provider 名称字符串，或包含 `provider` 和可选 `max_output_tokens` 的对象。

`routing.mode = "auto"` 可以根据任务类型、角色或输入大小选择 provider，但不会压缩或重写 prompt。

## 跨项目路径委托

Codex 应优先传递文件路径，而不是把大段源码或日志复制进工具调用。当目标项目不是 MCP 服务器的默认 workspace 时，四个任务工具都可传入：

```json
{
  "workspace_root": "/项目的绝对路径",
  "paths": ["src/app.ts"]
}
```

目标根目录必须直接包含 `.external-subagents-mcp.json`。目标配置只有 `workspace` 段用于控制允许读取的文件，不能改变运行中服务器的 provider、API key、路由、并发或缓存。目标配置的 `workspace.root` 可以缩小到项目内子目录，但不能逃逸目标项目。

当内容没有可读取的项目路径时再使用 `diff_text` 或 `log_text`。对于磁盘上已有的文件，使用 `workspace_root` 加相对路径可以避免完整正文进入 Codex 上下文。

## 工具

| 工具 | 用途 |
|------|------|
| `delegate_summarize_paths` | 读取并摘要允许访问的文件 |
| `delegate_review_diff` | 审查传入的代码 diff |
| `delegate_find_relevant_files` | 对相关文件进行排序 |
| `delegate_analyze_log` | 分析日志和失败原因 |
| `delegate_provider_status` | 检查路由和 API key 状态 |
| `delegate_provider_smoke` | 测试单个 provider |
| `delegate_wait` | 等待任务 |
| `delegate_result` | 获取已完成报告 |
| `delegate_status` | 列出任务状态 |
| `delegate_cancel` | 取消排队或运行中的任务 |

所有任务工具都会返回异步 job 记录。外部报告可以包含可选的 `phase` 和 `depends_on` 字段，供 Codex 在行动前审查推理链。

所有任务工具还支持 `cache_mode` 参数：`read_write`（默认 — 缓存并复用）、`read_only`（仅复用不写入）、`skip`（跳过缓存）。

Job 记录会显示：

- `workspaceRoot`：任务实际使用的 workspace。
- `inputBytes`：发送给 provider 的 UTF-8 字节数。
- `externalApiCalled`：本次请求是否真正调用了外部 provider。
- `usage`：provider 返回时记录 prompt、completion 和总 token 数。
- `recovery`：报告的解析方式、是否截断、丢弃的尾部字节数、恢复警告和估算完整度。

缓存命中时 `externalApiCalled` 为 `false`；此时附带的 usage 表示原始缓存任务的历史消耗，不代表本次产生了新调用。provider 不返回 usage 时仍可正常使用，服务器不会伪造精确 token 数。

格式损坏或被截断的 provider 输出不会自动导致整项任务作废。服务器会依次尝试严格解析、JSON 修复、完整 finding 抢救、结构化文本提取，最后保留有长度限制的 `raw_advice`。恢复后的报告会通过 `recovery.parseMode` 标记为 `strict`、`repaired`、`salvaged`、`text_fallback` 或 `raw_fallback`。可用的恢复报告不会自动重试，由 Codex 判断是否需要补充调用。

## 安全模型

- MCP 工具保持只读：不运行 shell、不应用补丁、不执行迁移、格式化或测试。
- deny 规则优先于 allow 规则。
- 默认 deny 规则阻止 `.env`、依赖目录、构建产物、密钥、证书、压缩包、图片、PDF 和 Git 内部文件。
- 符号链接不可逃逸 workspace 根目录。
- 缓存仅保存哈希和模型报告，不保存原始源文件。
- API key 只从环境变量读取。
- 允许读取的源码与日志会发送给用户选择的第三方 provider，并受该 provider 的数据政策约束。
- 外部模型报告仅供参考；Codex 编辑前应验证重要证据。

## 许可证

MIT
