import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = await mkdtemp(path.join(tmpdir(), "external-subagents-stdio-"));
const configPath = path.join(root, ".external-subagents-mcp.json");
await writeFile(
  configPath,
  JSON.stringify(
    {
      workspace: { root },
      providers: {
        local: {
          base_url: "https://example.test/v1",
          api_key_env: "EXTERNAL_SUBAGENTS_STDIO_SMOKE_KEY",
          model: "smoke-model"
        }
      },
      roles: {
        summarizer: "local",
        reviewer: "local",
        log_analyst: "local",
        file_finder: "local"
      }
    },
    null,
    2
  ),
  "utf8"
);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js"],
  cwd: process.cwd(),
  env: {
    ...process.env,
    EXTERNAL_SUBAGENTS_CONFIG: configPath
  },
  stderr: "pipe"
});
const client = new Client({ name: "external-subagents-stdio-smoke", version: "0.0.0" });

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const names = tools.tools.map(tool => tool.name);
  for (const required of ["delegate_provider_status", "delegate_summarize_paths", "delegate_wait"]) {
    if (!names.includes(required)) {
      throw new Error(`Missing stdio MCP tool: ${required}`);
    }
  }
  console.log(`stdio smoke ok: ${names.length} tools`);
} finally {
  await client.close();
  await transport.close();
}
