# external-subagents-mcp 委托机制审查报告

## 审查范围

本报告审查 external-subagents-mcp 项目的 MCP 委托链路中，Codex（贵模型）对外部子代理（便宜模型）的监督能力与 token 经济性。核心问题是：**Codex 能否在子代理执行过程中及时观察并纠正方向，而非在错误地基上垒砖。**

审查基于项目源码（截至 commit `55292f2`），不包含任何代码修改建议的具体实现，仅提供分析结论供作者自行决策。

---

## 一、当前架构的委托链路分析

### 1.1 调用时序

一次完整的委托流程如下：

```
Codex 调用 delegate_summarize_paths (或同类 tool)
  └─ MCP server 立即返回 JobRecord { state: "queued" }
  └─ JobManager.queueMicrotask → pump() → run()
     └─ OpenAICompatibleProvider.runReport()
        └─ 单次 HTTP POST 到 /chat/completions
        └─ 外部模型独自处理完整 prompt
        └─ 返回完整 DelegateReport JSON
  └─ Codex 调用 delegate_wait → 轮询直到 isFinal(state)
  └─ Codex 调用 delegate_result → 获取最终报告
  └─ Codex 做出决策
```

### 1.2 黑盒识别

链路中有三个信息断层，Codex 无法穿透：

**断层 1：prompt 组装到 HTTP 请求发出之间。** `app.ts` 的 `delegateSummarizePaths()` 等方法组装了完整的 prompt（含 baseInstructions、focus、文件内容、REPORT_CONTRACT），但 Codex 看不到这个 prompt 的具体内容。Codex 只传入 `paths`、`focus` 等参数，prompt 的膨胀（从几十 token 的参数到几千 token 的完整请求）发生在 MCP server 内部。

**断层 2：外部模型推理过程。** `provider.ts` 的 `runReport()` 是一个单次 HTTP POST，使用 `messages: [system, user]` 二元组发送请求，等待完整 `choices[0].message.content` 返回。外部模型的推理过程对 Codex 完全不可见——没有中间步骤、没有推理链暴露、没有 checkpoint。

**断层 3：JobRecord 的粒度。** `delegate_wait()` 的轮询粒度是 job 级别，只能区分 `queued | running | completed | failed | cancelled` 五种状态，无法区分"外部模型正在分析第 N 个文件"这样的细粒度进度。`wait()` 内部实现是 10-100ms sleep 轮询 `isFinal(state)`，本质是等一个离散终态信号，而非连续进度流。

### 1.3 cancel 机制的局限

`delegate_cancel` 可以通过 `AbortController.abort()` 中断 HTTP 请求。但这是"丢弃结果"，不是"纠正方向"：

- 中断后 job 进入 `cancelled` 状态，已产生的推理结果丢失
- Codex 必须从零重新发起一个新委托，无法在已有正确部分的基础上修正方向
- chat completions API 的计费模型中，`abort` 只取消客户端的 HTTP 连接，服务端已经产生的 output token 仍计费（多数 provider 的做法）

### 1.4 Report Contract 的终点式结构

当前 `REPORT_CONTRACT` 要求外部模型返回的 JSON 形状是：

```json
{
  "status": "DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED | FAILED",
  "summary": "一句话总结",
  "findings": [{ "severity", "title", "description", "evidence", "recommendation", "confidence" }],
  "next_actions": ["下一步操作建议"],
  "omitted": ["被省略的内容和原因"]
}
```

这是一个**终点式报告**——所有 findings 是平铺的，没有因果或时序依赖关系。Codex 无法从 report 结构中判断"finding A 的结论是否建立在 finding B 的错误假设上"，因为 findings 之间没有 `depends_on` 或 `phase` 这样的依赖标注。

---

## 二、Token 经济模型

### 2.1 成本比率

项目的设计意图是让便宜模型承担大量 token 消耗（读文件、生成分析），贵模型只做少量高质量决策。当前市场价格差：

| 类别 | 输入价格/百万 token | 输出价格/百万 token | 代表模型 |
|------|---------------------|---------------------|----------|
| 贵模型 | $2.5 - $5 | $10 - $15 | GPT-4o, Claude Sonnet |
| 便宜模型 | $0.14 - $1 | $0.28 - $2 | DeepSeek V3, MiMo, GLM-5.1 |

**贵/便宜成本比率：输入 5-50x，输出 5-75x。**

这意味着：

- 节省 1 个贵模型 token 的经济价值 ≥ 节省 5-75 个便宜模型 token
- 任何增加贵模型轮次的方案，必须在"方向错误"场景中节省足够多的贵模型错误决策 token 才能盈亏平衡
- 节省便宜模型 token 的重要性远低于节省贵模型 token

### 2.2 当前基准的 token 消耗

以一次 `delegate_review_diff` 为例（reviewer 角色，max_output_tokens = 3000）：

| 步骤 | 贵模型 token | 便宜模型 token |
|------|-------------|---------------|
| Codex 调用 delegate_review_diff | ~300 | 0 |
| 便宜模型输入（prompt 组装后） | 0 | ~5,000 - 8,000 |
| 便宜模型输出（report） | 0 | ~2,000 - 3,000 |
| Codex 调用 delegate_wait | ~100 | 0 |
| Codex 读取 result 并决策 | 输入 ~3,000 + 输出 ~500-1,000 | 0 |
| **合计** | **~3,900 - 4,400** | **~7,000 - 11,000** |

贵模型仅出场 2 次（发起 + 收结果），便宜模型承担全部体力活。这是**成本最优的交互模式**——贵模型轮次最少，便宜模型利用率最高。

---

## 三、方案 B：Report Contract 推理链标注

### 3.1 问题定义

当前 report 的 findings 是扁平列表，Codex 无法判断 findings 之间的因果依赖。如果一个 finding 的结论建立在另一个 finding 的错误前提上，Codex 只能整体接受或整体质疑 report，无法精确定位"地基哪一块有问题"。

### 3.2 改动描述

在 `REPORT_CONTRACT` 和 `DelegateReport` 类型中为每个 finding 增加 `phase` 和 `depends_on` 字段：

当前 shape：
```json
{
  "findings": [
    { "severity": "high", "title": "...", "description": "...", "evidence": [...], "recommendation": "...", "confidence": 0.8 }
  ]
}
```

扩展后 shape：
```json
{
  "findings": [
    {
      "phase": "discovery",
      "severity": "high",
      "title": "...",
      "description": "...",
      "evidence": [...],
      "recommendation": "...",
      "confidence": 0.8,
      "depends_on": []
    },
    {
      "phase": "analysis",
      "severity": "medium",
      "title": "...",
      "description": "...",
      "evidence": [...],
      "recommendation": "...",
      "confidence": 0.6,
      "depends_on": ["discovery#0"]
    }
  ]
}
```

`phase` 标注该 finding 属于推理的哪个阶段（如 `discovery`、`analysis`、`verification`、`recommendation`），`depends_on` 用 `phase#index` 格式标注该 finding 依赖哪个前置 finding 的结论。

### 3.3 涉及的源码位置

| 文件 | 改动点 |
|------|--------|
| `src/report.ts` | `REPORT_CONTRACT` 常量：在 prompt 指令中增加 phase 和 depends_on 的输出要求；`delegateReportSchema` 中为 findings 内的 object 增加 `phase` 和 `depends_on` 字段（可选，default 空） |
| `src/types.ts` | `DelegateFinding` interface：增加 `phase?: string` 和 `depends_on?: string[]` |
| `src/app.ts` | `baseInstructions()` 函数：无需改动（phase/depends_on 是输出格式要求，不是输入指令） |

改动量约 10-15 行，不影响任何现有逻辑流程。

### 3.4 token 经济分析

| 项目 | 贵模型增量 | 便宜模型增量 | 说明 |
|------|-----------|-------------|------|
| 便宜模型输出增加 phase/depends_on 字段 | 0 | +100 - 200 | 每个 finding 多 2 个字段，典型 report 有 3-5 个 findings，JSON 开销很小 |
| Codex 读取同样大小的 report | 0 | 0 | report 总 token 量几乎不变，只是结构更丰富 |
| Codex 检查推理链一致性 | +100 - 300 | 0 | Codex 在决策前多花一两百 token 检查 "depends_on 引用的 finding 是否逻辑自洽" |
| **合计增量** | **+100 - 300** | **+100 - 200** | |
| **合计增幅** | **约 2-7%** | **约 1-3%** | |

这是四个方案中唯一几乎不增加成本的改进。贵模型增幅 2-7%，便宜模型增幅 1-3%，均在噪声范围内。

### 3.5 Codex 使用推理链的方式

Codex 获得带推理链的 report 后，可以在决策时执行以下检查（不增加额外 MCP 调用）：

1. **地基审查**：检查 `phase: "discovery"` 的 findings 的 `confidence` 是否普遍偏低（< 0.5）。如果地基 findings 的置信度低，后续依赖它们的 analysis findings 可靠性存疑。
2. **依赖断裂检测**：检查 `depends_on` 引用的 finding index 是否存在，以及被依赖的 finding 的 `severity` 是否为 `high`（高严重度 finding 如果是地基，后续分析可能建立在已知缺陷上）。
3. **定向验证**：如果发现地基 finding 的 `evidence` 引用了某个文件某几行，Codex 可以直接读取那个文件验证——这是当前的已有能力，不需要新 tool。

以上检查全部在 Codex 端完成，不需要新的 MCP tool，不需要额外的委托调用。

### 3.6 外部模型的合作度风险

`phase` 和 `depends_on` 是 prompt 指令要求，不是 API 强制约束。外部模型是否可靠地输出这些字段取决于：

- 模型对结构化 JSON 输出的遵循能力（GLM、DeepSeek 通常较好，MiMo 在 token plan 下可能不稳定）
- prompt 中指令的明确程度
- `delegateReportSchema` 的 zod 验证是否将这两个字段设为 optional + default 空值（如果是，模型不输出也不会报错，只是 Codex 收到没有推理链的 report）

建议在 schema 中将 `phase` 和 `depends_on` 设为 `optional().default(undefined)` 和 `.default([])`，这样：
- 模型输出这些字段 → Codex 获得推理链，可以做地基审查
- 模型不输出这些字段 → Codex 收到和当前完全一样的扁平 findings，不影响任何现有功能

这确保了**向后兼容**——新字段是增强而非替换。

### 3.7 风险评估

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 外部模型不输出 phase/depends_on | 中-高 | 低（fallback 到当前行为） | schema optional + default |
| phase 值不一致（不同模型用不同阶段名） | 中 | 低（Codex 只检查是否存在，不依赖具体值） | REPORT_CONTRACT 中列出建议 phase 值 |
| depends_on 引用错误 index | 低 | 低（Codex 可忽略无效引用） | Codex 端容错处理 |
| 增加 prompt token 消耗 | 极低 | 极低（REPORT_CONTRACT 增加 ~50 token） | 无需缓解 |

### 3.8 结论

方案 B 的核心价值是：**以几乎零成本赋予 Codex "事后追溯推理链"的能力**。它不改变交互模式（仍然是 1 次发起→1 次收结果），不增加贵模型轮次，只在便宜模型输出中增加少量结构化字段。Codex 可以在决策前花极少量 token 检查推理链的内部一致性，相当于获得了一个"地基审计"能力，而审计成本不到总成本的 5%。

它不解决"事中纠正"问题——Codex 仍然只能在拿到最终 report 后才看到推理链，无法在子代理执行过程中介入。但它在成本最优的前提下，最大程度缓解了"在错误地基上垒砖"的风险：Codex 可以在垒砖之前审查地基。

---

## 四、方案 D：Streaming 输出 + 语义 Checkpoint（未来可选演进）

### 4.1 问题定义

方案 B 解决了"事后审查地基"的问题，但 Codex 仍然无法在子代理执行过程中实时观察其推理方向。如果外部模型在推理早期就走偏，方案 B 只能让 Codex 在事后发现"地基有问题"，但此时便宜模型的 token 已经全部消耗完毕，无法挽回。

方案 D 探索一种在执行过程中暴露中间语义信息的方式，让 Codex 有机会在子代理还在推理时就判断方向是否正确。

### 4.2 技术路径

方案 D 由两个独立子机制组成，可以分别或组合实现：

**子机制 D1：chat completions streaming 输出**

当前 `provider.ts` 的 `runReport()` 使用非 streaming 请求（`stream` 参数未设置，默认 `false`）。启用 `stream: true` 后，外部模型的输出以 SSE（Server-Sent Events）格式逐 token 返回。

改动点在 `provider.ts`：

- 请求体增加 `"stream": true`
- 响应处理从 `response.json()` 改为逐行解析 SSE `data: {...}` 事件
- 每个 SSE chunk 的 `choices[0].delta.content` 拼接为增量文本
- 需要一个 `onChunk` callback 将增量文本传递给上层

**子机制 D2：MCP notification 传递语义 checkpoint**

MCP 协议支持 server 向 client 发送 notification（`notifications/message`）。在 streaming 输出中，MCP server 可以在检测到特定语义标记时向 Codex 发送 notification。

具体做法：

- 在 `REPORT_CONTRACT` 中要求外部模型在关键推理转折点输出 `[CHECKPOINT]` 标记，如：
  ```
  [CHECKPOINT:discovery] I've identified 3 files with potential issues...
  [CHECKPOINT:analysis] Based on the discovery phase, I'm now analyzing...
  ```
- `provider.ts` 的 streaming handler 在每个 SSE chunk 中检测 `[CHECKPOINT]` 标记
- 检测到 checkpoint 时，MCP server 通过 `server.notification()` 向 Codex 发送一个结构化 notification：
  ```json
  { "method": "notifications/message", "params": { "level": "info", "data": { "job_id": "job_xxx", "checkpoint": "discovery", "preview": "..." } } }
  ```
- Codex 收到 notification 后可以选择：忽略（继续等待最终结果），或调用 `delegate_cancel` 中断任务

### 4.3 涉及的源码位置

| 文件 | 改动点 |
|------|--------|
| `src/provider.ts` | `runReport()` 改为 streaming 模式；新增 `onChunk?: (text: string) => void` callback 参数；SSE 解析逻辑 |
| `src/types.ts` | `ProviderRunRequest` 增加 `onChunk` 字段 |
| `src/jobs.ts` | `QueuedJob` 增加 `onCheckpoint` callback；`run()` 方法将 provider 的 chunk 传递给 checkpoint 检测器 |
| `src/server.ts` | 新增 `delegate_stream_subscribe` tool 或利用 MCP notification 机制推送 checkpoint |
| `src/report.ts` | `REPORT_CONTRACT` 增加 checkpoint 输出指令 |

改动量约 80-120 行，涉及 5 个文件，属于中等架构改动。

### 4.4 token 经济分析

**场景 1：方向正确，Codex 不介入**

| 项目 | 贵模型增量 | 便宜模型增量 | 说明 |
|------|-----------|-------------|------|
| 便宜模型输出 checkpoint 标记 | 0 | +100 - 300 | `[CHECKPOINT:xxx]` 文本开销很小 |
| MCP notification 传递 | 0 | 0 | notification 不消耗模型 token |
| Codex 处理 notification | +200 - 600 | 0 | 收到 1-3 个 notification，每个花 100-200 token 判断是否需要介入 |
| **合计增量** | **+200 - 600** | **+100 - 300** | |
| **合计增幅** | **约 5 - 15%** | **约 1 - 3%** | |

贵模型增幅 5-15%，便宜模型增幅 1-3%。在"方向正确"的场景下，额外成本中等偏小，但不是零。

**场景 2：方向错误，Codex 在 checkpoint 处介入并 cancel**

| 项目 | 贵模型增量 | 便宜模型 | 说明 |
|------|-----------|---------|------|
| Codex 处理 notification 并判断方向错误 | +200 - 600 | 0 | 同场景 1 |
| Codex 调用 delegate_cancel | +100 | 0 | 一次 tool call |
| 便宜模型已消耗的 output token | 0 | **不可挽回** | chat completions streaming 的计费模型：服务端已生成全部 token，客户端 cancel 不影响计费 |
| Codex 不做错误决策节省的 token | **-500 - -1,000** | 0 | 避免基于错误 report 做出代码修改决策 |
| **净增量** | **-200 - +200** | **+100 - 300（已消耗，不可挽回）** | |

在介入场景下，贵模型的净增量可能是正或负——取决于 Codex 做错误决策的后果严重度。如果错误决策会导致 Codex 进行多轮代码修改（消耗大量贵模型 output token），则介入可以净节省贵模型 token。如果错误决策后果轻微（Codex 只做了一轮小修改就发现不对），则介入成本可能高于错误损失。

**关键事实：便宜模型的 token 在 cancel 后不可挽回。** 无论 Codex 是否介入，便宜模型都已经消耗了从开始到被 cancel 时刻的所有 output token。Streaming cancel 只停止接收后续 token，不减少已发生的计费。这是 chat completions API 的固有特性，不是项目代码可以改变的。

### 4.5 checkpoint 的语义粒度问题

`[CHECKPOINT]` 标记的语义有效性取决于外部模型是否在真正的推理转折点输出标记，而非机械地在固定位置输出。存在以下风险：

- **模型在 checkpoint 中给出的"preview"可能是表面性的**：如"I've identified some issues"这样的概括对 Codex 判断方向是否正确几乎没有帮助。有价值的 checkpoint 需要包含具体结论片段，如"I found that the auth module uses MD5 hashing which is insecure"——但这又意味着 checkpoint 本身消耗更多 output token。
- **不同模型对 checkpoint 指令的遵循度不同**：GLM 可能较好遵循，MiMo 在 token plan 限制下可能忽略或输出格式不规范的 checkpoint。
- **checkpoint 过密会增加贵模型审查成本**：如果模型在每个 finding 前都输出 checkpoint，Codex 需要处理 3-5 个 notification，审查成本翻倍。checkpoint 应只在推理方向的关键转折点出现（discovery→analysis 转换、重大假设变更等）。

### 4.6 MCP notification 的实际可达性

MCP 的 `notifications/message` 是协议定义的标准能力，但 Codex 端是否真正接收和响应 MCP notification 取决于 Codex 的实现：

- 如果 Codex 在 tool call 等待期间不处理 notification（只等 tool result），则 notification 会被静默丢弃，方案 D 的实时介入能力失效
- 如果 Codex 的消息循环在等待 tool result 的同时处理 notification，则方案 D 可工作
- 当前 Codex（OpenAI 的实现）对 MCP notification 的处理行为未在公开文档中明确说明

这意味着方案 D 的"事中纠正"能力**依赖 Codex 端的配合**，不是 MCP server 单方面可以保证的。如果 Codex 不处理 notification，方案 D 退化为"streaming 输出最终拼接为完整 report"——和当前非 streaming 行为等价，只是便宜模型多了 checkpoint 标记的 token 开销。

### 4.7 部分 provider 的 streaming 支持状态

| Provider | streaming 支持 | 说明 |
|----------|---------------|------|
| DeepSeek | 是 | 标准 SSE，兼容 OpenAI 格式 |
| GLM (Z.AI) | 是 | 标准 SSE，兼容 OpenAI 格式 |
| MiMo | 需确认 | token plan 文档中未明确标注 streaming 支持 |
| MiniMax | 是 | 但 chat_completions_path 为非标准路径，需测试 SSE 行为 |
| Qwen/DashScope | 是 | 兼容 OpenAI 格式 |

如果目标 provider 不支持 streaming，`provider.ts` 需要 fallback 到非 streaming 模式。这增加了代码复杂度：`runReport()` 需要根据 provider 配置决定是否启用 streaming。

### 4.8 风险评估

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| Codex 不处理 MCP notification | 中-高 | 高（方案 D 退化为纯 streaming，事中纠正能力失效） | 先验证 Codex notification 行为再决定是否实现 |
| Provider 不支持 streaming | 低-中 | 中（需 fallback 逻辑） | 配置中增加 `streaming: boolean` 字段，不支持时自动降级 |
| Checkpoint 格式不规范 | 中 | 低（Codex 可忽略无法解析的 checkpoint） | notification 中传原始文本，Codex 自行判断 |
| Streaming 解析增加 provider.ts 复杂度 | 确定 | 中（SSE 解析、增量拼接、错误恢复） | 可使用 `EventSource` 或手工解析，参考 OpenAI SDK 实现 |
| 便宜模型 token cancel 后不可挽回 | 确定 | 低-中（取决于 checkpoint 出现时机） | 在 prompt 中要求模型尽早输出 checkpoint（在 discovery 阶段而非分析完成后） |

### 4.9 与方案 B 的组合关系

方案 D 和方案 B 不是互斥的，而是叠加的：

- 方案 B 赋予 Codex "事后审查推理链"的能力（成本 +2-7%）
- 方案 D 赋予 Codex "事中接收语义 checkpoint"的能力（成本 +5-15%）
- 两者组合：Codex 在执行过程中收到 checkpoint notification（方案 D），在最终 report 中看到完整的 phase/depends_on 推理链（方案 B）

如果 Codex 不处理 notification，方案 D 的 checkpoint 机制失效，但方案 B 的推理链仍然在最终 report 中有效——因为 streaming 输出的 checkpoint 标记会被 `parseDelegateReport()` 的 `extractJsonObject()` 过滤掉（checkpoint 在 JSON 之外），不影响 report 解析。

**建议的实现顺序：先实现方案 B（低成本、低风险），验证 Codex 对推理链的使用效果后，再评估方案 D 的必要性。** 如果方案 B 已经足够让 Codex 有效审查地基，方案 D 可能不需要。如果方案 B 的事后审查不够（Codex 经常在拿到 report 后才发现方向错误但便宜 token 已消耗），则方案 D 的事中 checkpoint 有额外价值。

### 4.10 结论

方案 D 的核心价值是：**让 Codex 有机会在子代理执行过程中判断方向是否正确，而非只能在事后审查。** 但它的实际效果受三个外部因素制约：

1. Codex 是否真正处理 MCP notification（未知，需验证）
2. 目标 provider 是否支持 streaming（大部分支持，MiMo 需确认）
3. cancel 后便宜模型 token 是否可挽回（不可挽回，这是 chat completions API 的固有限制）

在成本上，方案 D 在"方向正确"时增加 5-15% 贵模型开销；在"方向错误且成功介入"时可能盈亏平衡或小幅节省贵模型 token，但便宜模型 token 不可挽回。整体而言，方案 D 的成本效益不如方案 B，但提供了方案 B 无法提供的事中观察能力。

方案 D 适合作为**未来可选演进**，在以下条件满足后推进：

- 已确认 Codex 处理 MCP notification
- 已确认所有目标 provider 支持 streaming
- 方案 B 已实现并验证，确认事后审查不够充分
- 项目已有足够的用户反馈数据，表明"方向错误"是实际高频问题

---

## 五、不推荐的方案简述（供参考）

### 方案 A：缩小任务粒度

将大委托拆成多个小委托，Codex 在每个小委托后验证方向。贵模型 token 增幅 70-100%，便宜模型增幅 3-5%。在贵/便宜成本比率 5-75x 下，额外贵模型 token 的等价便宜模型 token 价值远超任何可能的节省。**方向正确时严重亏本，只有错误率 > 50% 时可能不亏。** 不推荐。

### 方案 C：Multi-turn 委托

3 轮对话式委托，Codex 在每轮之间介入。贵模型 token 增幅 60-90%，便宜模型 token 增幅 18-40%（累积上下文重发）。**两个模型都更贵了。** 即使成功拦截错误，审查成本可能高于错误损失。不推荐。

---

## 六、总评

当前架构的"1 次发起→1 次收结果"交互模式在 token 经济性上是最优的。Codex 轮次最少（2 次），便宜模型利用率最高（单次调用处理全部任务）。任何增加 Codex 轮次的方案都会因为贵/便宜 5-75x 的成本差而在"方向正确"时亏本。

方案 B 以几乎零成本（+2-7% 贵模型、+1-3% 便宜模型）赋予 Codex 事后审查推理链的能力，是成本效益最高的改进。它在 report 中增加 `phase` 和 `depends_on` 字段，让 Codex 可以在决策前检查 findings 之间的因果依赖是否自洽——相当于用不到 5% 的额外成本获得了一个"地基审计"能力。

方案 D 以中等偏小成本（+5-15% 贵模型、+1-3% 便宜模型）提供事中观察能力，但实际效果受 Codex notification 处理、provider streaming 支持、cancel 不可挽回便宜 token 三个外部因素制约。适合作为未来可选演进，在方案 B 验证不够充分后再评估。

两个方案都不改变项目的核心交互模式，都是增量增强而非架构重构。作者可以根据实际使用中遇到的"方向错误"频率和后果严重度，自行决定实现优先级。