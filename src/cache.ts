import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CachedJobResult } from "./types.js";

export interface CacheOptions {
  dir: string;
  ttlHours: number;
  maxBytes: number;
}

export class DiskCache {
  constructor(private readonly options: CacheOptions) {}

  keyFor(role: string, input: unknown): string {
    return createHash("sha256")
      .update(role)
      .update("\0")
      .update(stableStringify(input))
      .digest("hex");
  }

  inputHash(input: unknown): string {
    return createHash("sha256").update(stableStringify(input)).digest("hex");
  }

  async get(key: string): Promise<CachedJobResult | undefined> {
    try {
      const file = this.fileFor(key);
      const fileStat = await stat(file);
      const ageMs = Date.now() - fileStat.mtimeMs;
      if (ageMs > this.options.ttlHours * 60 * 60 * 1000) {
        return undefined;
      }
      return JSON.parse(await readFile(file, "utf8")) as CachedJobResult;
    } catch {
      return undefined;
    }
  }

  async set(key: string, result: CachedJobResult): Promise<void> {
    await mkdir(this.options.dir, { recursive: true });
    await this.enforceMaxBytes();
    await writeFile(this.fileFor(key), JSON.stringify(result, null, 2), "utf8");
  }

  private fileFor(key: string): string {
    if (!/^[a-f0-9]{64}$/.test(key)) {
      throw new Error(`Invalid cache key: ${key}`);
    }
    return path.join(this.options.dir, `${key}.json`);
  }

  private async enforceMaxBytes(): Promise<void> {
    try {
      const entries = await readdir(this.options.dir);
      const files = await Promise.all(
        entries
          .filter(entry => entry.endsWith(".json"))
          .map(async entry => {
            const file = path.join(this.options.dir, entry);
            const fileStat = await stat(file);
            return { file, size: fileStat.size, mtimeMs: fileStat.mtimeMs };
          })
      );
      let total = files.reduce((sum, file) => sum + file.size, 0);
      for (const file of files.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
        if (total <= this.options.maxBytes) {
          break;
        }
        await unlink(file.file);
        total -= file.size;
      }
    } catch {
      // Cache cleanup is best effort; cache writes will create the directory when needed.
    }
  }
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortForStableStringify(value));
}

function sortForStableStringify(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortForStableStringify);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, sortForStableStringify(nested)])
    );
  }
  return value;
}
