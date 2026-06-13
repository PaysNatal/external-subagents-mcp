import { mkdtemp, mkdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ExternalSubagentsApp } from "../src/app.js";
import { DiskCache } from "../src/cache.js";
import { normalizeConfig } from "../src/config.js";
import { JobManager } from "../src/jobs.js";
import { createWorkspaceResolver } from "../src/workspace.js";
import type { DelegateReport, ProviderClient } from "../src/types.js";

describe("ExternalSubagentsApp", () => {
  it("delegates path summaries and reuses disk cache on repeated inputs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "external-subagents-app-"));
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src/app.ts"), "export function meaning() { return 42; }\n");

    const config = normalizeConfig(
      {
        workspace: { allow: ["src/**"] },
        cache: { dir: ".cache" },
        providers: {
          local: {
            base_url: "https://example.test/v1",
            api_key_env: "EXAMPLE_API_KEY",
            model: "example-model"
          }
        },
        roles: { summarizer: { provider: "local" } }
      },
      root
    );
    const report: DelegateReport = {
      status: "DONE",
      summary: "The file exports meaning().",
      findings: [],
      next_actions: ["Open src/app.ts before editing."],
      omitted: []
    };
    const provider: ProviderClient = {
      name: "local",
      runReport: vi.fn(async request => {
        expect(request.user).toContain("meaning");
        return { report, usage: { promptTokens: 700, completionTokens: 100, totalTokens: 800 } };
      })
    };
    const manager = new JobManager({
      providers: new Map([["local", provider]]),
      roles: new Map(Object.entries(config.roles)),
      globalConcurrency: 1,
      perProviderConcurrency: 1
    });
    const app = new ExternalSubagentsApp({
      config,
      workspaceResolver: createWorkspaceResolver(config),
      cache: new DiskCache({
        dir: config.cache.dir,
        ttlHours: config.cache.ttlHours,
        maxBytes: config.cache.maxBytes
      }),
      jobs: manager
    });

    const first = await app.delegateSummarizePaths({
      paths: ["src/app.ts"],
      focus: "public API",
      cache_mode: "read_write"
    });
    await manager.wait([first.id], 1000);

    const second = await app.delegateSummarizePaths({
      paths: ["src/app.ts"],
      focus: "public API",
      cache_mode: "read_write"
    });

    expect(second.cacheHit).toBe(true);
    expect(second.externalApiCalled).toBe(false);
    expect(second.usage?.totalTokens).toBe(800);
    expect(provider.runReport).toHaveBeenCalledOnce();
  });

  it("delegates files from an explicitly authorized second project without embedding them in the tool call", async () => {
    const defaultRoot = await mkdtemp(path.join(tmpdir(), "external-subagents-default-"));
    const secondRoot = await mkdtemp(path.join(tmpdir(), "external-subagents-second-"));
    await mkdir(path.join(defaultRoot, "src"), { recursive: true });
    await mkdir(path.join(secondRoot, "src"), { recursive: true });
    await writeFile(path.join(defaultRoot, "src/app.ts"), "export const source = 'default';\n");
    await writeFile(path.join(secondRoot, "src/app.ts"), "export const source = 'authorized-second-project';\n");

    const rawConfig = {
      workspace: { allow: ["src/**"] },
      cache: { dir: ".cache" },
      providers: {
        local: {
          base_url: "https://example.test/v1",
          api_key_env: "EXAMPLE_API_KEY",
          model: "example-model"
        }
      },
      roles: { summarizer: { provider: "local" } }
    };
    await writeFile(path.join(secondRoot, ".external-subagents-mcp.json"), JSON.stringify(rawConfig));
    const config = normalizeConfig(rawConfig, defaultRoot);
    const report: DelegateReport = {
      status: "DONE",
      summary: "Second project summarized.",
      findings: [],
      next_actions: [],
      omitted: []
    };
    const provider: ProviderClient = {
      name: "local",
      runReport: vi.fn(async request => {
        expect(request.user).toContain("authorized-second-project");
        expect(request.user).not.toContain("source = 'default'");
        return { report };
      })
    };
    const manager = new JobManager({
      providers: new Map([["local", provider]]),
      roles: new Map(Object.entries(config.roles)),
      globalConcurrency: 1,
      perProviderConcurrency: 1
    });
    const app = new ExternalSubagentsApp({
      config,
      workspaceResolver: createWorkspaceResolver(config),
      cache: new DiskCache({
        dir: config.cache.dir,
        ttlHours: config.cache.ttlHours,
        maxBytes: config.cache.maxBytes
      }),
      jobs: manager
    });

    const job = await app.delegateSummarizePaths({
      workspace_root: secondRoot,
      paths: ["src/app.ts"],
      focus: "public API",
      cache_mode: "skip"
    });
    const [completed] = await manager.wait([job.id], 1000);

    expect(completed?.state).toBe("completed");
    expect(completed?.workspaceRoot).toBe(await realpath(secondRoot));
    expect(provider.runReport).toHaveBeenCalledOnce();
  });
});
