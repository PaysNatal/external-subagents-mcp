import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { ZodError, z } from "zod";
import type { JobKind, RoleConfig, RoutingConfig, RoutingRule } from "./types.js";

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

const roleEntrySchema = z.union([
  z.string().min(1),
  z
    .object({
      provider: z.string().min(1),
      max_output_tokens: z.number().int().positive().optional()
    })
    .strict()
]);

const roleMapSchema = z.record(z.string(), roleEntrySchema);
const jobKindSchema = z.enum(["review_diff", "summarize_paths", "find_relevant_files", "analyze_log"]);
const jobKindsSchema = z.union([jobKindSchema, z.array(jobKindSchema).min(1)]);

const routingRuleSchema = z
  .object({
    role: z.string().min(1).optional(),
    kind: jobKindsSchema.optional(),
    min_input_bytes: z.number().int().nonnegative().optional(),
    max_input_bytes: z.number().int().nonnegative().optional(),
    provider: z.string().min(1),
    max_output_tokens: z.number().int().positive().optional()
  })
  .strict();

const routingSchema = z
  .object({
    profile: z.string().min(1).optional(),
    mode: z.enum(["profile", "auto"]).default("profile"),
    auto_rules: z.array(routingRuleSchema).default([])
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
    roles: roleMapSchema.optional(),
    profiles: z.record(z.string(), roleMapSchema).optional(),
    routing: routingSchema.optional()
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
  profiles: Record<string, Record<string, RoleConfig>>;
  routing: RoutingConfig;
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
  const profiles = Object.fromEntries(
    Object.entries(parsed.profiles ?? {}).map(([name, roleMap]) => [name, normalizeRoleMap(roleMap, parsed.providers)])
  );
  const routing = normalizeRouting(parsed.routing, parsed.providers);
  const selectedRoles =
    routing.profile !== undefined
      ? profiles[routing.profile]
      : parsed.roles
        ? normalizeRoleMap(parsed.roles, parsed.providers)
        : undefined;

  if (!selectedRoles) {
    throw new Error(
      routing.profile
        ? `Routing profile "${routing.profile}" was not found in profiles.`
        : "Config must define roles, or define routing.profile with a matching profiles entry."
    );
  }

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
    roles: selectedRoles,
    profiles,
    routing
  };
}

function normalizeRoleMap(rawRoles: z.infer<typeof roleMapSchema>, providers: Record<string, ProviderConfig>): Record<string, RoleConfig> {
  return Object.fromEntries(
    Object.entries(rawRoles).map(([name, rawRole]) => {
      const role = typeof rawRole === "string" ? { provider: rawRole } : rawRole;
      if (!providers[role.provider]) {
        throw new Error(`Role "${name}" references unknown provider "${role.provider}".`);
      }
      const maxOutputTokens = role.max_output_tokens ?? DEFAULT_ROLE_BUDGETS[name] ?? 2000;
      return [
        name,
        {
          provider: role.provider,
          maxOutputTokens,
          max_output_tokens: maxOutputTokens
        }
      ];
    })
  );
}

function normalizeRouting(rawRouting: z.infer<typeof routingSchema> | undefined, providers: Record<string, ProviderConfig>): RoutingConfig {
  return {
    profile: rawRouting?.profile,
    mode: rawRouting?.mode ?? "profile",
    autoRules: (rawRouting?.auto_rules ?? []).map(rule => normalizeRoutingRule(rule, providers))
  };
}

function normalizeRoutingRule(rule: z.infer<typeof routingRuleSchema>, providers: Record<string, ProviderConfig>): RoutingRule {
  if (!providers[rule.provider]) {
    throw new Error(`Auto routing rule references unknown provider "${rule.provider}".`);
  }
  if (rule.min_input_bytes !== undefined && rule.max_input_bytes !== undefined && rule.min_input_bytes > rule.max_input_bytes) {
    throw new Error("Auto routing rule min_input_bytes must be less than or equal to max_input_bytes.");
  }
  const kinds = normalizeKinds(rule.kind);
  return {
    ...(rule.role ? { role: rule.role } : {}),
    ...(kinds ? { kinds } : {}),
    ...(rule.min_input_bytes !== undefined ? { minInputBytes: rule.min_input_bytes } : {}),
    ...(rule.max_input_bytes !== undefined ? { maxInputBytes: rule.max_input_bytes } : {}),
    provider: rule.provider,
    ...(rule.max_output_tokens !== undefined ? { maxOutputTokens: rule.max_output_tokens } : {})
  };
}

function normalizeKinds(kind: z.infer<typeof jobKindsSchema> | undefined): JobKind[] | undefined {
  if (kind === undefined) {
    return undefined;
  }
  return Array.isArray(kind) ? kind : [kind];
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
