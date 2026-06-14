import { describe, expect, it } from "vitest";
import { parseDelegateReport, parseDelegateReportResult } from "../src/report.js";

describe("parseDelegateReport", () => {
  it("accepts null evidence line numbers from external providers", () => {
    const report = parseDelegateReport(
      JSON.stringify({
        status: "DONE_WITH_CONCERNS",
        summary: "ok",
        findings: [
          {
            severity: "medium",
            title: "Needs verification",
            description: "Synthetic report.",
            evidence: [{ path: "src/example.ts", line_start: null, line_end: null }],
            recommendation: "Open the file before editing.",
            confidence: 0.7
          }
        ],
        next_actions: ["verify"],
        omitted: []
      })
    );

    expect(report.findings[0]?.evidence).toEqual([{ path: "src/example.ts" }]);
  });

  it("sorts findings by severity descending (high before low)", () => {
    const report = parseDelegateReport(
      JSON.stringify({
        status: "DONE_WITH_CONCERNS",
        summary: "mixed severity",
        findings: [
          { severity: "low", title: "Low", description: "d", recommendation: "r", confidence: 0.3 },
          { severity: "high", title: "High", description: "d", recommendation: "r", confidence: 0.9 },
          { severity: "medium", title: "Medium", description: "d", recommendation: "r", confidence: 0.6 },
          { severity: "info", title: "Info", description: "d", recommendation: "r", confidence: 0.1 }
        ],
        next_actions: [],
        omitted: []
      })
    );

    expect(report.findings.map(f => f.severity)).toEqual(["high", "medium", "low", "info"]);
  });

  it("falls back to minimal schema when findings are malformed", () => {
    const report = parseDelegateReport(
      JSON.stringify({
        status: "DONE",
        summary: "Files reviewed successfully.",
        findings: "not an array",
        next_actions: "also wrong"
      })
    );

    expect(report.status).toBe("DONE");
    expect(report.summary).toBe("Files reviewed successfully.");
    expect(report.findings).toEqual([]);
    expect(report.next_actions).toEqual(["also wrong"]);
  });

  it("extracts fallback findings from free text outside JSON", () => {
    const tripleBacktick = "`" + "`" + "`";
    const raw = "Here is my analysis:\n\n"
      + tripleBacktick + "json\n"
      + '{"status": "DONE_WITH_CONCERNS", "summary": "Security risks found in auth module."}\n'
      + tripleBacktick + "\n\n"
      + "Critical vulnerability in src/auth.ts:42-56 — password field is not encrypted. This is a high-severity security risk.\n"
      + "Medium concern: src/config.ts has hardcoded API keys at line 15.";

    const report = parseDelegateReport(raw);

    expect(report.status).toBe("DONE_WITH_CONCERNS");
    expect(report.summary).toBe("Security risks found in auth module.");
    expect(report.findings.length).toBeGreaterThanOrEqual(1);
    // The high-severity finding should come first (severity sorting)
    expect(report.findings[0].severity).toBe("high");
    // Evidence paths should be extracted
    const authFinding = report.findings.find(f => f.description.includes("auth.ts"));
    expect(authFinding).toBeDefined();
    expect(authFinding!.evidence.some(e => e.path.includes("auth.ts"))).toBe(true);
  });

  it("repairs common JSON syntax errors and normalizes loose finding fields", () => {
    const result = parseDelegateReportResult(`{
      status: "DONE_WITH_CONCERNS",
      summary: "Found a problem",
      findings: [{
        severity: "critical",
        title: "Unsafe path",
        description: "src/path.ts accepts unsafe input",
        evidence: [{path: "src/path.ts", line_start: 12}],
      }],
      nextSteps: ["Open src/path.ts"],
    }`);

    expect(result.recovery.parseMode).toBe("repaired");
    expect(result.report.findings[0]).toMatchObject({
      severity: "high",
      recommendation: "Verify this finding in the cited source before acting.",
      confidence: 0.5
    });
    expect(result.report.next_actions).toEqual(["Open src/path.ts"]);
  });

  it("salvages complete findings from a response truncated inside the final finding", () => {
    const result = parseDelegateReportResult(
      `{"status":"DONE_WITH_CONCERNS","summary":"Two issues found","findings":[` +
      `{"severity":"high","title":"Complete issue","description":"First issue","evidence":[{"path":"src/a.ts","line_start":10}],"recommendation":"Verify it","confidence":0.9},` +
      `{"severity":"medium","title":"Incomplete issue","description":"This final finding was cut`,
      { outputTruncated: true }
    );

    expect(result.report.status).toBe("DONE_WITH_CONCERNS");
    expect(result.report.findings).toHaveLength(1);
    expect(result.report.findings[0]?.title).toBe("Complete issue");
    expect(result.report.omitted).toContain("Provider output was truncated; incomplete tail discarded.");
    expect(result.report.raw_advice).toContain("Incomplete issue");
    expect(result.recovery).toMatchObject({
      parseMode: "salvaged",
      outputTruncated: true
    });
    expect(result.recovery.discardedTailBytes).toBeGreaterThan(0);
    expect(result.recovery.reportCompleteness).toBeLessThan(1);
  });

  it("converts meaningful plain-text advice into a usable fallback report", () => {
    const result = parseDelegateReportResult(
      "High risk in src/auth.ts:42: authentication checks can be bypassed. Verify the guard before editing."
    );

    expect(result.report.status).toBe("DONE_WITH_CONCERNS");
    expect(result.report.findings[0]?.evidence[0]).toMatchObject({ path: "src/auth.ts", line_start: 42 });
    expect(result.recovery.parseMode).toBe("text_fallback");
  });

  it("returns a raw fallback for meaningful text that cannot be structured", () => {
    const result = parseDelegateReportResult(
      "The analysis could not finish cleanly, but the dependency boundary deserves another careful inspection."
    );

    expect(result.report.status).toBe("NEEDS_CONTEXT");
    expect(result.report.raw_advice).toContain("dependency boundary");
    expect(result.recovery.parseMode).toBe("raw_fallback");
  });

  it("rejects output that contains no meaningful advice", () => {
    expect(() => parseDelegateReportResult("ok")).toThrow(/meaningful/);
  });
});
