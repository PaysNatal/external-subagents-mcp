import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";

describe("runCli", () => {
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
});
