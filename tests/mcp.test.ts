import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createMcpServer, SERVER_INSTRUCTIONS, SERVER_VERSION } from "../src/server.js";
import type { ExternalSubagentsApp } from "../src/app.js";
import type { JobRecord } from "../src/types.js";

describe("MCP server", () => {
  it("advertises the delegate tool suite and read-only instructions", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({} as ExternalSubagentsApp);
    const client = new Client({ name: "test-client", version: "0.0.0" });

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const tools = await client.listTools();

    expect(SERVER_INSTRUCTIONS).toContain("read-only external model delegates");
    expect(SERVER_INSTRUCTIONS).toContain("Tool selection guide");
    expect(SERVER_INSTRUCTIONS).toMatch(/before large source reads/i);
    expect(SERVER_INSTRUCTIONS).toContain("Codex remains");
    expect(SERVER_INSTRUCTIONS).toContain("recovery");
    expect(SERVER_VERSION).toBe("0.3.0");
    expect(tools.tools.map(tool => tool.name).sort()).toEqual(
      [
        "delegate_analyze_log",
        "delegate_cancel",
        "delegate_explore_workspace",
        "delegate_find_relevant_files",
        "delegate_provider_smoke",
        "delegate_provider_status",
        "delegate_result",
        "delegate_review_diff",
        "delegate_status",
        "delegate_summarize_paths",
        "delegate_wait"
      ].sort()
    );
    expect(tools.tools.every(tool => tool.annotations?.readOnlyHint === true)).toBe(true);
    for (const name of [
      "delegate_summarize_paths",
      "delegate_review_diff",
      "delegate_find_relevant_files",
      "delegate_analyze_log",
      "delegate_explore_workspace"
    ]) {
      const tool = tools.tools.find(candidate => candidate.name === name);
      expect(tool?.inputSchema.properties).toHaveProperty("workspace_root");
    }

    await client.close();
    await server.close();
  });

  it("returns array tool results with object structured content", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const job: JobRecord = {
      id: "job_test",
      kind: "explore_workspace",
      role: "explorer",
      provider: "mimo",
      state: "completed",
      createdAt: "2026-06-08T00:00:00.000Z",
      cacheHit: false,
      externalApiCalled: true,
      exploration: {
        turns: 4,
        toolCalls: 3,
        filesRead: 1,
        sourceBytesRead: 1234,
        searchMatchesReturned: 5,
        limitsHit: ["max_files"]
      },
      usage: { promptTokens: 1200, completionTokens: 300, totalTokens: 1500 },
      recovery: {
        parseMode: "salvaged",
        outputTruncated: true,
        discardedTailBytes: 42,
        recoveryWarnings: ["Incomplete tail discarded."],
        reportCompleteness: 0.8
      }
    };
    const server = createMcpServer({
      wait: async () => [job]
    } as unknown as ExternalSubagentsApp);
    const client = new Client({ name: "test-client", version: "0.0.0" });

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const result = await client.callTool({ name: "delegate_wait", arguments: { job_ids: ["job_test"], timeout_ms: 1000 } });

    expect(result.structuredContent).toEqual({ items: [job] });
    // Tool results now use dual-layer format: summary text + "---" separator + JSON
    const text = String(result.content?.[0]?.text);
    const jsonPart = text.split("\n---\n")[1] ?? text;
    expect(JSON.parse(jsonPart)).toEqual([job]);
    // Verify the compact summary layer is present for JobRecord objects
    expect(text).toContain("[completed]");
    expect(text).toContain("explore_workspace(explorer)");
    expect(text).toContain("api=called");
    expect(text).toContain("usage=1500 tokens");
    expect(text).toContain("parse=salvaged/truncated");
    expect(text).toContain("explore=4t/3tools/1files/1234bytes");
    expect(text).toContain("limits=max_files");

    await client.close();
    await server.close();
  });
});
