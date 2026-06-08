import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { ExternalSubagentsApp } from "./app.js";
import type { JobRecord } from "./types.js";

export const SERVER_INSTRUCTIONS = `external-subagents-mcp provides read-only external model delegates for Codex.

Use these tools for large-context review, summarization, triage, log analysis, and file discovery. Do not use them for implementation, patching, shell commands, migrations, formatting, or test execution.

The external model output is advisory. Codex must verify cited files and line numbers before changing code.

Use provider status and smoke-test tools to diagnose API keys, active routing, base URLs, and model IDs before delegating expensive work.

When following Superpowers-style workflows such as dispatching-parallel-agents or subagent-driven-development, these tools can serve as external explorer, reviewer, file_finder, summarizer, and log_analyst delegates. They must not serve as implementers.`;

const cacheMode = z.enum(["read_write", "read_only", "skip"]).default("read_write");

export function createMcpServer(app: ExternalSubagentsApp): McpServer {
  const server = new McpServer(
    { name: "external-subagents-mcp", version: "0.1.0" },
    { instructions: SERVER_INSTRUCTIONS }
  );

  server.registerTool(
    "delegate_provider_status",
    {
      title: "Inspect provider routing and API key status",
      description:
        "Return a diagnostic report for configured providers, active roles, auto routing rules, and missing API key environment variables. Does not expose secrets.",
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
        "Send a minimal chat completion request to one configured provider to verify base_url, API key, model ID, and JSON report compatibility.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      inputSchema: {
        provider: z.string().min(1),
        max_output_tokens: z.number().int().positive().optional()
      }
    },
    async ({ provider, max_output_tokens }) => toolResult(await app.providerSmoke({ provider, maxOutputTokens: max_output_tokens }))
  );

  server.registerTool(
    "delegate_summarize_paths",
    {
      title: "Delegate path summarization",
      description:
        "Read allowed workspace files and delegate summarization to an external OpenAI-compatible model. Returns an async job record.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      inputSchema: {
        paths: z.array(z.string()).min(1),
        focus: z.string().min(1),
        output_budget: z.number().int().positive().optional(),
        cache_mode: cacheMode.optional()
      }
    },
    async input => toolResult(await app.delegateSummarizePaths(input))
  );

  server.registerTool(
    "delegate_review_diff",
    {
      title: "Delegate diff review",
      description:
        "Delegate a read-only review of supplied diff text and optional allowed file context. This server does not run git commands.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      inputSchema: {
        base_ref: z.string().optional(),
        target_ref: z.string().optional(),
        diff_text: z.string().optional(),
        focus: z.string().min(1),
        paths: z.array(z.string()).optional(),
        output_budget: z.number().int().positive().optional(),
        cache_mode: cacheMode.optional()
      }
    },
    async input => toolResult(await app.delegateReviewDiff(input))
  );

  server.registerTool(
    "delegate_find_relevant_files",
    {
      title: "Delegate relevant file discovery",
      description:
        "List allowed workspace files and ask an external model to rank relevant candidates for a query. Returns an async job record.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      inputSchema: {
        query: z.string().min(1),
        globs: z.array(z.string()).optional(),
        focus: z.string().min(1),
        max_results: z.number().int().positive().max(1000).optional(),
        output_budget: z.number().int().positive().optional(),
        cache_mode: cacheMode.optional()
      }
    },
    async input => toolResult(await app.delegateFindRelevantFiles(input))
  );

  server.registerTool(
    "delegate_analyze_log",
    {
      title: "Delegate log analysis",
      description:
        "Analyze supplied log text or an allowed log path using an external model. Returns likely causes and verification steps as an async job.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      inputSchema: {
        log_path: z.string().optional(),
        log_text: z.string().optional(),
        focus: z.string().min(1),
        output_budget: z.number().int().positive().optional(),
        cache_mode: cacheMode.optional()
      }
    },
    async input => toolResult(await app.delegateAnalyzeLog(input))
  );

  server.registerTool(
    "delegate_wait",
    {
      title: "Wait for delegate jobs",
      description: "Wait for one or more async delegate jobs to finish or until timeout_ms elapses.",
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        job_ids: z.array(z.string()).min(1),
        timeout_ms: z.number().int().positive().max(300000).default(30000)
      }
    },
    async ({ job_ids, timeout_ms }) => toolResult(await app.wait(job_ids, timeout_ms))
  );

  server.registerTool(
    "delegate_result",
    {
      title: "Get delegate job result",
      description: "Return a single delegate job record, including its structured report when complete.",
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        job_id: z.string().min(1)
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
      description: "Return current delegate job statuses. With no job_ids, returns all known jobs in this server process.",
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        job_ids: z.array(z.string()).optional()
      }
    },
    async ({ job_ids }) => toolResult(app.status(job_ids))
  );

  server.registerTool(
    "delegate_cancel",
    {
      title: "Cancel delegate job",
      description: "Cancel a queued or running delegate job. Completed results are left intact.",
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: {
        job_id: z.string().min(1)
      }
    },
    async ({ job_id }) => toolResult(app.cancel(job_id))
  );

  return server;
}

function toolResult<T extends object>(structuredContent: T) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(structuredContent, null, 2)
      }
    ],
    structuredContent: (Array.isArray(structuredContent) ? { items: structuredContent } : structuredContent) as Record<string, unknown>
  };
}
