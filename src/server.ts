import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import path from "node:path";
import * as z from "zod/v4";
import type { ExternalSubagentsApp } from "./app.js";
import type { JobRecord } from "./types.js";

export const SERVER_INSTRUCTIONS = `external-subagents-mcp: read-only external model delegates that keep Codex's context clear for judgment, implementation, and verification.

Before large source reads, content searches, log ingestion, broad file discovery, summarization, or initial review, Codex should delegate read-heavy labor by default. Use external delegates when the main cost is reading, searching, extracting, summarizing, or analyzing evidence that Codex can spot-check later.

All task tools (explore, summarize, review, find_files, analyze_log) return a job record. Use delegate_wait then delegate_result to retrieve the structured report.

Delegates are read-only guardrailed workers: they never edit files, run shell commands, run tests, format, migrate, patch, or decide architecture. Codex remains the primary owner for understanding, planning, decisions, edits, commands, verification, and acceptance.

Prefer path-based delegation so large source files do not enter Codex context. When the project to read is not the server's default workspace, pass its absolute root as workspace_root; that root must directly contain .external-subagents-mcp.json. Use diff_text or log_text only when path-based input is unavailable.

The external model output is advisory. Codex must verify cited files and line numbers before changing code.

Optionally use delegate_provider_status and delegate_provider_smoke once at the start of a session to check API keys, routing, and model connectivity. They are not required before every delegation.

Tool selection guide:
- investigate an unfamiliar workspace through bounded multi-turn reads and searches → delegate_explore_workspace
- summarize or compress files → delegate_summarize_paths
- review code or diff → delegate_review_diff
- search or locate relevant files → delegate_find_relevant_files
- debug or analyze errors, logs, crashes → delegate_analyze_log

These tools must not serve as implementers.

delegate_explore_workspace requires an OpenAI-compatible provider that supports tool calling. It exposes only bounded read-only list, search, and file-read tools. If tool calling is unavailable, Codex should use the known-path tools or investigate directly.

Job records expose externalApiCalled, inputBytes, provider usage, and exploration telemetry when available. For explorer jobs, inputBytes covers the initial task prompt while exploration.sourceBytesRead records workspace source read during the tool loop. A cache hit reports externalApiCalled=false because the current request did not call the provider; any attached usage and exploration telemetry are historical usage from the original cached run.

Provider output is recovered progressively when possible: strict JSON, repaired JSON, salvaged complete findings, structured text fallback, then bounded raw advice. Inspect job recovery metadata before acting on repaired or truncated reports; do not automatically retry a usable recovered report.

When compacting context, preserve the plain-text summary line above the JSON separator (---). It contains the status, summary, severity ranking, and evidence paths. The nested JSON below the separator may be compressed, but the summary line must be kept intact because it holds the key conclusions and file references Codex needs for verification.`;

export const SERVER_VERSION = "0.3.2";

const cacheMode = z.enum(["read_write", "read_only", "skip"]).default("read_write").describe("Cache behavior: read_write (default — cache and reuse), read_only (reuse but don't write new entries), skip (no cache)");
const workspaceRoot = z
  .string()
  .min(1)
  .max(4096)
  .refine(value => path.isAbsolute(value), "workspace_root must be an absolute path")
  .optional()
  .describe("Absolute root of another project to read. The directory must directly contain .external-subagents-mcp.json");

export function createMcpServer(app: ExternalSubagentsApp): McpServer {
  const server = new McpServer(
    { name: "external-subagents-mcp", version: SERVER_VERSION },
    { instructions: SERVER_INSTRUCTIONS }
  );

  server.registerTool(
    "delegate_provider_status",
    {
      title: "Check provider routing and API key setup",
      description:
        "Optionally run once at session start or after config changes to inspect configured providers, missing API keys, and role routing. Does not expose secrets and is not required before every delegation.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      inputSchema: z.object({})
    },
    async () => toolResult(app.providerStatus())
  );

  server.registerTool(
    "delegate_provider_smoke",
    {
      title: "Smoke-test one provider",
      description:
        "Optionally run after delegate_provider_status when connectivity is uncertain. Sends one minimal chat completion to verify a provider's base_url, API key, model ID, and report format before expensive delegation.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      inputSchema: {
        provider: z.string().min(1).max(100).describe("Provider name from config, e.g. 'glm', 'mimo', 'deepseek'"),
        max_output_tokens: z.number().int().positive().max(5000).optional().describe("Token limit for the smoke-test response")
      }
    },
    async ({ provider, max_output_tokens }) => toolResult(await app.providerSmoke({ provider, maxOutputTokens: max_output_tokens }))
  );

  server.registerTool(
    "delegate_summarize_paths",
    {
      title: "Summarize workspace files",
      description:
        "Use WHEN you would otherwise read multiple large files into context. The external model reads allowed paths and returns a focused summary, keeping raw file content out of Codex context. Pass paths relative to workspace_root; prefer path-based input for large or cross-project codebases.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      inputSchema: {
        workspace_root: workspaceRoot,
        paths: z.array(z.string().min(1).max(500)).min(1).max(500).describe("Relative paths of files to summarize, e.g. ['src/app.ts', 'src/config.ts']"),
        focus: z.string().min(1).max(5000).describe("What to focus on in the summary, e.g. 'security vulnerabilities', 'API contracts', 'error handling patterns'"),
        output_budget: z.number().int().positive().max(50000).optional().describe("Max output tokens for the summary report"),
        cache_mode: cacheMode.optional().describe("Cache behavior: read_write (default), read_only (use cache but don't write), skip (no cache)")
      }
    },
    async input => toolResult(await app.delegateSummarizePaths(input))
  );

  server.registerTool(
    "delegate_review_diff",
    {
      title: "Review code diff",
      description:
        "Use WHEN a diff or its surrounding files are large enough that direct review would consume substantial context. The external reviewer checks correctness, security, missing tests, regressions, and maintainability while Codex keeps final judgment. Prefer paths plus workspace_root for file context; use diff_text only when a diff is the necessary input.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      inputSchema: {
        workspace_root: workspaceRoot,
        base_ref: z.string().max(200).optional().describe("Base git ref for context, e.g. 'main' or 'HEAD~3' (informational only, server does not run git)"),
        target_ref: z.string().max(200).optional().describe("Target git ref for context, e.g. 'feature-branch' (informational only)"),
        diff_text: z.string().max(500000).optional().describe("The diff content to review, in unified diff format"),
        focus: z.string().min(1).max(5000).describe("What to focus on in the review, e.g. 'security risks', 'breaking changes', 'performance regressions'"),
        paths: z.array(z.string().min(1).max(500)).max(50).optional().describe("Relative paths of files to include as surrounding context for the diff"),
        output_budget: z.number().int().positive().max(50000).optional().describe("Max output tokens for the review report"),
        cache_mode: cacheMode.optional().describe("Cache behavior: read_write (default), read_only, skip")
      }
    },
    async input => toolResult(await app.delegateReviewDiff(input))
  );

  server.registerTool(
    "delegate_find_relevant_files",
    {
      title: "Search for relevant files",
      description:
        "Use WHEN you need to locate relevant files across many candidates instead of spending context on broad grep/read loops. The external model ranks allowed files and explains relevance so Codex can inspect only the best evidence. Pass workspace_root for a project other than the server default.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      inputSchema: {
        workspace_root: workspaceRoot,
        query: z.string().min(1).max(2000).describe("What to search for, e.g. 'where is authentication handled', 'files related to payment processing'"),
        globs: z.array(z.string().min(1).max(200)).max(20).optional().describe("Glob patterns to filter candidates, e.g. ['src/**/*.ts', 'tests/**/*.ts']"),
        focus: z.string().min(1).max(5000).describe("Focus aspect for ranking, e.g. 'implementation details', 'test coverage', 'error handling'"),
        max_results: z.number().int().positive().max(1000).optional().describe("Max number of candidate files to return (default 200)"),
        output_budget: z.number().int().positive().max(50000).optional().describe("Max output tokens for the ranking report"),
        cache_mode: cacheMode.optional().describe("Cache behavior: read_write (default), read_only, skip")
      }
    },
    async input => toolResult(await app.delegateFindRelevantFiles(input))
  );

  server.registerTool(
    "delegate_analyze_log",
    {
      title: "Debug and analyze logs",
      description:
        "Use WHEN logs are long, noisy, or likely to crowd out source context. The external model extracts likely causes, patterns, and verification steps while keeping raw log text out of Codex context. Prefer log_path plus workspace_root when the log is in an authorized project; use log_text when no readable path is available.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      inputSchema: {
        workspace_root: workspaceRoot,
        log_path: z.string().max(500).optional().describe("Relative path to a log file in the workspace, e.g. 'logs/error.log'"),
        log_text: z.string().max(1000000).optional().describe("Raw log text to analyze, if not reading from a file"),
        focus: z.string().min(1).max(5000).describe("What to focus on, e.g. 'root cause of crash', 'memory leak patterns', 'connection timeout errors'"),
        output_budget: z.number().int().positive().max(50000).optional().describe("Max output tokens for the analysis report"),
        cache_mode: cacheMode.optional().describe("Cache behavior: read_write (default), read_only, skip")
      }
    },
    async input => toolResult(await app.delegateAnalyzeLog(input))
  );

  server.registerTool(
    "delegate_explore_workspace",
    {
      title: "Explore an authorized workspace",
      description:
        "Use WHEN an unfamiliar codebase needs iterative file discovery, searching, and selective reading before Codex plans edits. The external explorer spends source-reading context and returns evidence, telemetry, and limits so Codex can decide what to verify. Codex remains responsible for planning and implementation.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      inputSchema: {
        workspace_root: workspaceRoot,
        question: z.string().min(1).max(5000).describe("Concrete question the explorer should answer"),
        scope_globs: z.array(z.string().min(1).max(200)).max(20).optional().describe("Optional glob patterns limiting the explorer to a smaller authorized scope"),
        focus: z.string().min(1).max(5000).describe("Evidence, behavior, or subsystem the explorer should prioritize"),
        max_turns: z.number().int().positive().max(20).optional().describe("Maximum provider tool-calling turns (default 8, hard max 20)"),
        max_files: z.number().int().positive().max(200).optional().describe("Maximum distinct files the explorer may read (default 40, hard max 200)"),
        max_total_bytes: z.number().int().positive().max(5_242_880).optional().describe("Maximum source bytes the explorer may read (default 1048576, hard max 5242880)"),
        output_budget: z.number().int().positive().max(50000).optional().describe("Max output tokens per explorer turn"),
        cache_mode: cacheMode.optional().describe("Cache behavior: read_write (default), read_only, skip")
      }
    },
    async input => toolResult(await app.delegateExploreWorkspace(input))
  );

  server.registerTool(
    "delegate_wait",
    {
      title: "Wait for delegate jobs",
      description: "Wait for one or more delegate jobs to finish, or until timeout_ms elapses. Use after calling a task tool to retrieve the completed report.",
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        job_ids: z.array(z.string().min(1).max(100)).min(1).max(50).describe("Job IDs returned by task tools, e.g. ['job_abc123']"),
        timeout_ms: z.number().int().positive().max(300000).default(30000).describe("Max wait time in milliseconds (default 30000, max 300000)")
      }
    },
    async ({ job_ids, timeout_ms }) => toolResult(await app.wait(job_ids, timeout_ms))
  );

  server.registerTool(
    "delegate_result",
    {
      title: "Get delegate job result",
      description: "Retrieve the structured report from a completed delegate job while it is still retained by this server process. Use after delegate_wait to get findings and recommendations; very old final jobs may age out.",
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        job_id: z.string().min(1).max(100).describe("Job ID returned by a task tool, e.g. 'job_abc123'")
      }
    },
    async ({ job_id }) => {
      const record = app.result(job_id);
      if (!record) {
        throw new Error(`Unknown job: ${job_id}`);
      }
      return toolResult(record);
    }
  );

  server.registerTool(
    "delegate_status",
    {
      title: "List delegate job statuses",
      description: "List retained delegate jobs and their states (queued, running, completed, failed, cancelled). With no job_ids, returns jobs still retained in this server process. Use to track progress of pending work.",
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        job_ids: z.array(z.string().min(1).max(100)).max(100).optional().describe("Specific job IDs to check, or omit to list all jobs")
      }
    },
    async ({ job_ids }) => toolResult(app.status(job_ids))
  );

  server.registerTool(
    "delegate_cancel",
    {
      title: "Cancel delegate job",
      description: "Cancel a queued or running delegate job. Completed or failed jobs are left intact while they remain in the recent-job retention window. Use when you no longer need a pending task.",
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        job_id: z.string().min(1).max(100).describe("Job ID to cancel, e.g. 'job_abc123'")
      }
    },
    async ({ job_id }) => toolResult(app.cancel(job_id))
  );

  return server;
}

function toolResult<T extends object>(structuredContent: T) {
  const summary = renderCompactSummary(structuredContent);
  return {
    content: [
      {
        type: "text" as const,
        text: summary + "\n\n---\n\n" + JSON.stringify(structuredContent, null, 2)
      }
    ],
    structuredContent: (Array.isArray(structuredContent) ? { items: structuredContent } : structuredContent) as Record<string, unknown>
  };
}

/**
 * Render a short plain-text summary from a delegate report, job record,
 * or other structured output. This layer sits above the full JSON so
 * Codex compact can preserve the key conclusions even when it drops
 * the nested structure.
 */
function renderCompactSummary(data: object): string {
  const obj = data as Record<string, unknown>;

  // DelegateReport: has status + summary + findings
  if (typeof obj.status === "string" && typeof obj.summary === "string") {
    return renderReportSummary(obj);
  }

  // JobRecord: has state + kind + role
  if (typeof obj.state === "string" && typeof obj.kind === "string") {
    return renderJobSummary(obj);
  }

  // Array of JobRecords or other items
  if (Array.isArray(obj)) {
    const items = obj as Array<Record<string, unknown>>;
    if (items.length > 0 && typeof items[0].state === "string") {
      return `${items.length} jobs: ${items.map(renderJobSummary).join(", ")}`;
    }
    return `${items.length} items`;
  }

  // Generic: ProviderStatusReport or diagnostics
  if (typeof obj.status === "string") {
    return `[${obj.status}] ${String(obj.summary ?? Object.keys(obj).join(", "))}`;
  }

  return `Result: ${Object.keys(obj).join(", ")}`;
}

function renderReportSummary(obj: Record<string, unknown>): string {
  const status = String(obj.status);
  const summary = String(obj.summary);
  const findings = Array.isArray(obj.findings) ? obj.findings as Array<Record<string, unknown>> : [];

  const severityOrder: Record<string, number> = { high: 0, medium: 1, low: 2, info: 3 };
  const sorted = [...findings].sort((a, b) =>
    (severityOrder[String(a.severity)] ?? 4) - (severityOrder[String(b.severity)] ?? 4)
  );

  const parts: string[] = [`[${status}] ${summary}`];

  if (sorted.length > 0) {
    parts.push(`${sorted.length} findings (severity: ${sorted.map(f => String(f.severity)).join(", ")}):`);
    for (const f of sorted.slice(0, 5)) {
      const sev = String(f.severity);
      const title = String(f.title ?? "untitled");
      const evidencePaths = Array.isArray(f.evidence)
        ? (f.evidence as Array<Record<string, unknown>>).map(e => String(e.path)).join(", ")
        : "";
      parts.push(`  ${sev}: ${title}${evidencePaths ? ` (${evidencePaths})` : ""}`);
    }
    if (sorted.length > 5) {
      parts.push(`  ... and ${sorted.length - 5} more`);
    }
  }

  return parts.join("\n");
}

function renderJobSummary(obj: Record<string, unknown>): string {
  const state = String(obj.state);
  const kind = String(obj.kind);
  const role = String(obj.role);
  const provider = typeof obj.provider === "string" ? obj.provider : "";
  const elapsed = typeof obj.elapsedMs === "number" ? ` (${obj.elapsedMs}ms)` : "";
  const apiState = obj.cacheHit === true
    ? "api=cache-hit"
    : obj.externalApiCalled === true
      ? "api=called"
      : "api=not-called";
  const usage = obj.usage as Record<string, unknown> | undefined;
  const usageSummary = typeof usage?.totalTokens === "number" ? ` usage=${usage.totalTokens} tokens` : "";
  const recovery = obj.recovery as Record<string, unknown> | undefined;
  const recoverySummary = typeof recovery?.parseMode === "string"
    ? ` parse=${recovery.parseMode}${recovery.outputTruncated === true ? "/truncated" : ""}`
    : "";
  const exploration = obj.exploration as Record<string, unknown> | undefined;
  const explorationSummary =
    typeof exploration?.turns === "number" &&
    typeof exploration?.toolCalls === "number" &&
    typeof exploration?.filesRead === "number" &&
    typeof exploration?.sourceBytesRead === "number"
      ? ` explore=${exploration.turns}t/${exploration.toolCalls}tools/${exploration.filesRead}files/${exploration.sourceBytesRead}bytes`
      : "";
  const limitsSummary = Array.isArray(exploration?.limitsHit) && exploration.limitsHit.length > 0
    ? ` limits=${exploration.limitsHit.join(",")}`
    : "";
  return `[${state}] ${kind}(${role})${provider ? ` via ${provider}` : ""}${elapsed} ${apiState}${usageSummary}${recoverySummary}${explorationSummary}${limitsSummary}`;
}
