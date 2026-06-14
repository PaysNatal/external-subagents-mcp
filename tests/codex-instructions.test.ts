import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BEGIN_MARKER,
  END_MARKER,
  installCodexInstructions,
  renderCodexInstructions
} from "../src/codex-instructions.js";

describe("Codex delegation instructions", () => {
  it("defines Codex ownership and an early delegation check", () => {
    const instructions = renderCodexInstructions();

    expect(instructions).toContain("Codex remains the primary owner");
    expect(instructions).toMatch(/before large source reads/i);
    expect(instructions).toContain("Do not delegate architecture");
    expect(instructions).toMatch(/external delegates are a read-only labor pool/i);
  });

  it("installs idempotently while preserving unrelated content", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "external-subagents-instructions-"));
    const target = path.join(root, ".codex", "instructions.md");
    await writeFile(path.join(root, "existing.md"), "unused", "utf8");

    const first = await installCodexInstructions({ target, dryRun: false });
    const firstText = await readFile(target, "utf8");
    const second = await installCodexInstructions({ target, dryRun: false });

    expect(first).toMatchObject({ changed: true, target });
    expect(second).toMatchObject({ changed: false, target });
    expect(firstText).toContain(BEGIN_MARKER);
    expect(firstText).toContain(END_MARKER);

    await writeFile(target, `User rule stays.\n\n${firstText}`, "utf8");
    const updated = await installCodexInstructions({ target, dryRun: false });
    expect(updated.changed).toBe(false);
    expect(await readFile(target, "utf8")).toContain("User rule stays.");
  });

  it("supports dry-run without writing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "external-subagents-instructions-dry-"));
    const target = path.join(root, "instructions.md");

    const result = await installCodexInstructions({ target, dryRun: true });

    expect(result).toMatchObject({ changed: true, dryRun: true });
    await expect(readFile(target, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses malformed or duplicated markers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "external-subagents-instructions-bad-"));
    const target = path.join(root, "instructions.md");
    await writeFile(target, `${BEGIN_MARKER}\nmissing end\n`, "utf8");

    await expect(installCodexInstructions({ target, dryRun: false })).rejects.toThrow(/marker/i);

    await writeFile(target, `${BEGIN_MARKER}\na\n${END_MARKER}\n${BEGIN_MARKER}\nb\n${END_MARKER}\n`, "utf8");
    await expect(installCodexInstructions({ target, dryRun: false })).rejects.toThrow(/marker/i);
  });
});
