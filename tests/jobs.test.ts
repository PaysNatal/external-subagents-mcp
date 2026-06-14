import { describe, expect, it, vi } from "vitest";
import { JobManager } from "../src/jobs.js";
import type { DelegateReport, ProviderClient } from "../src/types.js";

describe("JobManager", () => {
  it("runs jobs asynchronously and returns completed reports", async () => {
    const report: DelegateReport = {
      status: "DONE",
      summary: "finished",
      findings: [],
      next_actions: [],
      omitted: []
    };
    const provider: ProviderClient = {
      name: "local",
      runReport: vi.fn(async () => ({
        report,
        usage: { promptTokens: 1200, completionTokens: 300, totalTokens: 1500 },
        recovery: {
          parseMode: "repaired",
          outputTruncated: false,
          discardedTailBytes: 0,
          recoveryWarnings: ["Repaired provider JSON syntax."],
          reportCompleteness: 0.95
        }
      }))
    };
    const manager = new JobManager({
      providers: new Map([["local", provider]]),
      roles: new Map([["reviewer", { provider: "local", maxOutputTokens: 1000 }]]),
      globalConcurrency: 1,
      perProviderConcurrency: 1
    });

    const job = manager.start({
      kind: "review_diff",
      role: "reviewer",
      prompt: "Review diff",
      workspaceRoot: "/repo",
      cacheKey: undefined
    });

    const waited = await manager.wait([job.id], 1000);
    expect(waited[0]?.state).toBe("completed");
    expect(manager.result(job.id)?.report?.summary).toBe("finished");
    expect(manager.result(job.id)).toMatchObject({
      workspaceRoot: "/repo",
      inputBytes: 11,
      externalApiCalled: true,
      usage: { promptTokens: 1200, completionTokens: 300, totalTokens: 1500 },
      recovery: {
        parseMode: "repaired",
        outputTruncated: false,
        reportCompleteness: 0.95
      }
    });
  });

  it("auto-routes jobs by kind without changing the original prompt", async () => {
    const report: DelegateReport = {
      status: "DONE",
      summary: "finished",
      findings: [],
      next_actions: [],
      omitted: []
    };
    const glm: ProviderClient = {
      name: "glm",
      runReport: vi.fn(async () => ({ report }))
    };
    const fast: ProviderClient = {
      name: "fast",
      runReport: vi.fn(async request => {
        expect(request.user).toBe("Rank these exact candidate files.");
        return { report };
      })
    };
    const manager = new JobManager({
      providers: new Map([
        ["glm", glm],
        ["fast", fast]
      ]),
      roles: new Map([["file_finder", { provider: "glm", maxOutputTokens: 1000 }]]),
      routing: {
        mode: "auto",
        autoRules: [{ kinds: ["find_relevant_files"], provider: "fast" }]
      },
      globalConcurrency: 1,
      perProviderConcurrency: 1
    });

    const job = manager.start({
      kind: "find_relevant_files",
      role: "file_finder",
      prompt: "Rank these exact candidate files.",
      cacheKey: undefined
    });

    expect(job.provider).toBe("fast");
    const waited = await manager.wait([job.id], 1000);
    expect(waited[0]?.state).toBe("completed");
    expect(fast.runReport).toHaveBeenCalledOnce();
    expect(glm.runReport).not.toHaveBeenCalled();
  });

  it("auto-routes jobs by input size and can override the role output budget", async () => {
    const report: DelegateReport = {
      status: "DONE",
      summary: "finished",
      findings: [],
      next_actions: [],
      omitted: []
    };
    const longContext: ProviderClient = {
      name: "long_context",
      runReport: vi.fn(async request => {
        expect(request.maxOutputTokens).toBe(4000);
        expect(request.user).toBe("x".repeat(20));
        return { report };
      })
    };
    const manager = new JobManager({
      providers: new Map([["long_context", longContext]]),
      roles: new Map([["log_analyst", { provider: "long_context", maxOutputTokens: 1000 }]]),
      routing: {
        mode: "auto",
        autoRules: [{ role: "log_analyst", minInputBytes: 10, provider: "long_context", maxOutputTokens: 4000 }]
      },
      globalConcurrency: 1,
      perProviderConcurrency: 1
    });

    const job = manager.start({
      kind: "analyze_log",
      role: "log_analyst",
      prompt: "x".repeat(20),
      inputBytes: 20,
      cacheKey: undefined
    });

    await manager.wait([job.id], 1000);
    expect(longContext.runReport).toHaveBeenCalledOnce();
  });

  it("applies dynamic budget rules without changing the selected provider", async () => {
    const report: DelegateReport = {
      status: "DONE",
      summary: "finished",
      findings: [],
      next_actions: [],
      omitted: []
    };
    const provider: ProviderClient = {
      name: "mimo",
      runReport: vi.fn(async request => {
        expect(request.maxOutputTokens).toBe(3500);
        return { report };
      })
    };
    const manager = new JobManager({
      providers: new Map([["mimo", provider]]),
      roles: new Map([["log_analyst", { provider: "mimo", maxOutputTokens: 1200 }]]),
      routing: {
        mode: "profile",
        budgetRules: [{ name: "long_logs", role: "log_analyst", minInputBytes: 10, maxOutputTokens: 3500 }],
        autoRules: []
      },
      globalConcurrency: 1,
      perProviderConcurrency: 1
    });

    const job = manager.start({
      kind: "analyze_log",
      role: "log_analyst",
      prompt: "x".repeat(20),
      inputBytes: 20,
      cacheKey: undefined
    });

    expect(job.provider).toBe("mimo");
    expect(job.maxOutputTokens).toBe(3500);
    expect(job.budgetSource).toBe("budget_rule:long_logs");
    await manager.wait([job.id], 1000);
    expect(provider.runReport).toHaveBeenCalledOnce();
  });

  it("lets explicit tool output budgets override dynamic budget rules", async () => {
    const report: DelegateReport = {
      status: "DONE",
      summary: "finished",
      findings: [],
      next_actions: [],
      omitted: []
    };
    const provider: ProviderClient = {
      name: "mimo",
      runReport: vi.fn(async request => {
        expect(request.maxOutputTokens).toBe(900);
        return { report };
      })
    };
    const manager = new JobManager({
      providers: new Map([["mimo", provider]]),
      roles: new Map([["log_analyst", { provider: "mimo", maxOutputTokens: 1200 }]]),
      routing: {
        mode: "profile",
        budgetRules: [{ name: "long_logs", role: "log_analyst", minInputBytes: 10, maxOutputTokens: 3500 }],
        autoRules: []
      },
      globalConcurrency: 1,
      perProviderConcurrency: 1
    });

    const job = manager.start({
      kind: "analyze_log",
      role: "log_analyst",
      prompt: "x".repeat(20),
      inputBytes: 20,
      maxOutputTokens: 900,
      cacheKey: undefined
    });

    expect(job.maxOutputTokens).toBe(900);
    expect(job.budgetSource).toBe("input:output_budget");
    await manager.wait([job.id], 1000);
    expect(provider.runReport).toHaveBeenCalledOnce();
  });

  it("marks cache hits as no external API call while preserving historical usage", () => {
    const report: DelegateReport = {
      status: "DONE",
      summary: "cached",
      findings: [],
      next_actions: [],
      omitted: []
    };
    const manager = new JobManager({
      providers: new Map(),
      roles: new Map([["reviewer", { provider: "local", maxOutputTokens: 1000 }]]),
      globalConcurrency: 1,
      perProviderConcurrency: 1
    });

    const job = manager.start({
      kind: "review_diff",
      role: "reviewer",
      prompt: "Review diff",
      inputBytes: 11,
      workspaceRoot: "/repo",
      cacheKey: "cached",
      cached: {
        id: "original",
        role: "reviewer",
        provider: "local",
        report,
        usage: { promptTokens: 800, completionTokens: 200, totalTokens: 1000 },
        recovery: {
          parseMode: "repaired",
          outputTruncated: false,
          discardedTailBytes: 0,
          recoveryWarnings: ["Repaired syntax."],
          reportCompleteness: 0.95
        },
        createdAt: "2026-06-13T00:00:00.000Z",
        completedAt: "2026-06-13T00:01:00.000Z",
        cacheKey: "cached",
        inputHash: "hash"
      }
    });

    expect(job).toMatchObject({
      state: "completed",
      cacheHit: true,
      inputBytes: 11,
      workspaceRoot: "/repo",
      externalApiCalled: false,
      usage: { promptTokens: 800, completionTokens: 200, totalTokens: 1000 },
      recovery: { parseMode: "repaired", outputTruncated: false }
    });
  });

  it("marks failed provider attempts as external API calls", async () => {
    const failed: DelegateReport = {
      status: "FAILED",
      summary: "provider failed",
      findings: [],
      next_actions: [],
      omitted: []
    };
    const provider: ProviderClient = {
      name: "local",
      runReport: vi.fn(async () => ({ report: failed }))
    };
    const manager = new JobManager({
      providers: new Map([["local", provider]]),
      roles: new Map([["reviewer", { provider: "local", maxOutputTokens: 1000 }]]),
      globalConcurrency: 1,
      perProviderConcurrency: 1
    });

    const job = manager.start({
      kind: "review_diff",
      role: "reviewer",
      prompt: "Review diff",
      cacheKey: undefined
    });
    const [completed] = await manager.wait([job.id], 1000);

    expect(completed).toMatchObject({
      state: "failed",
      externalApiCalled: true
    });
  });
});
