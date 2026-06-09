export type DelegateStatus = "DONE" | "DONE_WITH_CONCERNS" | "NEEDS_CONTEXT" | "BLOCKED" | "FAILED";

export type FindingSeverity = "info" | "low" | "medium" | "high";

export interface EvidenceLocation {
  path: string;
  line_start?: number;
  line_end?: number;
}

export interface DelegateFinding {
  phase?: string;
  depends_on?: string[];
  severity: FindingSeverity;
  title: string;
  description: string;
  evidence: EvidenceLocation[];
  recommendation: string;
  confidence: number;
}

export interface DelegateReport {
  status: DelegateStatus;
  summary: string;
  findings: DelegateFinding[];
  next_actions: string[];
  omitted: string[];
}

export interface ProviderRunRequest {
  role: string;
  system: string;
  user: string;
  maxOutputTokens: number;
  signal?: AbortSignal;
}

export interface ProviderClient {
  name: string;
  runReport(request: ProviderRunRequest): Promise<DelegateReport>;
}

export interface RoleConfig {
  provider: string;
  maxOutputTokens: number;
}

export type JobKind = "review_diff" | "summarize_paths" | "find_relevant_files" | "analyze_log";

export type RoutingMode = "profile" | "auto";

export interface BudgetRule {
  name?: string;
  role?: string;
  kinds?: JobKind[];
  minInputBytes?: number;
  maxInputBytes?: number;
  maxOutputTokens: number;
}

export interface RoutingRule {
  role?: string;
  kinds?: JobKind[];
  minInputBytes?: number;
  maxInputBytes?: number;
  provider: string;
  maxOutputTokens?: number;
}

export interface RoutingConfig {
  profile?: string;
  mode: RoutingMode;
  autoRules: RoutingRule[];
  budgetRules: BudgetRule[];
}

export type JobState = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface JobRecord {
  id: string;
  kind: JobKind;
  role: string;
  provider?: string;
  state: JobState;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  cacheKey?: string;
  cacheHit: boolean;
  elapsedMs?: number;
  error?: string;
  report?: DelegateReport;
  maxOutputTokens?: number;
  budgetSource?: string;
}

export interface CachedJobResult {
  id: string;
  role: string;
  provider: string;
  report: DelegateReport;
  createdAt: string;
  completedAt: string;
  cacheKey: string;
  inputHash: string;
}
