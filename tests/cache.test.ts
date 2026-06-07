import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DiskCache } from "../src/cache.js";
import type { DelegateReport } from "../src/types.js";

describe("DiskCache", () => {
  it("stores completed reports without raw input text", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "external-subagents-cache-"));
    const cache = new DiskCache({ dir, ttlHours: 1, maxBytes: 1000000 });
    const report: DelegateReport = {
      status: "DONE",
      summary: "summary",
      findings: [],
      next_actions: [],
      omitted: []
    };

    const key = cache.keyFor("summarizer", { content: "very secret source text" });
    await cache.set(key, {
      id: "job_1",
      role: "summarizer",
      provider: "local",
      report,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      cacheKey: key,
      inputHash: "hash-only"
    });

    const cached = await cache.get(key);
    expect(cached?.report.summary).toBe("summary");
    expect(JSON.stringify(cached)).not.toContain("very secret source text");
  });
});
