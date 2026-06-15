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
  raw_advice?: string;
}

export type ReportParseMode = "strict" | "repaired" | "salvaged" | "text_fallback" | "raw_fallback";

export interface ReportRecovery {
  parseMode: ReportParseMode;
  outputTruncated: boolean;
  discardedTailBytes: number;
  recoveryWarnings: string[];
  reportCompleteness: number;
}

export interface ProviderRunRequest {
  role: string;
  system: string;
  user: string;
  maxOutputTokens: number;
  signal?: AbortSignal;
}

export interface ProviderUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ProviderRunResult {
  report: DelegateReport;
  usage?: ProviderUsage;
  recovery?: ReportRecovery;
}

export interface ProviderConversationMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_call_id?: string;
  tool_calls?: unknown;
  [key: string]: unknown;
}

export interface ProviderToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ProviderToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ProviderToolTurnRequest {
  messages: ProviderConversationMessage[];
  tools: ProviderToolDefinition[];
  maxOutputTokens: number;
  signal?: AbortSignal;
}

export interface ProviderToolTurnResult {
  assistantMessage: ProviderConversationMessage;
  text?: string;
  toolCalls: ProviderToolCall[];
  usage?: ProviderUsage;
  finishReason?: string;
}

export interface ProviderClient {
  name: string;
  runReport(request: ProviderRunRequest): Promise<ProviderRunResult>;
  runToolTurn?(request: ProviderToolTurnRequest): Promise<ProviderToolTurnResult>;
}

export interface RoleConfig {
  provider: string;
  maxOutputTokens: number;
}

export type JobKind = "review_diff" | "summarize_paths" | "find_relevant_files" | "analyze_log" | "explore_workspace";

export interface ExplorationTelemetry {
  turns: number;
  toolCalls: number;
  filesRead: number;
  sourceBytesRead: number;
  searchMatchesReturned: number;
  limitsHit: string[];
}

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
  workspaceRoot?: string;
  inputBytes?: number;
  externalApiCalled: boolean;
  usage?: ProviderUsage;
  recovery?: ReportRecovery;
  exploration?: ExplorationTelemetry;
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
  usage?: ProviderUsage;
  recovery?: ReportRecovery;
  exploration?: ExplorationTelemetry;
}
