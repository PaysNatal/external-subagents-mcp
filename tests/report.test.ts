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
});
