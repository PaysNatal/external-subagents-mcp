import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export const BEGIN_MARKER = "<!-- BEGIN external-subagents-mcp codex instructions -->";
export const END_MARKER = "<!-- END external-subagents-mcp codex instructions -->";

export interface InstallCodexInstructionsOptions {
  target?: string;
  dryRun?: boolean;
}

export interface InstallCodexInstructionsResult {
  target: string;
  changed: boolean;
  dryRun: boolean;
  content: string;
}

export function renderCodexInstructions(): string {
  return `## External Subagents: Codex-Led Read-Only Labor Pool

Codex remains the primary owner: understand the user's goal, plan, decide, edit, execute commands, verify results, and accept the final work.

External delegates are a read-only labor pool for bounded repetitive, simple, or high-context work such as file discovery, large source reading, summarization, log analysis, and initial review. They provide evidence and advice; they do not own the project or decide the final implementation.

Before large source reads, content searches, or log ingestion, perform an early delegation check:

- Delegate when a focused labor unit is repetitive, primarily search/read/extract/summarize/analyze, likely to consume substantial main-model context, and independently verifiable.
- Keep the work with Codex when it requires architecture, cross-domain judgment, root-cause reasoning, final implementation decisions, edits, shell commands, tests, acceptance, sensitive unavailable context, or when delegation overhead exceeds the benefit.
- Prefer one complete bounded labor unit over many micro-delegations.
- Prefer path-based delegation so source content does not enter the main-model context.
- Verify important evidence before acting. If delegation fails, is low-quality twice, or lacks required context, Codex takes over.
- Respect explicit user instructions to delegate or not delegate.

Do not delegate architecture, final implementation decisions, file edits, shell execution, test execution, approvals, or final acceptance.`;
}

export function renderMarkedCodexInstructions(): string {
  return `${BEGIN_MARKER}\n${renderCodexInstructions()}\n${END_MARKER}`;
}

export async function installCodexInstructions(
  options: InstallCodexInstructionsOptions = {}
): Promise<InstallCodexInstructionsResult> {
  const target = path.resolve(options.target ?? path.join(homedir(), ".codex", "instructions.md"));
  const dryRun = options.dryRun ?? false;
  const existing = await readOptionalFile(target);
  validateMarkers(existing);
  const marked = renderMarkedCodexInstructions();
  const content = replaceOrAppendMarkedBlock(existing, marked);
  const changed = content !== existing;

  if (changed && !dryRun) {
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, content, { encoding: "utf8", mode: 0o600 });
  }

  return { target, changed, dryRun, content };
}

function replaceOrAppendMarkedBlock(existing: string, marked: string): string {
  const begin = existing.indexOf(BEGIN_MARKER);
  if (begin >= 0) {
    const end = existing.indexOf(END_MARKER, begin) + END_MARKER.length;
    return `${existing.slice(0, begin)}${marked}${existing.slice(end)}`;
  }
  if (!existing.trim()) {
    return `${marked}\n`;
  }
  return `${existing.trimEnd()}\n\n${marked}\n`;
}

function validateMarkers(content: string): void {
  const begins = countOccurrences(content, BEGIN_MARKER);
  const ends = countOccurrences(content, END_MARKER);
  if (begins > 1 || ends > 1 || begins !== ends) {
    throw new Error("Cannot install Codex instructions because the managed markers are malformed or duplicated.");
  }
  if (begins === 1 && content.indexOf(BEGIN_MARKER) > content.indexOf(END_MARKER)) {
    throw new Error("Cannot install Codex instructions because the managed markers are out of order.");
  }
}

function countOccurrences(content: string, marker: string): number {
  return content.split(marker).length - 1;
}

async function readOptionalFile(target: string): Promise<string> {
  try {
    return await readFile(target, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
