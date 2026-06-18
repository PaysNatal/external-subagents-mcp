import { mkdtemp, mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createWorkspace, createWorkspaceResolver } from "../src/workspace.js";
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

function configJson(workspace: Record<string, unknown> = { allow: ["src/**"] }) {
  return JSON.stringify({
    workspace,
    providers: {
      local: {
        base_url: "https://example.test/v1",
        api_key_env: "EXAMPLE_API_KEY",
        model: "example-model"
      }
    },
    roles: { summarizer: "local" }
  });
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

  it("supports bounded text search and line-range reads", async () => {
    const root = await makeWorkspace();
    await writeFile(path.join(root, "src/second.ts"), "first\nconst answer = 42;\nthird\n");
    const workspace = createWorkspace(normalizeConfig({
      workspace: { allow: ["src/**"], deny: ["**/.env*"] },
      providers: { local: { base_url: "https://example.test/v1", api_key_env: "KEY", model: "local" } },
      roles: { summarizer: "local" }
    }, root));

    const matches = await workspace.searchAllowedText("answer", ["src/**/*.ts"], 5);
    const range = await workspace.readAllowedFileRange("src/second.ts", 2, 2);

    expect(matches).toEqual([
      expect.objectContaining({ path: "src/app.ts", line: 1 }),
      expect.objectContaining({ path: "src/second.ts", line: 2 })
    ]);
    expect(range.text).toBe("const answer = 42;");
    expect(range.bytes).toBeGreaterThan(0);
  });

  it("reports when allowed file listing is truncated", async () => {
    const root = await makeWorkspace();
    await writeFile(path.join(root, "src/alpha.ts"), "export const alpha = 1;\n");
    await writeFile(path.join(root, "src/beta.ts"), "export const beta = 2;\n");
    const workspace = createWorkspace(normalizeConfig({
      workspace: { allow: ["src/**"], deny: ["**/.env*"] },
      providers: { local: { base_url: "https://example.test/v1", api_key_env: "KEY", model: "local" } },
      roles: { summarizer: "local" }
    }, root));

    const listing = await workspace.listAllowedFiles(["src/**/*.ts"], 2);

    expect(listing.files).toHaveLength(2);
    expect(listing.truncated).toBe(true);
    expect(listing.maxResults).toBe(2);
  });

  it("resolves a second workspace only when it has a direct authorization config", async () => {
    const defaultRoot = await makeWorkspace();
    const secondRoot = await makeWorkspace();
    await writeFile(path.join(secondRoot, "src/app.ts"), "export const other = 7;\n");
    await writeFile(path.join(secondRoot, ".external-subagents-mcp.json"), configJson());
    const defaultConfig = normalizeConfig(JSON.parse(configJson()), defaultRoot);
    const resolver = createWorkspaceResolver(defaultConfig);

    const resolved = await resolver.resolve(secondRoot);

    expect(resolved.requestedRoot).toBe(await realpath(secondRoot));
    expect(resolved.effectiveRoot).toBe(await realpath(secondRoot));
    expect((await resolved.workspace.readAllowedFile("src/app.ts")).text).toContain("other");
  });

  it("rejects relative roots and roots without a direct authorization config", async () => {
    const defaultRoot = await makeWorkspace();
    const unauthorizedRoot = await makeWorkspace();
    const resolver = createWorkspaceResolver(normalizeConfig(JSON.parse(configJson()), defaultRoot));

    await expect(resolver.resolve("../other-project")).rejects.toThrow(/absolute/);
    await expect(resolver.resolve(unauthorizedRoot)).rejects.toThrow(/directly contain.*external-subagents-mcp/i);
  });

  it("rejects target configs whose workspace root escapes the requested project", async () => {
    const defaultRoot = await makeWorkspace();
    const requestedRoot = await makeWorkspace();
    const outside = await makeWorkspace();
    await writeFile(
      path.join(requestedRoot, ".external-subagents-mcp.json"),
      configJson({ root: outside, allow: ["src/**"] })
    );
    const resolver = createWorkspaceResolver(normalizeConfig(JSON.parse(configJson()), defaultRoot));

    await expect(resolver.resolve(requestedRoot)).rejects.toThrow(/workspace\.root.*inside the requested project/i);
  });
});
