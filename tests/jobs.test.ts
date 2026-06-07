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
});
