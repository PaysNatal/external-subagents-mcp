import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { ExternalSubagentsApp } from "./app.js";
import type { JobRecord } from "./types.js";

export const SERVER_INSTRUCTIONS = `external-subagents-mcp: read-only external model delegates for Codex.

All task tools (summarize, review, find_files, analyze_log) return a job record. Use delegate_wait then delegate_result to retrieve the structured report. Do not use these tools for implementation, patching, shell commands, migrations, formatting, or test execution.

The external model output is advisory. Codex must verify cited files and line numbers before changing code.

Use delegate_provider_status and delegate_provider_smoke to check API keys, routing, and model connectivity before delegating expensive work.

Tool selection guide:
- summarize or compress files → delegate_summarize_paths
- review code or diff → delegate_review_diff
- search or locate relevant files → delegate_find_relevant_files
- debug or analyze errors, logs, crashes → delegate_analyze_log

These tools must not serve as implementers.

When compacting context, preserve the plain-text summary line above the JSON separator (---). It contains the status, summary, severity ranking, and evidence paths. The nested JSON below the separator may be compressed, but the summary line must be kept intact because it holds the key conclusions and file references Codex needs for verification.`;

const cacheMode = z.enum(["read_write", "read_only", "skip"]).default("read_write").describe("Cache behavior: read_write (default — cache and reuse), read_only (reuse but don't write new entries), skip (no cache)");

export function createMcpServer(app: ExternalSubagentsApp): McpServer {
  const server = new McpServer(
    { name: "external-subagents-mcp", version: "0.1.1" },
    { instructions: SERVER_INSTRUCTIONS }
  );

  server.registerTool(
    "delegate_provider_status",
    {
      title: "Check provider routing and API key setup",
      description:
        "Check which providers are configured, which API keys are set or missing, and which roles route to which providers. Does not expose secrets. Use before delegating work to verify connectivity.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      inputSchema: {}
    },
    async () => toolResult(app.providerStatus())
  );

  server.registerTool(
    "delegate_provider_smoke",
    {
      title: "Smoke-test one provider",
      description:
        "Send a minimal chat completion request to verify that one provider's base_url, API key, model ID, and report format are working. Use after delegate_provider_status to confirm connectivity before delegating expensive work.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      inputSchema: {
        provider: z.string().min(1).describe("Provider name from config, e.g. 'glm', 'mimo', 'deepseek'"),
        max_output_tokens: z.number().int().positive().optional().describe("Token limit for the smoke-test response")
      }
    },
    async ({ provider, max_output_tokens }) => toolResult(await app.providerSmoke({ provider, maxOutputTokens: max_output_tokens }))
  );

  server.registerTool(
    "delegate_summarize_paths",
    {
      title: "Summarize workspace files",
      description:
        "Read and summarize the specified files. Use to compress, digest, or condense file content for Codex context when reviewing large codebases or understanding unfamiliar projects.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      inputSchema: {
        paths: z.array(z.string().min(1)).min(1).describe("Relative paths of files to summarize, e.g. ['src/app.ts', 'src/config.ts']"),
        focus: z.string().min(1).describe("What to focus on in the summary, e.g. 'security vulnerabilities', 'API contracts', 'error handling patterns'"),
        output_budget: z.number().int().positive().optional().describe("Max output tokens for the summary report"),
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
        "Review a code diff for correctness, security, missing tests, regressions, and maintainability. Supply diff_text directly; this server does not run git commands. Optionally include paths for surrounding file context.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      inputSchema: {
        base_ref: z.string().optional().describe("Base git ref for context, e.g. 'main' or 'HEAD~3' (informational only, server does not run git)"),
        target_ref: z.string().optional().describe("Target git ref for context, e.g. 'feature-branch' (informational only)"),
        diff_text: z.string().optional().describe("The diff content to review, in unified diff format"),
        focus: z.string().min(1).describe("What to focus on in the review, e.g. 'security risks', 'breaking changes', 'performance regressions'"),
        paths: z.array(z.string()).optional().describe("Relative paths of files to include as surrounding context for the diff"),
        output_budget: z.number().int().positive().optional().describe("Max output tokens for the review report"),
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
        "Search, locate, or discover files in the workspace relevant to a query. The external model ranks candidate files by relevance. Use to find which files to read or review before diving into a large unfamiliar project.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      inputSchema: {
        query: z.string().min(1).describe("What to search for, e.g. 'where is authentication handled', 'files related to payment processing'"),
        globs: z.array(z.string()).optional().describe("Glob patterns to filter candidates, e.g. ['src/**/*.ts', 'tests/**/*.ts']"),
        focus: z.string().min(1).describe("Focus aspect for ranking, e.g. 'implementation details', 'test coverage', 'error handling'"),
        max_results: z.number().int().positive().max(1000).optional().describe("Max number of candidate files to return (default 200)"),
        output_budget: z.number().int().positive().optional().describe("Max output tokens for the ranking report"),
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
        "Debug, analyze, or troubleshoot log output. Identifies likely root causes, stack traces, and failure patterns. Supply log_text directly or log_path to read an allowed workspace log file.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      inputSchema: {
        log_path: z.string().optional().describe("Relative path to a log file in the workspace, e.g. 'logs/error.log'"),
        log_text: z.string().optional().describe("Raw log text to analyze, if not reading from a file"),
        focus: z.string().min(1).describe("What to focus on, e.g. 'root cause of crash', 'memory leak patterns', 'connection timeout errors'"),
        output_budget: z.number().int().positive().optional().describe("Max output tokens for the analysis report"),
        cache_mode: cacheMode.optional().describe("Cache behavior: read_write (default), read_only, skip")
      }
    },
    async input => toolResult(await app.delegateAnalyzeLog(input))
  );

  server.registerTool(
    "delegate_wait",
    {
      title: "Wait for delegate jobs",
      description: "Wait for one or more delegate jobs to finish, or until timeout_ms elapses. Use after calling a task tool to retrieve the completed report.",
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        job_ids: z.array(z.string().min(1)).min(1).describe("Job IDs returned by task tools, e.g. ['job_abc123']"),
        timeout_ms: z.number().int().positive().max(300000).default(30000).describe("Max wait time in milliseconds (default 30000, max 300000)")
      }
    },
    async ({ job_ids, timeout_ms }) => toolResult(await app.wait(job_ids, timeout_ms))
  );

  server.registerTool(
    "delegate_result",
    {
      title: "Get delegate job result",
      description: "Retrieve the structured report from a completed delegate job. Use after delegate_wait to get the findings, recommendations, and reasoning chain.",
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        job_id: z.string().min(1).describe("Job ID returned by a task tool, e.g. 'job_abc123'")
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
      description: "List the state of all delegate jobs (queued, running, completed, failed, cancelled). With no job_ids, returns every job in this server process. Use to track progress of pending work.",
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        job_ids: z.array(z.string()).optional().describe("Specific job IDs to check, or omit to list all jobs")
      }
    },
    async ({ job_ids }) => toolResult(app.status(job_ids))
  );

  server.registerTool(
    "delegate_cancel",
    {
      title: "Cancel delegate job",
      description: "Cancel a queued or running delegate job. Completed or failed jobs are left intact. Use when you no longer need the result of a pending task.",
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        job_id: z.string().min(1).describe("Job ID to cancel, e.g. 'job_abc123'")
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
      return `${items.length} jobs: ${items.map(j => `[${j.state}] ${j.kind}(${j.role})`).join(", ")}`;
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
  return `[${state}] ${kind}/${role}${provider ? ` via ${provider}` : ""}${elapsed}`;
}
