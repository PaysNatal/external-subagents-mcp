import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import type { BudgetRule, CachedJobResult, JobKind, JobRecord, JobState, ProviderClient, RoleConfig, RoutingConfig } from "./types.js";

export interface StartJobInput {
  kind: JobKind;
  role: string;
  prompt: string;
  cacheKey?: string;
  cached?: CachedJobResult;
  inputHash?: string;
  inputBytes?: number;
  workspaceRoot?: string;
  maxOutputTokens?: number;
  onComplete?: (job: JobRecord) => Promise<void>;
}

interface QueuedJob extends JobRecord {
  prompt: string;
  inputHash?: string;
  maxOutputTokens?: number;
  onComplete?: (job: JobRecord) => Promise<void>;
  abortController: AbortController;
}

interface RouteSelection {
  provider: string;
  maxOutputTokens: number;
  budgetSource: string;
}

export interface JobManagerOptions {
  providers: Map<string, ProviderClient>;
  missingProviderKeys?: Map<string, string>;
  roles: Map<string, RoleConfig>;
  routing?: RoutingConfig;
  globalConcurrency: number;
  perProviderConcurrency: number;
}

export class JobManager {
  private readonly jobs = new Map<string, QueuedJob>();
  private readonly queue: QueuedJob[] = [];
  private runningGlobal = 0;
  private readonly runningByProvider = new Map<string, number>();

  constructor(private readonly options: JobManagerOptions) {}

  start(input: StartJobInput): JobRecord {
    const role = this.options.roles.get(input.role);
    if (!role) {
      throw new Error(`Unknown role: ${input.role}`);
    }
    const inputBytes = input.inputBytes ?? Buffer.byteLength(input.prompt, "utf8");
    const route = this.selectRoute(input.kind, input.role, role, inputBytes);
    const maxOutputTokens = input.maxOutputTokens ?? route.maxOutputTokens;
    const budgetSource = input.maxOutputTokens !== undefined ? "input:output_budget" : route.budgetSource;

    const now = new Date().toISOString();
    if (input.cached) {
      const cachedJob: QueuedJob = {
        id: `job_${randomUUID()}`,
        kind: input.kind,
        role: input.role,
        provider: input.cached.provider || route.provider,
        state: "completed",
        createdAt: now,
        startedAt: now,
        completedAt: now,
        cacheKey: input.cacheKey,
        cacheHit: true,
        elapsedMs: 0,
        report: input.cached.report,
        maxOutputTokens,
        budgetSource,
        workspaceRoot: input.workspaceRoot,
        prompt: "",
        abortController: new AbortController()
      };
      this.jobs.set(cachedJob.id, cachedJob);
      return publicJob(cachedJob);
    }

    this.resolveProvider(input.role, route.provider);

    const job: QueuedJob = {
      id: `job_${randomUUID()}`,
      kind: input.kind,
      role: input.role,
      provider: route.provider,
      state: "queued",
      createdAt: now,
      cacheKey: input.cacheKey,
      cacheHit: false,
      prompt: input.prompt,
      inputHash: input.inputHash,
      maxOutputTokens,
      budgetSource,
      workspaceRoot: input.workspaceRoot,
      onComplete: input.onComplete,
      abortController: new AbortController()
    };
    this.jobs.set(job.id, job);
    this.queue.push(job);
    queueMicrotask(() => this.pump());
    return publicJob(job);
  }

  status(jobIds?: string[]): JobRecord[] {
    const selected = jobIds?.length ? jobIds.map(id => this.jobs.get(id)).filter(Boolean) : Array.from(this.jobs.values());
    return (selected as QueuedJob[]).map(publicJob);
  }

  result(jobId: string): JobRecord | undefined {
    const job = this.jobs.get(jobId);
    return job ? publicJob(job) : undefined;
  }

  cancel(jobId: string): JobRecord {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Unknown job: ${jobId}`);
    }
    if (job.state === "completed" || job.state === "failed" || job.state === "cancelled") {
      return publicJob(job);
    }
    job.abortController.abort();
    job.state = "cancelled";
    job.completedAt = new Date().toISOString();
    return publicJob(job);
  }

  async wait(jobIds: string[], timeoutMs: number): Promise<JobRecord[]> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const records = this.status(jobIds);
      if (records.every(job => isFinal(job.state))) {
        return records;
      }
      await sleep(Math.min(100, Math.max(10, deadline - Date.now())));
    }
    return this.status(jobIds);
  }

  private pump(): void {
    while (this.runningGlobal < this.options.globalConcurrency) {
      const nextIndex = this.queue.findIndex(job => this.canRun(job));
      if (nextIndex === -1) {
        return;
      }
      const [job] = this.queue.splice(nextIndex, 1);
      void this.run(job);
    }
  }

  private canRun(job: QueuedJob): boolean {
    const providerRunning = this.runningByProvider.get(job.provider ?? "") ?? 0;
    return providerRunning < this.options.perProviderConcurrency && job.state === "queued";
  }

  private async run(job: QueuedJob): Promise<void> {
    if (job.state === "cancelled") {
      return;
    }
    const role = this.options.roles.get(job.role);
    const providerName = job.provider;
    const provider = providerName ? this.options.providers.get(providerName) : undefined;
    if (!role || !provider || !providerName) {
      job.state = "failed";
      job.error = "Missing provider or role configuration.";
      job.completedAt = new Date().toISOString();
      return;
    }

    this.runningGlobal += 1;
    this.runningByProvider.set(providerName, (this.runningByProvider.get(providerName) ?? 0) + 1);
    const started = Date.now();
    job.startedAt = new Date(started).toISOString();
    job.state = "running";

    try {
      const result = await provider.runReport({
        role: job.role,
        system: "You are an external read-only subagent. You cannot edit files, run shell commands, or apply patches.",
        user: job.prompt,
        maxOutputTokens: job.maxOutputTokens ?? role.maxOutputTokens,
        signal: job.abortController.signal
      });
      const report = result.report;
      if (job.abortController.signal.aborted) {
        job.state = "cancelled";
        return;
      }
      job.report = report;
      job.state = report.status === "FAILED" ? "failed" : "completed";
      job.error = report.status === "FAILED" ? report.summary : undefined;
      job.completedAt = new Date().toISOString();
      job.elapsedMs = Date.now() - started;
      // Clear prompt reference to free memory after job completes
      job.prompt = "";
      try {
        await job.onComplete?.(publicJob(job));
      } catch {
        // Ignore callback errors (e.g. cache write failure) to prevent
        // overwriting the already-set successful job state.
      }
    } catch (error) {
      if (!job.abortController.signal.aborted) {
        job.state = "failed";
        job.error = error instanceof Error ? error.message : String(error);
        job.completedAt = new Date().toISOString();
        job.elapsedMs = Date.now() - started;
      } else {
        job.state = "cancelled";
      }
      // Clear prompt reference even on error
      job.prompt = "";
    } finally {
      this.runningGlobal -= 1;
      this.runningByProvider.set(providerName, Math.max(0, (this.runningByProvider.get(providerName) ?? 1) - 1));
      this.pump();
    }
  }

  private selectRoute(kind: JobKind, roleName: string, role: RoleConfig, inputBytes: number): RouteSelection {
    const route: RouteSelection = {
      provider: role.provider,
      maxOutputTokens: role.maxOutputTokens,
      budgetSource: `role:${roleName}`
    };

    if (this.options.routing?.mode === "auto") {
      for (const rule of this.options.routing.autoRules) {
        if (!ruleMatches(rule, kind, roleName, inputBytes)) {
          continue;
        }
        route.provider = rule.provider;
        if (rule.maxOutputTokens !== undefined) {
          route.maxOutputTokens = rule.maxOutputTokens;
          route.budgetSource = `auto_rule:${routingRuleLabel(rule)}`;
        }
        break;
      }
    }

    for (const rule of this.options.routing?.budgetRules ?? []) {
      if (!ruleMatches(rule, kind, roleName, inputBytes)) {
        continue;
      }
      route.maxOutputTokens = rule.maxOutputTokens;
      route.budgetSource = `budget_rule:${budgetRuleLabel(rule)}`;
      break;
    }

    return route;
  }

  private resolveProvider(roleName: string, providerName: string): ProviderClient {
    const provider = this.options.providers.get(providerName);
    if (provider) {
      return provider;
    }
    const missingEnv = this.options.missingProviderKeys?.get(providerName);
    if (missingEnv) {
      throw new Error(`Missing API key environment variable for provider "${providerName}": ${missingEnv}`);
    }
    throw new Error(`Unknown provider for role ${roleName}: ${providerName}`);
  }
}

function ruleMatches(
  rule: Pick<BudgetRule | NonNullable<RoutingConfig["autoRules"]>[number], "role" | "kinds" | "minInputBytes" | "maxInputBytes">,
  kind: JobKind,
  roleName: string,
  inputBytes: number
): boolean {
  if (rule.role && rule.role !== roleName) {
    return false;
  }
  if (rule.kinds && !rule.kinds.includes(kind)) {
    return false;
  }
  if (rule.minInputBytes !== undefined && inputBytes < rule.minInputBytes) {
    return false;
  }
  if (rule.maxInputBytes !== undefined && inputBytes > rule.maxInputBytes) {
    return false;
  }
  return true;
}

function routingRuleLabel(rule: NonNullable<RoutingConfig["autoRules"]>[number]): string {
  if (rule.kinds?.length) {
    return rule.kinds.join(",");
  }
  if (rule.role) {
    return `role:${rule.role}`;
  }
  return rule.provider;
}

function budgetRuleLabel(rule: BudgetRule): string {
  if (rule.name) {
    return rule.name;
  }
  if (rule.kinds?.length) {
    return rule.kinds.join(",");
  }
  if (rule.role) {
    return `role:${rule.role}`;
  }
  return "default";
}

function publicJob(job: QueuedJob | JobRecord): JobRecord {
  const {
    id,
    kind,
    role,
    provider,
    state,
    createdAt,
    startedAt,
    completedAt,
    cacheKey,
    cacheHit,
    elapsedMs,
    error,
    report,
    maxOutputTokens,
    budgetSource,
    workspaceRoot
  } = job;
  return {
    id,
    kind,
    role,
    provider,
    state,
    createdAt,
    startedAt,
    completedAt,
    cacheKey,
    cacheHit,
    elapsedMs,
    error,
    report,
    maxOutputTokens,
    budgetSource,
    workspaceRoot
  };
}

function isFinal(state: JobState): boolean {
  return state === "completed" || state === "failed" || state === "cancelled";
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
