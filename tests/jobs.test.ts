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
      runReport: vi.fn(async () => report)
    };
    const manager = new JobManager({
      providers: new Map([["local", provider]]),
      roles: new Map([["reviewer", { provider: "local", maxOutputTokens: 1000, max_output_tokens: 1000 }]]),
      globalConcurrency: 1,
      perProviderConcurrency: 1
    });

    const job = manager.start({
      kind: "review_diff",
      role: "reviewer",
      prompt: "Review diff",
      cacheKey: undefined
    });

    const waited = await manager.wait([job.id], 1000);
    expect(waited[0]?.state).toBe("completed");
    expect(manager.result(job.id)?.report?.summary).toBe("finished");
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
      runReport: vi.fn(async () => report)
    };
    const fast: ProviderClient = {
      name: "fast",
      runReport: vi.fn(async request => {
        expect(request.user).toBe("Rank these exact candidate files.");
        return report;
      })
    };
    const manager = new JobManager({
      providers: new Map([
        ["glm", glm],
        ["fast", fast]
      ]),
      roles: new Map([["file_finder", { provider: "glm", maxOutputTokens: 1000, max_output_tokens: 1000 }]]),
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
        return report;
      })
    };
    const manager = new JobManager({
      providers: new Map([["long_context", longContext]]),
      roles: new Map([["log_analyst", { provider: "long_context", maxOutputTokens: 1000, max_output_tokens: 1000 }]]),
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
});
