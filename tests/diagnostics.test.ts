import { describe, expect, it, vi } from "vitest";
import { normalizeConfig } from "../src/config.js";
import { buildProviderStatusReport, smokeProvider } from "../src/diagnostics.js";

describe("provider diagnostics", () => {
  it("reports active, auto-routed, and unused providers without exposing secrets", () => {
    const config = normalizeConfig(
      {
        routing: {
          profile: "code_quality_first",
          mode: "auto",
          auto_rules: [{ kind: "find_relevant_files", provider: "fast" }]
        },
        providers: {
          mimo: {
            base_url: "https://example.test/v1",
            api_key_env: "MIMO_API_KEY",
            model: "mimo-v2.5-pro"
          },
          glm: {
            base_url: "https://example.test/v1",
            api_key_env: "ZAI_API_KEY",
            model: "glm-5.1"
          },
          fast: {
            base_url: "https://example.test/v1",
            api_key_env: "FAST_API_KEY",
            model: "fast-code"
          },
          unused: {
            base_url: "https://example.test/v1",
            api_key_env: "UNUSED_API_KEY",
            model: "unused-model"
          }
        },
        profiles: {
          code_quality_first: {
            summarizer: "mimo",
            reviewer: "glm",
            log_analyst: "glm",
            file_finder: "glm"
          }
        }
      },
      "/repo"
    );

    const report = buildProviderStatusReport(config, {
      MIMO_API_KEY: "mimo-secret",
      ZAI_API_KEY: "glm-secret"
    });

    expect(report.status).toBe("WARN");
    expect(report.routing).toEqual({ profile: "code_quality_first", mode: "auto" });
    expect(report.providers.find(provider => provider.name === "mimo")).toMatchObject({
      key_status: "set",
      used_by: ["role:summarizer"]
    });
    expect(report.providers.find(provider => provider.name === "glm")?.used_by).toEqual([
      "role:reviewer",
      "role:log_analyst",
      "role:file_finder"
    ]);
    expect(report.providers.find(provider => provider.name === "fast")).toMatchObject({
      key_status: "missing",
      used_by: ["auto_rule:find_relevant_files"]
    });
    expect(report.providers.find(provider => provider.name === "unused")).toMatchObject({
      key_status: "missing",
      used_by: []
    });
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        severity: "warning",
        provider: "fast",
        code: "missing_api_key"
      })
    );
    expect(JSON.stringify(report)).not.toContain("secret");
  });

  it("smoke-tests one provider through chat completions", async () => {
    const config = normalizeConfig(
      {
        providers: {
          mimo: {
            base_url: "https://example.test/v1",
            api_key_env: "MIMO_API_KEY",
            model: "mimo-v2.5-pro"
          }
        },
        roles: {
          summarizer: "mimo"
        }
      },
      "/repo"
    );
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  status: "DONE",
                  summary: "provider smoke ok",
                  findings: [],
                  next_actions: ["ready"],
                  omitted: []
                })
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const result = await smokeProvider(config, { MIMO_API_KEY: "secret" }, { provider: "mimo", fetch: fetchMock });

    expect(result.ok).toBe(true);
    expect(result.provider).toBe("mimo");
    expect(result.report?.summary).toBe("provider smoke ok");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe("mimo-v2.5-pro");
    expect(body.messages[1].content).toContain("Return exactly this JSON object");
  });

  it("smoke fails clearly when the selected provider key is missing", async () => {
    const config = normalizeConfig(
      {
        providers: {
          glm: {
            base_url: "https://example.test/v1",
            api_key_env: "ZAI_API_KEY",
            model: "glm-5.1"
          }
        },
        roles: {
          reviewer: "glm"
        }
      },
      "/repo"
    );
    const fetchMock = vi.fn();

    const result = await smokeProvider(config, {}, { provider: "glm", fetch: fetchMock });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/ZAI_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
