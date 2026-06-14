import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isCliCommand, runCli } from "../src/cli.js";

describe("runCli", () => {
  it("creates a starter config with init", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "external-subagents-init-"));
    let stdout = "";
    let stderr = "";

    const code = await runCli(["init"], {
      cwd: root,
      stdout: text => {
        stdout += text;
      },
      stderr: text => {
        stderr += text;
      }
    });

    const config = JSON.parse(await readFile(path.join(root, ".external-subagents-mcp.json"), "utf8"));
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("Created");
    expect(config.routing.profile).toBe("single_provider");
    expect(config.profiles.single_provider).toBeDefined();
    expect(isCliCommand(["init"])).toBe(true);
  });

  it("does not overwrite an existing config with init", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "external-subagents-init-existing-"));
    const configPath = path.join(root, ".external-subagents-mcp.json");
    await writeFile(configPath, '{"keep":true}\n', "utf8");
    let stderr = "";

    const code = await runCli(["init"], {
      cwd: root,
      stdout: () => undefined,
      stderr: text => {
        stderr += text;
      }
    });

    expect(code).toBe(1);
    expect(stderr).toContain("already exists");
    expect(await readFile(configPath, "utf8")).toBe('{"keep":true}\n');
  });

  it("prints provider diagnostics as JSON", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "external-subagents-cli-"));
    await writeFile(
      path.join(root, ".external-subagents-mcp.json"),
      JSON.stringify(
        {
          providers: {
            mimo: {
              base_url: "https://example.test/v1",
              api_key_env: "MIMO_API_KEY",
              model: "mimo-v2.5-pro"
            }
          },
          roles: {
            summarizer: "mimo",
            reviewer: "mimo",
            log_analyst: "mimo",
            file_finder: "mimo"
          }
        },
        null,
        2
      ),
      "utf8"
    );
    let stdout = "";
    let stderr = "";

    const code = await runCli(["doctor", "--json"], {
      cwd: root,
      env: {},
      stdout: text => {
        stdout += text;
      },
      stderr: text => {
        stderr += text;
      }
    });

    expect(code).toBe(0);
    expect(stderr).toBe("");
    const parsed = JSON.parse(stdout);
    expect(parsed.status).toBe("WARN");
    expect(parsed.providers).toEqual([
      expect.objectContaining({
        name: "mimo",
        key_status: "missing",
        used_by: ["role:summarizer", "role:reviewer", "role:log_analyst", "role:file_finder"]
      })
    ]);
  });

  it("prints and installs Codex delegation instructions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "external-subagents-codex-cli-"));
    const target = path.join(root, "instructions.md");
    let printed = "";

    expect(await runCli(["codex-instructions"], { stdout: text => { printed += text; } })).toBe(0);
    expect(printed).toContain("Codex remains the primary owner");

    let installed = "";
    const code = await runCli(["install-codex-instructions", "--target", target], {
      stdout: text => { installed += text; }
    });

    expect(code).toBe(0);
    expect(installed).toContain("Installed");
    expect(await readFile(target, "utf8")).toContain("early delegation check");
    expect(isCliCommand(["codex-instructions"])).toBe(true);
    expect(isCliCommand(["install-codex-instructions"])).toBe(true);
  });
});
