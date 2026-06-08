import type { NormalizedConfig } from "./config.js";
import { OpenAICompatibleProvider } from "./provider.js";
import type { DelegateReport, JobKind, RoutingRule } from "./types.js";

export type DiagnosticStatus = "OK" | "WARN" | "ERROR";
export type ProviderKeyStatus = "set" | "missing";

export interface ProviderDiagnostic {
  name: string;
  base_url: string;
  model: string;
  api_key_env: string;
  key_status: ProviderKeyStatus;
  used_by: string[];
}

export interface ProviderDiagnosticIssue {
  severity: "info" | "warning" | "error";
  code: string;
  provider?: string;
  message: string;
  recommendation?: string;
}

export interface ProviderStatusReport {
  status: DiagnosticStatus;
  config_path?: string;
  routing: {
    profile?: string;
    mode: string;
  };
  providers: ProviderDiagnostic[];
  issues: ProviderDiagnosticIssue[];
}

export interface ProviderSmokeInput {
  provider: string;
  maxOutputTokens?: number;
  fetch?: typeof fetch;
}

export interface ProviderSmokeReport {
  ok: boolean;
  provider: string;
  status: DiagnosticStatus;
  report?: DelegateReport;
  error?: string;
}

export function buildProviderStatusReport(config: NormalizedConfig, env: NodeJS.ProcessEnv = process.env): ProviderStatusReport {
  const usage = providerUsage(config);
  const issues: ProviderDiagnosticIssue[] = [];
  const providers = Object.entries(config.providers).map(([name, providerConfig]) => {
    const usedBy = usage.get(name) ?? [];
    const keyStatus: ProviderKeyStatus = env[providerConfig.api_key_env] ? "set" : "missing";
    if (keyStatus === "missing" && usedBy.length > 0) {
      issues.push({
        severity: "warning",
        code: "missing_api_key",
        provider: name,
        message: `Provider "${name}" is used by active routing but ${providerConfig.api_key_env} is not set.`,
        recommendation: `Set ${providerConfig.api_key_env}, or switch the active profile/routing rules away from "${name}".`
      });
    }

    return {
      name,
      base_url: providerConfig.base_url,
      model: providerConfig.model,
      api_key_env: providerConfig.api_key_env,
      key_status: keyStatus,
      used_by: usedBy
    };
  });

  return {
    status: issues.some(issue => issue.severity === "error") ? "ERROR" : issues.length > 0 ? "WARN" : "OK",
    ...(config.configPath ? { config_path: config.configPath } : {}),
    routing: {
      ...(config.routing.profile ? { profile: config.routing.profile } : {}),
      mode: config.routing.mode
    },
    providers,
    issues
  };
}

export async function smokeProvider(
  config: NormalizedConfig,
  env: NodeJS.ProcessEnv = process.env,
  input: ProviderSmokeInput
): Promise<ProviderSmokeReport> {
  const providerConfig = config.providers[input.provider];
  if (!providerConfig) {
    return {
      ok: false,
      provider: input.provider,
      status: "ERROR",
      error: `Unknown provider: ${input.provider}`
    };
  }

  const apiKey = env[providerConfig.api_key_env];
  if (!apiKey) {
    return {
      ok: false,
      provider: input.provider,
      status: "WARN",
      error: `Missing API key environment variable for provider "${input.provider}": ${providerConfig.api_key_env}`
    };
  }

  const provider = new OpenAICompatibleProvider({
    name: input.provider,
    baseUrl: providerConfig.base_url,
    apiKey,
    model: providerConfig.model,
    timeoutMs: providerConfig.timeout_ms,
    fetch: input.fetch
  });
  const report = await provider.runReport({
    role: "provider_smoke",
    system: "Return only valid JSON. Do not include markdown.",
    user: [
      "Return exactly this JSON object and nothing else:",
      '{"status":"DONE","summary":"provider smoke ok","findings":[],"next_actions":["ready"],"omitted":[]}'
    ].join("\n\n"),
    maxOutputTokens: input.maxOutputTokens ?? 500
  });

  return {
    ok: report.status !== "FAILED",
    provider: input.provider,
    status: report.status === "FAILED" ? "ERROR" : "OK",
    report,
    ...(report.status === "FAILED" ? { error: report.summary } : {})
  };
}

function providerUsage(config: NormalizedConfig): Map<string, string[]> {
  const usage = new Map<string, string[]>();
  for (const [role, roleConfig] of Object.entries(config.roles)) {
    appendUsage(usage, roleConfig.provider, `role:${role}`);
  }
  if (config.routing.mode === "auto") {
    for (const rule of config.routing.autoRules) {
      appendUsage(usage, rule.provider, `auto_rule:${routingRuleLabel(rule)}`);
    }
  }
  return usage;
}

function appendUsage(usage: Map<string, string[]>, provider: string, label: string): void {
  usage.set(provider, [...(usage.get(provider) ?? []), label]);
}

function routingRuleLabel(rule: RoutingRule): string {
  if (rule.kinds?.length) {
    return rule.kinds.join(",");
  }
  if (rule.role) {
    return `role:${rule.role}`;
  }
  return "default";
}
