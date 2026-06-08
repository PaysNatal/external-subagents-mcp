import { z } from "zod";
import type { DelegateReport, DelegateFinding } from "./types.js";

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
  omitted: z.array(z.string()).default([])
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
  const trimmed = raw.trim();

  const jsonText = extractJsonObject(trimmed);
  const parsed = JSON.parse(jsonText);

  let report: DelegateReport;
  try {
    report = delegateReportSchema.parse(parsed);
  } catch {
    // Full schema failed — try minimal (status + summary only)
    try {
      const minimal = minimalReportSchema.parse(parsed);
      report = { ...minimal, findings: [], next_actions: [], omitted: [] };
    } catch {
      throw new Error("Provider response did not contain a JSON object with status and summary fields.");
    }
  }

  // If findings are empty and there is free text outside the JSON,
  // extract approximate findings from it
  if (report.findings.length === 0) {
    const fallback = extractFallbackFindings(trimmed, jsonText);
    if (fallback.length > 0) {
      report = { ...report, findings: fallback };
    }
  }

  return sortFindingsBySeverity(report);
}

const severityRank: Record<string, number> = { high: 0, medium: 1, low: 2, info: 3 };

function sortFindingsBySeverity(report: DelegateReport): DelegateReport {
  return {
    ...report,
    findings: [...report.findings].sort(
      (a, b) => (severityRank[a.severity] ?? 4) - (severityRank[b.severity] ?? 4)
    )
  };
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

status and summary are mandatory. findings, next_actions, and omitted are optional but highly valuable when included. If you cannot produce valid JSON for findings, write them as plain-text paragraphs after the JSON block — the server will extract them.

Use phase to label each finding's reasoning stage. Use depends_on to indicate which earlier findings this finding's conclusion depends on, so Codex can audit whether the reasoning chain is internally consistent before acting on the report.`;

export const REPORT_CONTRACT = REPORT_CONTRACT_MINIMAL;
