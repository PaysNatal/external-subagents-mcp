import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createWorkspace } from "../src/workspace.js";
import { normalizeConfig } from "../src/config.js";

async function makeWorkspace() {
  const root = await mkdtemp(path.join(tmpdir(), "external-subagents-"));
  const outside = await mkdtemp(path.join(tmpdir(), "external-subagents-outside-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "node_modules/pkg"), { recursive: true });
  await writeFile(path.join(root, "src/app.ts"), "export const answer = 42;\n");
  await writeFile(path.join(root, ".env"), "SECRET=value\n");
  await writeFile(path.join(root, "node_modules/pkg/index.js"), "module.exports = {};\n");
  await writeFile(path.join(outside, "secret.txt"), "outside\n");
  await symlink(path.join(outside, "secret.txt"), path.join(root, "src/outside-link.txt"));
  return root;
}

describe("workspace access", () => {
  it("allows configured source files and blocks denied files", async () => {
    const root = await makeWorkspace();
    const config = normalizeConfig(
      {
        workspace: { allow: ["src/**"], deny: ["**/.env*", "**/node_modules/**"] },
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
    const workspace = createWorkspace(config);

    const doc = await workspace.readAllowedFile("src/app.ts");
    expect(doc.text).toContain("answer");
    await expect(workspace.readAllowedFile(".env")).rejects.toThrow(/not allowed|denied/);
    await expect(workspace.readAllowedFile("node_modules/pkg/index.js")).rejects.toThrow(/denied|not allowed/);
  });

  it("blocks symlinks that escape the workspace root", async () => {
    const root = await makeWorkspace();
    const config = normalizeConfig(
      {
        workspace: { allow: ["src/**"] },
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
    const workspace = createWorkspace(config);

    await expect(workspace.readAllowedFile("src/outside-link.txt")).rejects.toThrow(/escapes workspace/);
  });
});
