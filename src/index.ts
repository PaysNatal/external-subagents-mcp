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

  // Graceful shutdown on SIGTERM/SIGINT
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await server.close();
    } catch {
      // best effort
    }
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  await server.connect(new StdioServerTransport());
}

main().catch(error => {
  // Sanitize startup errors to avoid leaking paths in stderr
  const isDebug = process.env.DEBUG === "external-subagents-mcp";
  console.error(
    isDebug
      ? (error instanceof Error ? error.stack ?? error.message : String(error))
      : "Failed to start external-subagents-mcp server. Run with DEBUG=external-subagents-mcp for details."
  );
  process.exit(1);
});