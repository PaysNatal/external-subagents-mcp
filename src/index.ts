#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { isCliCommand, runCli } from "./cli.js";
import { createAppFromEnvironment } from "./factory.js";
import { createMcpServer } from "./server.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (isCliCommand(args)) {
    process.exit(await runCli(args));
  }

  const app = createAppFromEnvironment();
  const server = createMcpServer(app);
  await server.connect(new StdioServerTransport());
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
