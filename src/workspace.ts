import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { minimatch } from "minimatch";
import type { NormalizedConfig } from "./config.js";

export interface WorkspaceDocument {
  path: string;
  absolutePath: string;
  text: string;
  bytes: number;
}

export interface WorkspaceReader {
  readAllowedFile(relativePath: string): Promise<WorkspaceDocument>;
  readAllowedFiles(relativePaths: string[]): Promise<{ documents: WorkspaceDocument[]; omitted: string[] }>;
  listAllowedFiles(globs?: string[], maxResults?: number): Promise<string[]>;
}

export function createWorkspace(config: NormalizedConfig): WorkspaceReader {
  return new SafeWorkspace(config);
}

class SafeWorkspace implements WorkspaceReader {
  constructor(private readonly config: NormalizedConfig) {}

  async readAllowedFile(relativePath: string): Promise<WorkspaceDocument> {
    const safeRelative = normalizeRelativePath(relativePath);
    assertAllowedByGlob(safeRelative, this.config);

    const absolutePath = path.resolve(this.config.workspace.root, safeRelative);
    await assertInsideWorkspace(absolutePath, this.config.workspace.root);
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) {
      throw new Error(`Path is not a regular file: ${safeRelative}`);
    }
    if (fileStat.size > this.config.workspace.maxFileBytes) {
      throw new Error(`File exceeds max_file_bytes: ${safeRelative}`);
    }
    const bytes = await readFile(absolutePath);
    if (looksBinary(bytes)) {
      throw new Error(`Binary file is not allowed: ${safeRelative}`);
    }
    return {
      path: safeRelative,
      absolutePath,
      text: bytes.toString("utf8"),
      bytes: fileStat.size
    };
  }

  async readAllowedFiles(relativePaths: string[]): Promise<{ documents: WorkspaceDocument[]; omitted: string[] }> {
    const documents: WorkspaceDocument[] = [];
    const omitted: string[] = [];
    let totalBytes = 0;

    for (const relativePath of relativePaths) {
      try {
        const doc = await this.readAllowedFile(relativePath);
        if (totalBytes + doc.bytes > this.config.workspace.maxTotalBytes) {
          omitted.push(`${doc.path}: omitted because max_total_bytes would be exceeded`);
          continue;
        }
        totalBytes += doc.bytes;
        documents.push(doc);
      } catch (error) {
        omitted.push(`${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return { documents, omitted };
  }

  async listAllowedFiles(globs: string[] = ["**/*"], maxResults = 200): Promise<string[]> {
    const results: string[] = [];
    await walk(this.config.workspace.root, async absolute => {
      if (results.length >= maxResults) {
        return;
      }
      const rel = toPosix(path.relative(this.config.workspace.root, absolute));
      if (isDenied(rel, this.config) || !isAllowed(rel, this.config)) {
        return;
      }
      if (!globs.some(glob => minimatch(rel, glob, { dot: true }))) {
        return;
      }
      const fileStat = await stat(absolute);
      if (fileStat.isFile() && fileStat.size <= this.config.workspace.maxFileBytes) {
        results.push(rel);
      }
    });
    return results;
  }
}

async function walk(root: string, onFile: (absolute: string) => Promise<void>): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await walk(absolute, onFile);
    } else if (entry.isFile()) {
      await onFile(absolute);
    }
  }
}

function normalizeRelativePath(input: string): string {
  const normalized = toPosix(path.normalize(input));
  if (path.isAbsolute(input) || normalized.startsWith("../") || normalized === "..") {
    throw new Error(`Path must stay inside workspace: ${input}`);
  }
  return normalized.replace(/^\.\//, "");
}

function assertAllowedByGlob(relativePath: string, config: NormalizedConfig): void {
  if (isDenied(relativePath, config)) {
    throw new Error(`Path is denied by workspace.deny: ${relativePath}`);
  }
  if (!isAllowed(relativePath, config)) {
    throw new Error(`Path is not allowed by workspace.allow: ${relativePath}`);
  }
}

function isAllowed(relativePath: string, config: NormalizedConfig): boolean {
  return config.workspace.allow.some(pattern => minimatch(relativePath, pattern, { dot: true }));
}

function isDenied(relativePath: string, config: NormalizedConfig): boolean {
  return config.workspace.deny.some(pattern => minimatch(relativePath, pattern, { dot: true }));
}

async function assertInsideWorkspace(absolutePath: string, workspaceRoot: string): Promise<void> {
  await lstat(absolutePath);
  const resolved = await realpath(absolutePath);
  const realRoot = await realpath(workspaceRoot);
  const relative = path.relative(realRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes workspace root: ${absolutePath}`);
  }
}

function looksBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8000));
  return sample.includes(0);
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}
