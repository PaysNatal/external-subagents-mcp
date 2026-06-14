import { z } from "zod";
import { jsonrepair } from "jsonrepair";
import type { DelegateReport, DelegateFinding, ReportParseMode, ReportRecovery } from "./types.js";

export const evidenceSchema = z.object({
  path: z.string(),
  line_start: z.number().int().positive().nullish().transform(value => value ?? undefined),
  line_end: z.number().int().positive().nullish().transform(value => value ?? undefined)
});

const minimalReportSchema = z.object({
  status: z.enum(["DONE", "DONE_WITH_CONCERNS", "NEEDS_CONTEXT", "BLOCKED", "FAILED"]),
  summary: z.string()
});

export const delegateReportSchema = z.object({
  status: z.enum(["DONE", "DONE_WITH_CONCERNS", "NEEDS_CONTEXT", "BLOCKED", "FAILED"]),
  summary: z.string(),
  findings: z
    .array(
      z.object({
        phase: z.string().optional(),
        depends_on: z.array(z.string()).default([]),
        severity: z.enum(["info", "low", "medium", "high"]),
        title: z.string(),
        description: z.string(),
        evidence: z.array(evidenceSchema).default([]),
        recommendation: z.string(),
        confidence: z.number().min(0).max(1)
      })
    )
    .default([]),
  next_actions: z.array(z.string()).default([]),
  omitted: z.array(z.string()).default([]),
  raw_advice: z.string().optional()
});

export function failedReport(summary: string, omitted: string[] = []): DelegateReport {
  return {
    status: "FAILED",
    summary,
    findings: [],
    next_actions: ["Verify the task manually in Codex before making changes."],
    omitted
  };
}

export function parseDelegateReport(raw: string): DelegateReport {
  return parseDelegateReportResult(raw).report;
}

export function parseDelegateReportResult(
  raw: string,
  options: { outputTruncated?: boolean } = {}
): { report: DelegateReport; recovery: ReportRecovery } {
  const trimmed = raw.trim();
  if (!isMeaningfulText(trimmed)) {
    throw new Error("Provider response did not contain meaningful analysis.");
  }
  const broadJson = extractBroadJson(trimmed);
  const likelyTruncated = options.outputTruncated === true || (broadJson ? hasUnclosedJson(broadJson) : false);

  if (broadJson) {
    try {
      const jsonText = extractJsonObject(trimmed);
      const report = normalizeReport(JSON.parse(jsonText));
      const outsideFindings = report.findings.length === 0 ? extractFallbackFindings(trimmed, jsonText) : [];
      const completeReport = outsideFindings.length > 0
        ? { ...report, findings: sortFindings(outsideFindings) }
        : report;
      return {
        report: finalizeRecoveredReport(completeReport, options.outputTruncated === true),
        recovery: recovery("strict", options.outputTruncated === true, 0, options.outputTruncated ? ["Provider reported an output-length limit after returning valid JSON."] : [], options.outputTruncated ? 0.98 : 1)
      };
    } catch {
      // Continue through progressively more tolerant recovery layers.
    }

    if (likelyTruncated) {
      const salvaged = salvageTruncatedReport(broadJson);
      if (salvaged) {
        return {
          report: finalizeRecoveredReport(salvaged.report, true),
          recovery: recovery(
            "salvaged",
            true,
            salvaged.discardedTailBytes,
            ["Provider output was truncated; incomplete tail discarded."],
            salvaged.completeness
          )
        };
      }
    }

    try {
      const report = normalizeReport(JSON.parse(jsonrepair(broadJson)));
      return {
        report: finalizeRecoveredReport(report, options.outputTruncated === true),
        recovery: recovery(
          "repaired",
          options.outputTruncated === true,
          0,
          ["Repaired malformed provider JSON syntax."],
          options.outputTruncated ? 0.9 : 0.95
        )
      };
    } catch {
      const salvaged = salvageTruncatedReport(broadJson);
      if (salvaged) {
        return {
          report: finalizeRecoveredReport(salvaged.report, true),
          recovery: recovery(
            "salvaged",
            true,
            salvaged.discardedTailBytes,
            ["Provider JSON could not be repaired; complete fields and findings were salvaged."],
            salvaged.completeness
          )
        };
      }
    }
  }

  const textFindings = extractFallbackFindings(trimmed, "").filter(
    finding => finding.severity !== "info" || finding.evidence.length > 0
  );
  if (textFindings.length > 0) {
    return {
      report: {
        status: "DONE_WITH_CONCERNS",
        summary: compactText(trimmed, 240),
        findings: sortFindings(textFindings),
        next_actions: ["Verify recovered text findings against the cited source before acting."],
        omitted: ["Provider output could not be parsed as JSON; findings were extracted from text."]
      },
      recovery: recovery("text_fallback", options.outputTruncated === true, 0, ["Recovered findings from unstructured provider text."], 0.55)
    };
  }

  return {
    report: {
      status: "NEEDS_CONTEXT",
      summary: "External delegate returned meaningful advice that could not be fully structured.",
      findings: [],
      next_actions: ["Review the recovered raw advice and verify it manually before acting."],
      omitted: ["Provider output could not be converted into structured findings."],
      raw_advice: compactText(trimmed, 4000)
    },
    recovery: recovery("raw_fallback", options.outputTruncated === true, 0, ["Preserved meaningful provider text as raw advice."], 0.3)
  };
}

const severityRank: Record<string, number> = { high: 0, medium: 1, low: 2, info: 3 };

function sortFindingsBySeverity(report: DelegateReport): DelegateReport {
  return {
    ...report,
    findings: sortFindings(report.findings)
  };
}

function sortFindings(findings: DelegateFinding[]): DelegateFinding[] {
  return [...findings].sort((a, b) => (severityRank[a.severity] ?? 4) - (severityRank[b.severity] ?? 4));
}

/**
 * When the full findings array is missing or malformed, extract approximate
 * findings from the text outside the JSON block. Looks for:
 * - File paths + line numbers (as evidence)
 * - Severity keywords (critical, high, medium, low, info, warning, error)
 * - Natural-language paragraphs that describe issues
 */
function extractFallbackFindings(fullText: string, jsonText: string): DelegateFinding[] {
  const outsideJson = fullText.replace(jsonText, "").trim();
  if (!outsideJson) {
    return [];
  }

  const findings: DelegateFinding[] = [];
  const lines = outsideJson.split("\n");

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("#") || trimmedLine.startsWith("```")) {
      continue;
    }

    // Try to extract a severity from keywords
    const severity = guessSeverity(trimmedLine);
    // Try to extract file references
    const evidence = extractPathEvidence(trimmedLine);

    // Only create a finding if there's meaningful content (> 20 chars)
    if (trimmedLine.length > 20) {
      findings.push({
        severity,
        title: trimmedLine.slice(0, 80),
        description: trimmedLine,
        evidence,
        recommendation: "Verify manually before acting.",
        confidence: 0.3
      });
    }
  }

  return findings.slice(0, 10); // Cap at 10 to avoid token bloat
}

function guessSeverity(text: string): DelegateFinding["severity"] {
  const lower = text.toLowerCase();
  if (/\b(critical|severe|urgent|crash|fatal)\b/.test(lower)) return "high";
  if (/\b(high|important|risk|danger|security|vulnerability)\b/.test(lower)) return "high";
  if (/\b(medium|moderate|warning|caution|concern)\b/.test(lower)) return "medium";
  if (/\b(low|minor|cosmetic|style|nit|nitpick)\b/.test(lower)) return "low";
  return "info";
}

function extractPathEvidence(text: string): DelegateFinding["evidence"] {
  const evidence: DelegateFinding["evidence"] = [];
  // Match file paths with extensions, optionally followed by :line or :line-line
  // e.g. "src/auth.ts:42-56", "tests/config.test.ts:15", "README.md"
  const pathPattern = /([\w\/.-]+\.\w+)(?::(\d+)(?:-(\d+))?)?/g;
  let match: RegExpExecArray | null;
  while ((match = pathPattern.exec(text)) !== null) {
    const path = match[1];
    // Skip non-code files like .json, .md in evidence (they're config/docs, not source)
    // but allow .ts, .js, .py, .tsx, .jsx, .go, .rs, .java, etc.
    if (!/\.(json|md|txt|log|yaml|yml|toml|cfg|conf|ini|env)$/i.test(path)) {
      evidence.push({
        path,
        line_start: match[2] ? Number(match[2]) : undefined,
        line_end: match[3] ? Number(match[3]) : undefined
      });
    }
  }
  return evidence;
}

function extractJsonObject(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    throw new Error("Provider response did not contain a JSON object.");
  }
  return text.slice(first, last + 1);
}

function extractBroadJson(text: string): string | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  const first = text.indexOf("{");
  return first === -1 ? undefined : text.slice(first).trim();
}

function normalizeReport(value: unknown): DelegateReport {
  if (!isRecord(value)) {
    throw new Error("Provider response JSON was not an object.");
  }
  const status = normalizeStatus(value.status);
  const summary = firstString(value.summary, value.answer, value.result, value.message);
  if (!status || !summary) {
    const minimal = minimalReportSchema.safeParse(value);
    if (!minimal.success) {
      throw new Error("Provider response did not contain status and summary fields.");
    }
  }
  const rawFindings = Array.isArray(value.findings)
    ? value.findings
    : Array.isArray(value.issues)
      ? value.issues
      : Array.isArray(value.results)
        ? value.results
        : [];
  const findings = rawFindings.map(normalizeFinding).filter((finding): finding is DelegateFinding => finding !== undefined).slice(0, 20);
  return sortFindingsBySeverity({
    status: status ?? "DONE_WITH_CONCERNS",
    summary: summary ?? "External delegate returned a report.",
    findings,
    next_actions: stringArray(value.next_actions ?? value.nextSteps ?? value.actions),
    omitted: stringArray(value.omitted ?? value.omittedFiles),
    ...(firstString(value.raw_advice, value.rawAdvice) ? { raw_advice: firstString(value.raw_advice, value.rawAdvice) } : {})
  });
}

function normalizeFinding(value: unknown): DelegateFinding | undefined {
  if (typeof value === "string") {
    return value.trim().length > 10
      ? {
          severity: guessSeverity(value),
          title: compactText(value, 80),
          description: value.trim(),
          evidence: extractPathEvidence(value),
          recommendation: "Verify this finding in the cited source before acting.",
          confidence: 0.4
        }
      : undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const description = firstString(value.description, value.detail, value.reason, value.message);
  const title = firstString(value.title, value.name, value.issue) ?? (description ? compactText(description, 80) : undefined);
  if (!title && !description) {
    return undefined;
  }
  const evidenceRaw = Array.isArray(value.evidence) ? value.evidence : Array.isArray(value.locations) ? value.locations : [];
  const evidence = evidenceRaw.map(normalizeEvidence).filter((item): item is DelegateFinding["evidence"][number] => item !== undefined);
  return {
    ...(firstString(value.phase) ? { phase: firstString(value.phase) } : {}),
    depends_on: stringArray(value.depends_on ?? value.dependsOn),
    severity: normalizeSeverity(value.severity),
    title: title ?? "Recovered finding",
    description: description ?? title ?? "Recovered finding",
    evidence,
    recommendation: firstString(value.recommendation, value.action, value.fix) ?? "Verify this finding in the cited source before acting.",
    confidence: normalizeConfidence(value.confidence)
  };
}

function normalizeEvidence(value: unknown): DelegateFinding["evidence"][number] | undefined {
  if (typeof value === "string") {
    return { path: value };
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const path = firstString(value.path, value.file, value.filename);
  if (!path) {
    return undefined;
  }
  return {
    path,
    ...(positiveInteger(value.line_start ?? value.lineStart ?? value.line) ? { line_start: positiveInteger(value.line_start ?? value.lineStart ?? value.line) } : {}),
    ...(positiveInteger(value.line_end ?? value.lineEnd) ? { line_end: positiveInteger(value.line_end ?? value.lineEnd) } : {})
  };
}

function salvageTruncatedReport(raw: string): { report: DelegateReport; discardedTailBytes: number; completeness: number } | undefined {
  const summary = extractQuotedField(raw, "summary");
  const status = normalizeStatus(extractQuotedField(raw, "status")) ?? "DONE_WITH_CONCERNS";
  const findingsStart = raw.search(/["']findings["']\s*:\s*\[/i);
  const objects = findingsStart >= 0 ? extractCompleteObjects(raw, raw.indexOf("[", findingsStart) + 1) : [];
  const findings = objects
    .map(item => {
      try {
        return normalizeFinding(JSON.parse(jsonrepair(item.text)));
      } catch {
        return undefined;
      }
    })
    .filter((finding): finding is DelegateFinding => finding !== undefined);
  if (!summary && findings.length === 0) {
    return undefined;
  }
  const lastEnd = objects.at(-1)?.end ?? Math.max(0, findingsStart);
  const discardedTail = raw.slice(lastEnd);
  const discardedTailBytes = Buffer.byteLength(discardedTail, "utf8");
  const completeness = Math.max(0.1, Math.min(0.9, lastEnd / Math.max(raw.length, 1)));
  return {
    report: {
      status,
      summary: summary ?? `Recovered ${findings.length} complete finding(s) from truncated provider output.`,
      findings: sortFindings(findings),
      next_actions: ["Verify salvaged findings before acting; the provider response was incomplete."],
      omitted: ["Provider output was truncated; incomplete tail discarded."],
      ...(isMeaningfulText(discardedTail) ? { raw_advice: compactText(discardedTail, 1000) } : {})
    },
    discardedTailBytes,
    completeness
  };
}

function extractCompleteObjects(text: string, from: number): Array<{ text: string; end: number }> {
  const results: Array<{ text: string; end: number }> = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = Math.max(0, from); index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        results.push({ text: text.slice(start, index + 1), end: index + 1 });
        start = -1;
      }
    }
  }
  return results;
}

function extractQuotedField(text: string, field: string): string | undefined {
  const match = text.match(new RegExp(`["']${field}["']\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, "i"));
  if (!match?.[1]) return undefined;
  try {
    return JSON.parse(`"${match[1]}"`);
  } catch {
    return match[1];
  }
}

function finalizeRecoveredReport(report: DelegateReport, outputTruncated: boolean): DelegateReport {
  if (!outputTruncated) return report;
  return {
    ...report,
    status: report.status === "DONE" ? "DONE_WITH_CONCERNS" : report.status,
    omitted: unique([...report.omitted, "Provider output was truncated; review may be incomplete."])
  };
}

function recovery(
  parseMode: ReportParseMode,
  outputTruncated: boolean,
  discardedTailBytes: number,
  recoveryWarnings: string[],
  reportCompleteness: number
): ReportRecovery {
  return { parseMode, outputTruncated, discardedTailBytes, recoveryWarnings, reportCompleteness };
}

function hasUnclosedJson(text: string): boolean {
  let braces = 0;
  let brackets = 0;
  let inString = false;
  let escaped = false;
  for (const char of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") braces += 1;
    else if (char === "}") braces -= 1;
    else if (char === "[") brackets += 1;
    else if (char === "]") brackets -= 1;
  }
  return inString || braces > 0 || brackets > 0;
}

function normalizeStatus(value: unknown): DelegateReport["status"] | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (["DONE", "SUCCESS", "COMPLETED", "OK"].includes(normalized)) return "DONE";
  if (["DONE_WITH_CONCERNS", "WARNING", "WARN", "PARTIAL"].includes(normalized)) return "DONE_WITH_CONCERNS";
  if (["NEEDS_CONTEXT", "NEED_CONTEXT", "INCOMPLETE"].includes(normalized)) return "NEEDS_CONTEXT";
  if (normalized === "BLOCKED") return "BLOCKED";
  if (["FAILED", "ERROR"].includes(normalized)) return "FAILED";
  return undefined;
}

function normalizeSeverity(value: unknown): DelegateFinding["severity"] {
  if (typeof value !== "string") return "info";
  const normalized = value.toLowerCase();
  if (["critical", "severe", "error", "high"].includes(normalized)) return "high";
  if (["warning", "warn", "moderate", "medium"].includes(normalized)) return "medium";
  if (["minor", "low"].includes(normalized)) return "low";
  return "info";
}

function normalizeConfidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function stringArray(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
}

function compactText(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, Math.max(0, maxLength - 1))}…`;
}

function isMeaningfulText(value: string): boolean {
  return value.length >= 20 && (value.match(/[A-Za-z\u4e00-\u9fff]/g)?.length ?? 0) >= 12;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export const REPORT_CONTRACT_MINIMAL = `Return a JSON object with at least these two fields:
{
  "status": "DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED | FAILED",
  "summary": "short answer for Codex"
}

If you can produce structured findings, also include:
{
  "findings": [
    {
      "phase": "discovery | analysis | verification | recommendation",
      "depends_on": ["phase#index, e.g. \"discovery#0\""],
      "severity": "info | low | medium | high",
      "title": "finding title",
      "description": "what was found",
      "evidence": [{"path": "src/file.ts", "line_start": 10, "line_end": 20}],
      "recommendation": "what Codex should verify or do",
      "confidence": 0.0
    }
  ],
  "next_actions": ["specific verification step"],
  "omitted": ["files or chunks not sent and why"]
}

status and summary are mandatory. findings, next_actions, and omitted are optional but highly valuable when included.

Reliability rules:
- Output one JSON object only. Do not add prose before or after it.
- Put status and summary first.
- Return at most 5 findings, highest severity first.
- Keep summary under 240 characters; each title under 100; each description and recommendation under 500.
- Complete each finding before starting the next one.
- If nearing the output limit, stop adding findings and close all JSON arrays and objects immediately.

Use phase to label each finding's reasoning stage. Use depends_on only when a finding truly depends on an earlier finding.`;

export const REPORT_CONTRACT = REPORT_CONTRACT_MINIMAL;
