import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createMcpServer, SERVER_INSTRUCTIONS } from "../src/server.js";
import type { ExternalSubagentsApp } from "../src/app.js";

describe("MCP server", () => {
  it("advertises the delegate tool suite and read-only instructions", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({} as ExternalSubagentsApp);
    const client = new Client({ name: "test-client", version: "0.0.0" });

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const tools = await client.listTools();

    expect(SERVER_INSTRUCTIONS).toContain("read-only external model delegates");
    expect(tools.tools.map(tool => tool.name).sort()).toEqual(
      [
        "delegate_analyze_log",
        "delegate_cancel",
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

    await client.close();
    await server.close();
  });
});
