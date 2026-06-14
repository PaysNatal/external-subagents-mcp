import { constants } from "node:fs";
import { copyFile } from "node:fs/promises";
import path from "node:path";
import { buildProviderStatusReport, smokeProvider } from "./diagnostics.js";
import { loadConfig } from "./config.js";
import { installCodexInstructions, renderCodexInstructions } from "./codex-instructions.js";

export interface CliOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  fetch?: typeof fetch;
}

export function isCliCommand(args: string[]): boolean {
  const command = args[0];
  return command === "init" || command === "doctor" || command === "smoke" || command === "codex-instructions" ||
    command === "install-codex-instructions" || command === "help" || command === "--help" || command === "-h";
}

export async function runCli(args: string[], options: CliOptions = {}): Promise<number> {
  const command = args[0] ?? "help";
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const stdout = options.stdout ?? (text => process.stdout.write(text));
  const stderr = options.stderr ?? (text => process.stderr.write(text));
  const json = args.includes("--json");

  try {
    if (command === "init") {
      const target = path.join(cwd, ".external-subagents-mcp.json");
      try {
        await copyFile(new URL("../.external-subagents-mcp.example.json", import.meta.url), target, constants.COPYFILE_EXCL);
      } catch (error) {
        if (isNodeError(error) && error.code === "EEXIST") {
          stderr(`Config already exists: ${target}\n`);
          return 1;
        }
        throw error;
      }
      stdout(
        [
          `Created ${target}`,
          "Next: edit provider base_url/model values, set the api_key_env variables, then run external-subagents-mcp doctor."
        ].join("\n") + "\n"
      );
      return 0;
    }

    if (command === "doctor") {
      const report = buildProviderStatusReport(loadConfig(cwd, env), env);
      stdout(json ? `${JSON.stringify(report, null, 2)}\n` : formatProviderStatusReport(report));
      return 0;
    }

    if (command === "smoke") {
      const provider = readOption(args, "--provider");
      if (!provider) {
        stderr("Missing required option: --provider <name>\n");
        return 2;
      }
      const report = await smokeProvider(loadConfig(cwd, env), env, { provider, fetch: options.fetch });
      stdout(json ? `${JSON.stringify(report, null, 2)}\n` : formatProviderSmokeReport(report));
      return report.ok ? 0 : 1;
    }

    if (command === "codex-instructions") {
      stdout(`${renderCodexInstructions()}\n`);
      return 0;
    }

    if (command === "install-codex-instructions") {
      const result = await installCodexInstructions({
        target: readOption(args, "--target"),
        dryRun: args.includes("--dry-run")
      });
      const action = result.dryRun
        ? result.changed ? "Would install" : "Already current"
        : result.changed ? "Installed" : "Already current";
      stdout(`${action} Codex delegation instructions: ${result.target}\n`);
      return 0;
    }

    stdout(usage());
    return command === "help" || command === "--help" || command === "-h" ? 0 : 2;
  } catch (error) {
    stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function formatProviderStatusReport(report: ReturnType<typeof buildProviderStatusReport>): string {
  const lines = [
    `external-subagents-mcp doctor: ${report.status}`,
    `routing: profile=${report.routing.profile ?? "none"} mode=${report.routing.mode}`,
    ...report.providers.map(provider =>
      [
        `provider ${provider.name}:`,
        `key=${provider.key_status}`,
        `env=${provider.api_key_env}`,
        `model=${provider.model}`,
        `used_by=${provider.used_by.length ? provider.used_by.join(",") : "unused"}`
      ].join(" ")
    ),
    ...report.issues.map(issue => `${issue.severity.toUpperCase()}: ${issue.message}`)
  ];
  return `${lines.join("\n")}\n`;
}

function formatProviderSmokeReport(report: Awaited<ReturnType<typeof smokeProvider>>): string {
  const lines = [
    `external-subagents-mcp smoke ${report.provider}: ${report.status}`,
    report.report?.summary ?? report.error ?? "No provider response summary."
  ];
  return `${lines.join("\n")}\n`;
}

function usage(): string {
  return [
    "Usage:",
    "  external-subagents-mcp init",
    "  external-subagents-mcp doctor [--json]",
    "  external-subagents-mcp smoke --provider <name> [--json]",
    "  external-subagents-mcp codex-instructions",
    "  external-subagents-mcp install-codex-instructions [--dry-run] [--target <path>]",
    "  external-subagents-mcp",
    "",
    "Without a CLI command, the package starts the stdio MCP server."
  ].join("\n");
}
