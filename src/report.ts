import { z } from "zod";
import type { DelegateReport } from "./types.js";

export const evidenceSchema = z.object({
  path: z.string(),
  line_start: z.number().int().positive().nullish().transform(value => value ?? undefined),
  line_end: z.number().int().positive().nullish().transform(value => value ?? undefined)
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
  return delegateReportSchema.parse(parsed);
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

export const REPORT_CONTRACT = `Return ONLY a JSON object with this shape:
{
  "status": "DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED | FAILED",
  "summary": "short answer for Codex",
  "findings": [
    {
      "phase": "discovery | analysis | verification | recommendation",
      "depends_on": ["phase#index of findings this one builds on, e.g. \"discovery#0\""],
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

phase and depends_on are optional but recommended. Use phase to label each finding's reasoning stage. Use depends_on to indicate which earlier findings this finding's conclusion depends on, so Codex can audit whether the reasoning chain is internally consistent before acting on the report.`;
