import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { ZodError, z } from "zod";
import type { RoleConfig } from "./types.js";

const DEFAULT_ALLOW = ["src/**", "tests/**", "docs/**", "package.json", "README.md"];
const DEFAULT_DENY = [
  "**/.env*",
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.git/**",
  "**/*.pem",
  "**/*.key",
  "**/*.p12",
  "**/*.crt",
  "**/*.der",
  "**/*.png",
  "**/*.jpg",
  "**/*.jpeg",
  "**/*.gif",
  "**/*.webp",
  "**/*.pdf",
  "**/*.zip",
  "**/*.tar",
  "**/*.gz"
];

const providerSchema = z
  .object({
    base_url: z.string().url(),
    api_key_env: z.string().min(1),
    api_key: z.never().optional(),
    model: z.string().min(1),
    wire_api: z.literal("chat_completions").default("chat_completions"),
    timeout_ms: z.number().int().positive().default(120000)
  })
  .strict();

const rawConfigSchema = z
  .object({
    workspace: z
      .object({
        root: z.string().optional(),
        allow: z.array(z.string()).default(DEFAULT_ALLOW),
        deny: z.array(z.string()).default(DEFAULT_DENY),
        max_file_bytes: z.number().int().positive().default(262144),
        max_total_bytes: z.number().int().positive().default(2097152)
      })
      .optional(),
    cache: z
      .object({
        dir: z.string().default(".external-subagents/cache"),
        ttl_hours: z.number().positive().default(168),
        max_bytes: z.number().int().positive().default(524288000)
      })
      .optional(),
    concurrency: z
      .object({
        global: z.number().int().positive().default(3),
        per_provider: z.number().int().positive().default(2)
      })
      .optional(),
    providers: z.record(z.string(), providerSchema),
    roles: z.record(
      z.string(),
      z.object({
        provider: z.string().min(1),
        max_output_tokens: z.number().int().positive().optional()
      })
    )
  })
  .strict();

export type ProviderConfig = z.infer<typeof providerSchema>;

export interface NormalizedConfig {
  configPath?: string;
  workspace: {
    root: string;
    allow: string[];
    deny: string[];
    maxFileBytes: number;
    maxTotalBytes: number;
  };
  cache: {
    dir: string;
    ttlHours: number;
    maxBytes: number;
  };
  concurrency: {
    global: number;
    perProvider: number;
  };
  providers: Record<string, ProviderConfig>;
  roles: Record<string, RoleConfig>;
}

const DEFAULT_ROLE_BUDGETS: Record<string, number> = {
  summarizer: 2000,
  reviewer: 3000,
  log_analyst: 2500,
  file_finder: 1500
};

export function normalizeConfig(raw: unknown, cwd = process.cwd(), configPath?: string): NormalizedConfig {
  const parsed = parseRawConfig(raw);
  const workspace = parsed.workspace ?? {
    allow: DEFAULT_ALLOW,
    deny: DEFAULT_DENY,
    max_file_bytes: 262144,
    max_total_bytes: 2097152
  };
  const cache = parsed.cache ?? {
    dir: ".external-subagents/cache",
    ttl_hours: 168,
    max_bytes: 524288000
  };
  const concurrency = parsed.concurrency ?? {
    global: 3,
    per_provider: 2
  };
  const workspaceRoot = path.resolve(cwd, workspace.root ?? ".");
  const cacheDir = path.resolve(workspaceRoot, cache.dir ?? ".external-subagents/cache");
  const roles = Object.fromEntries(
    Object.entries(parsed.roles).map(([name, role]) => {
      if (!parsed.providers[role.provider]) {
        throw new Error(`Role "${name}" references unknown provider "${role.provider}".`);
      }
      return [
        name,
        {
          provider: role.provider,
          maxOutputTokens: role.max_output_tokens ?? DEFAULT_ROLE_BUDGETS[name] ?? 2000,
          max_output_tokens: role.max_output_tokens ?? DEFAULT_ROLE_BUDGETS[name] ?? 2000
        }
      ];
    })
  );

  return {
    configPath,
    workspace: {
      root: workspaceRoot,
      allow: workspace.allow ?? DEFAULT_ALLOW,
      deny: workspace.deny ?? DEFAULT_DENY,
      maxFileBytes: workspace.max_file_bytes ?? 262144,
      maxTotalBytes: workspace.max_total_bytes ?? 2097152
    },
    cache: {
      dir: cacheDir,
      ttlHours: cache.ttl_hours ?? 168,
      maxBytes: cache.max_bytes ?? 524288000
    },
    concurrency: {
      global: concurrency.global ?? 3,
      perProvider: concurrency.per_provider ?? 2
    },
    providers: parsed.providers,
    roles
  };
}

function parseRawConfig(raw: unknown): z.infer<typeof rawConfigSchema> {
  try {
    return rawConfigSchema.parse(raw);
  } catch (error) {
    if (
      error instanceof ZodError &&
      error.issues.some(issue => issue.path[0] === "providers" && issue.path[2] === "api_key")
    ) {
      throw new Error("Provider secrets must not be embedded in config. Remove api_key and use api_key_env instead.");
    }
    throw error;
  }
}

export function loadConfig(cwd = process.cwd(), env = process.env): NormalizedConfig {
  const configPath = findConfigPath(cwd, env);
  if (!configPath) {
    throw new Error(
      "No external-subagents-mcp config found. Set EXTERNAL_SUBAGENTS_CONFIG, add .external-subagents-mcp.json, or create ~/.config/external-subagents-mcp/config.json."
    );
  }
  const raw = JSON.parse(readFileSync(configPath, "utf8"));
  return normalizeConfig(raw, path.dirname(configPath), configPath);
}

export function findConfigPath(cwd = process.cwd(), env = process.env): string | undefined {
  if (env.EXTERNAL_SUBAGENTS_CONFIG) {
    return path.resolve(env.EXTERNAL_SUBAGENTS_CONFIG);
  }

  let dir = path.resolve(cwd);
  while (true) {
    const candidate = path.join(dir, ".external-subagents-mcp.json");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  const userConfig = path.join(homedir(), ".config", "external-subagents-mcp", "config.json");
  return existsSync(userConfig) ? userConfig : undefined;
}
