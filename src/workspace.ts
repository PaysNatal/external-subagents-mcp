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
        // Stat + check quota BEFORE reading the file, avoiding wasted I/O
        const safeRelative = normalizeRelativePath(relativePath);
        assertAllowedByGlob(safeRelative, this.config);
        const absolutePath = path.resolve(this.config.workspace.root, safeRelative);
        await assertInsideWorkspace(absolutePath, this.config.workspace.root);
        const fileStat = await stat(absolutePath);
        if (!fileStat.isFile()) {
          omitted.push(`${relativePath}: path is not a regular file`);
          continue;
        }
        if (fileStat.size > this.config.workspace.maxFileBytes) {
          omitted.push(`${relativePath}: file exceeds max_file_bytes (${fileStat.size} > ${this.config.workspace.maxFileBytes})`);
          continue;
        }
        if (totalBytes + fileStat.size > this.config.workspace.maxTotalBytes) {
          omitted.push(`${relativePath}: omitted because max_total_bytes would be exceeded`);
          continue;
        }
        const bytes = await readFile(absolutePath);
        if (looksBinary(bytes)) {
          omitted.push(`${relativePath}: binary file is not allowed`);
          continue;
        }
        totalBytes += fileStat.size;
        documents.push({
          path: safeRelative,
          absolutePath,
          text: bytes.toString("utf8"),
          bytes: fileStat.size
        });
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

const MAX_DEPTH = 50;

async function walk(
  root: string,
  onFile: (absolute: string) => Promise<void>,
  depth = 0,
  visited = new Set<string>()
): Promise<void> {
  if (depth > MAX_DEPTH) {
    return;
  }

  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(root, entry.name);

    // Skip symlinks that resolve outside workspace; keep internal symlinks
    if (entry.isSymbolicLink()) {
      try {
        const resolved = await realpath(absolute);
        const realRoot = await realpath(root);
        const rel = path.relative(realRoot, resolved);
        if (rel.startsWith("..") || path.isAbsolute(rel)) {
          continue; // symlink escapes workspace — skip
        }
        // Internal symlink: follow it like a regular entry
        const resolvedStat = await lstat(resolved);
        if (resolvedStat.isDirectory()) {
          if (visited.has(resolved)) {
            continue; // cycle detected
          }
          visited.add(resolved);
          await walk(resolved, onFile, depth + 1, visited);
        } else if (resolvedStat.isFile()) {
          await onFile(absolute);
        }
      } catch {
        // Dangling symlink or permission error — skip
        continue;
      }
      continue;
    }

    if (entry.isDirectory()) {
      try {
        const resolved = await realpath(absolute);
        if (visited.has(resolved)) {
          continue; // cycle detected
        }
        visited.add(resolved);
        await walk(absolute, onFile, depth + 1, visited);
      } catch (error) {
        // Skip inaccessible directories gracefully
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "EACCES" || code === "EPERM") {
          continue;
        }
        continue;
      }
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
  // Check for dangling symlinks and give clear error
  const entryStat = await lstat(absolutePath);
  if (entryStat.isSymbolicLink()) {
    try {
      await realpath(absolutePath);
    } catch {
      throw new Error(`Symbolic link points to a non-existent target: ${absolutePath}`);
    }
  }
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