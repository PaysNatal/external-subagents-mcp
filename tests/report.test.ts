import { describe, expect, it } from "vitest";
import { parseDelegateReport } from "../src/report.js";

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
    expect(report.next_actions).toEqual([]);
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

  it("rejects responses with no valid JSON at all", () => {
    expect(() => parseDelegateReport("Just plain text, no JSON here.")).toThrow(/JSON object/);
  });
});
