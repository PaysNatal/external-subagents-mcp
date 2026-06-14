import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { normalizeConfig } from "../src/config.js";
import { ReadOnlyExplorer } from "../src/explorer.js";
import type { ProviderClient, ProviderToolTurnResult } from "../src/types.js";
import { createWorkspace } from "../src/workspace.js";

async function makeExplorerWorkspace() {
  const root = await mkdtemp(path.join(tmpdir(), "external-subagents-explorer-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src/auth.ts"), "export function authenticate(user: string) {\n  return Boolean(user);\n}\n");
  await writeFile(path.join(root, "src/app.ts"), "import { authenticate } from './auth.js';\nexport const ready = authenticate('demo');\n");
  await writeFile(path.join(root, ".env"), "SECRET=value\n");
  const config = normalizeConfig({
    workspace: { allow: ["src/**"], deny: ["**/.env*"] },
    providers: { local: { base_url: "https://example.test/v1", api_key_env: "KEY", model: "local" } },
    roles: { summarizer: "local" }
  }, root);
  return createWorkspace(config);
}

function scriptedProvider(turns: ProviderToolTurnResult[]): ProviderClient {
  return {
    name: "scripted",
    runReport: vi.fn(async () => {
      throw new Error("not used");
    }),
    runToolTurn: vi.fn(async () => {
      const next = turns.shift();
      if (!next) throw new Error("No scripted turn.");
      return next;
    })
  };
}

function toolTurn(id: string, name: string, args: object): ProviderToolTurnResult {
  return {
    assistantMessage: {
      role: "assistant",
      content: null,
      tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }]
    },
    toolCalls: [{ id, name, arguments: JSON.stringify(args) }],
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
  };
}

describe("ReadOnlyExplorer", () => {
  it("runs a bounded read-only discovery loop and returns telemetry", async () => {
    const provider = scriptedProvider([
      toolTurn("1", "list_files", { globs: ["src/**/*.ts"], max_results: 10 }),
      toolTurn("2", "search_text", { query: "authenticate", globs: ["src/**/*.ts"], max_matches: 10 }),
      toolTurn("3", "read_file_range", { path: "src/auth.ts", line_start: 1, line_end: 3 }),
      {
        assistantMessage: { role: "assistant", content: '{"status":"DONE","summary":"Authentication is implemented in src/auth.ts.","findings":[]}' },
        text: '{"status":"DONE","summary":"Authentication is implemented in src/auth.ts.","findings":[]}',
        toolCalls: [],
        usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 }
      }
    ]);
    const explorer = new ReadOnlyExplorer(provider, await makeExplorerWorkspace());

    const result = await explorer.run({
      question: "Where is authentication implemented?",
      focus: "Implementation facts and evidence",
      scopeGlobs: ["src/**/*.ts"],
      maxTurns: 8,
      maxFiles: 5,
      maxTotalBytes: 10000,
      outputBudget: 1200
    });

    expect(result.report.summary).toContain("src/auth.ts");
    expect(result.exploration).toMatchObject({
      turns: 4,
      toolCalls: 3,
      filesRead: 1,
      searchMatchesReturned: 3,
      limitsHit: []
    });
    expect(result.exploration.sourceBytesRead).toBeGreaterThan(0);
    expect(result.usage?.totalTokens).toBe(75);
  });

  it("blocks denied paths and records hard limits without exposing content", async () => {
    const provider = scriptedProvider([
      toolTurn("1", "read_file", { path: ".env" }),
      toolTurn("2", "read_file", { path: "src/auth.ts" }),
      toolTurn("3", "read_file", { path: "src/app.ts" }),
      {
        assistantMessage: { role: "assistant", content: '{"status":"DONE_WITH_CONCERNS","summary":"Partial exploration","findings":[]}' },
        text: '{"status":"DONE_WITH_CONCERNS","summary":"Partial exploration","findings":[]}',
        toolCalls: []
      }
    ]);
    const explorer = new ReadOnlyExplorer(provider, await makeExplorerWorkspace());

    const result = await explorer.run({
      question: "Inspect files",
      focus: "Facts",
      maxTurns: 6,
      maxFiles: 1,
      maxTotalBytes: 10000,
      outputBudget: 1000
    });

    expect(result.exploration.filesRead).toBe(1);
    expect(result.exploration.limitsHit).toContain("max_files");
    expect(JSON.stringify(result)).not.toContain("SECRET=value");
  });

  it("returns BLOCKED when the provider cannot run tool turns", async () => {
    const provider: ProviderClient = {
      name: "no-tools",
      runReport: vi.fn(async () => {
        throw new Error("not used");
      })
    };
    const explorer = new ReadOnlyExplorer(provider, await makeExplorerWorkspace());

    const result = await explorer.run({
      question: "Inspect files",
      focus: "Facts",
      outputBudget: 1000
    });

    expect(result.report.status).toBe("BLOCKED");
    expect(result.report.summary).toMatch(/tool calling/i);
    expect(result.exploration.turns).toBe(0);
  });
});
