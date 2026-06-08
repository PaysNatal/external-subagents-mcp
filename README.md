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
external-subagents-mcp init
```

This creates `.external-subagents-mcp.json` with safe workspace defaults, a single-provider profile, and optional multi-provider profiles. It refuses to overwrite an existing config.

### 3. Configure your provider

Open `.external-subagents-mcp.json` and edit the provider you want to use:

```json
{
  "providers": {
    "primary": {
      "base_url": "https://your-provider.example/v1",
      "api_key_env": "EXTERNAL_SUBAGENTS_PRIMARY_API_KEY",
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
"api_key_env": "EXTERNAL_SUBAGENTS_PRIMARY_API_KEY"
```

The matching environment variable must contain the real secret.

For a temporary macOS/Linux shell session:

```bash
export EXTERNAL_SUBAGENTS_PRIMARY_API_KEY="your-api-key"
```

For a persistent macOS/Linux setup, keep secrets outside the project:

```bash
mkdir -p ~/.config/external-subagents-mcp
chmod 700 ~/.config/external-subagents-mcp
${EDITOR:-nano} ~/.config/external-subagents-mcp/env
```

Add the required variables to that file:

```bash
export EXTERNAL_SUBAGENTS_PRIMARY_API_KEY="your-api-key"
export EXTERNAL_SUBAGENTS_BULK_API_KEY="your-api-key"
export EXTERNAL_SUBAGENTS_QUALITY_API_KEY="your-api-key"
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
[Environment]::SetEnvironmentVariable("EXTERNAL_SUBAGENTS_PRIMARY_API_KEY", "your-api-key", "User")
```

Restart the terminal and Codex after changing persistent environment variables.

### 5. Connect it to Codex

Add this to `~/.codex/config.toml` on macOS/Linux or `%USERPROFILE%\.codex\config.toml` on Windows:

```toml
[mcp_servers.external_subagents]
command = "npx"
args = ["-y", "external-subagents-mcp"]
env_vars = [
  "EXTERNAL_SUBAGENTS_PRIMARY_API_KEY",
  "EXTERNAL_SUBAGENTS_BULK_API_KEY",
  "EXTERNAL_SUBAGENTS_QUALITY_API_KEY",
  "EXTERNAL_SUBAGENTS_CONFIG"
]
startup_timeout_sec = 20
tool_timeout_sec = 300
```

`env_vars` contains variable names only, never secret values. Remove names for providers you do not use, then restart Codex.

### 6. Verify the setup

```bash
external-subagents-mcp doctor
external-subagents-mcp smoke --provider primary
```

`doctor` shows active routing, missing environment variables, models, and computed chat-completions URLs without printing secrets.

## Profiles: one-line strategy switching

Profiles are the main way to control which model handles each role. Use semantic provider names such as `bulk`, `quality`, and `primary`; the providers can point to any compatible API.

The generated config includes:

- `single_provider`: one provider handles every role. Best for initial setup.
- `cost_first`: a low-cost provider handles bulk work; a stronger provider handles review.
- `quality_first`: a low-cost provider summarizes; a stronger provider handles review, logs, and file discovery.

Switch the active strategy by changing one line:

```json
{
  "routing": {
    "profile": "cost_first"
  }
}
```

Each profile maps four roles:

```json
{
  "profiles": {
    "cost_first": {
      "summarizer": "bulk",
      "reviewer": "quality",
      "log_analyst": "bulk",
      "file_finder": "bulk"
    }
  }
}
```

API keys are lazy by provider use. A missing key does not prevent startup; a job fails clearly only when it routes to that provider.

## Configuration reference

Config lookup order:

1. Path in `EXTERNAL_SUBAGENTS_CONFIG`
2. `.external-subagents-mcp.json`, searched upward from the current project
3. `~/.config/external-subagents-mcp/config.json`

Important sections:

- `workspace.allow`: files external models may read.
- `workspace.deny`: files that are always blocked. Deny rules win.
- `providers`: OpenAI-compatible endpoints, models, and API-key environment variable names.
- `profiles`: reusable role-to-provider assignments.
- `routing.profile`: active profile.
- `routing.auto_rules`: optional first-match provider routing rules.
- `routing.budget_rules`: optional output-budget increases for large tasks.

`routing.mode = "auto"` can select a provider based on job type, role, or input size. It does not compress or rewrite the prompt.

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

## Safety model

- The MCP tools are read-only: no shell, patches, migrations, formatting, or test execution.
- Deny rules override allow rules.
- Default deny rules block `.env`, dependencies, build output, keys, certificates, archives, images, PDFs, and Git internals.
- Symlinks may not escape the workspace root.
- Cache stores hashes and model reports, not raw source files.
- API keys are read from environment variables only.
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
external-subagents-mcp init
```

工具会自动创建 `.external-subagents-mcp.json`，其中包含安全的 workspace 默认值、单模型 profile 和可选的多模型 profiles。已有配置不会被覆盖。

### 3. 配置你的 Provider

打开 `.external-subagents-mcp.json`，修改要使用的 provider：

```json
{
  "providers": {
    "primary": {
      "base_url": "https://your-provider.example/v1",
      "api_key_env": "EXTERNAL_SUBAGENTS_PRIMARY_API_KEY",
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
"api_key_env": "EXTERNAL_SUBAGENTS_PRIMARY_API_KEY"
```

同名环境变量中才存放真正的 API key。

macOS/Linux 当前终端临时使用：

```bash
export EXTERNAL_SUBAGENTS_PRIMARY_API_KEY="your-api-key"
```

macOS/Linux 持久设置时，建议将密钥文件放在项目之外：

```bash
mkdir -p ~/.config/external-subagents-mcp
chmod 700 ~/.config/external-subagents-mcp
${EDITOR:-nano} ~/.config/external-subagents-mcp/env
```

在打开的文件中填写需要使用的变量：

```bash
export EXTERNAL_SUBAGENTS_PRIMARY_API_KEY="your-api-key"
export EXTERNAL_SUBAGENTS_BULK_API_KEY="your-api-key"
export EXTERNAL_SUBAGENTS_QUALITY_API_KEY="your-api-key"
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
[Environment]::SetEnvironmentVariable("EXTERNAL_SUBAGENTS_PRIMARY_API_KEY", "your-api-key", "User")
```

修改持久环境变量后，请重启终端和 Codex。

### 5. 接入 Codex

在 macOS/Linux 的 `~/.codex/config.toml`，或 Windows 的 `%USERPROFILE%\.codex\config.toml` 中加入：

```toml
[mcp_servers.external_subagents]
command = "npx"
args = ["-y", "external-subagents-mcp"]
env_vars = [
  "EXTERNAL_SUBAGENTS_PRIMARY_API_KEY",
  "EXTERNAL_SUBAGENTS_BULK_API_KEY",
  "EXTERNAL_SUBAGENTS_QUALITY_API_KEY",
  "EXTERNAL_SUBAGENTS_CONFIG"
]
startup_timeout_sec = 20
tool_timeout_sec = 300
```

`env_vars` 中只填写变量名，绝不能填写密钥值。删除没有使用的 provider 变量名，然后重启 Codex。

### 6. 验证配置

```bash
external-subagents-mcp doctor
external-subagents-mcp smoke --provider primary
```

`doctor` 会显示当前路由、缺失的环境变量、模型和最终 chat-completions URL，但不会打印密钥。

## Profiles：一行切换模型策略

Profiles 是控制不同角色使用哪个模型的主要方式。建议使用 `bulk`、`quality`、`primary` 这类语义化 provider 名称；它们可以指向任意兼容 API。

自动生成的配置包含：

- `single_provider`：一个 provider 完成所有角色，最适合首次配置。
- `cost_first`：低成本 provider 承担大批量工作，更强的 provider 负责代码审查。
- `quality_first`：低成本 provider 负责摘要，更强的 provider 负责审查、日志分析和文件定位。

只需修改一行即可切换活跃策略：

```json
{
  "routing": {
    "profile": "cost_first"
  }
}
```

每个 profile 分配四种角色：

```json
{
  "profiles": {
    "cost_first": {
      "summarizer": "bulk",
      "reviewer": "quality",
      "log_analyst": "bulk",
      "file_finder": "bulk"
    }
  }
}
```

API key 按 provider 实际使用情况延迟生效。缺少未使用 provider 的 key 不会阻止启动；只有任务真正路由到它时才会明确失败。

## 配置参考

配置查找顺序：

1. `EXTERNAL_SUBAGENTS_CONFIG` 指定的路径
2. 从当前项目向上查找 `.external-subagents-mcp.json`
3. `~/.config/external-subagents-mcp/config.json`

重要配置段：

- `workspace.allow`：允许外部模型读取的文件。
- `workspace.deny`：始终禁止读取的文件；deny 优先。
- `providers`：OpenAI-compatible endpoint、模型和 API key 环境变量名称。
- `profiles`：可复用的角色与 provider 分配方案。
- `routing.profile`：当前活跃 profile。
- `routing.auto_rules`：可选的首匹配自动路由规则。
- `routing.budget_rules`：可选的大任务输出预算提升规则。

`routing.mode = "auto"` 可以根据任务类型、角色或输入大小选择 provider，但不会压缩或重写 prompt。

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

## 安全模型

- MCP 工具保持只读：不运行 shell、不应用补丁、不执行迁移、格式化或测试。
- deny 规则优先于 allow 规则。
- 默认 deny 规则阻止 `.env`、依赖目录、构建产物、密钥、证书、压缩包、图片、PDF 和 Git 内部文件。
- 符号链接不可逃逸 workspace 根目录。
- 缓存仅保存哈希和模型报告，不保存原始源文件。
- API key 只从环境变量读取。
- 外部模型报告仅供参考；Codex 编辑前应验证重要证据。

## 许可证

MIT
