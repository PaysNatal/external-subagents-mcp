import { describe, expect, it, vi } from "vitest";
import { normalizeConfig } from "../src/config.js";
import { buildProviderStatusReport, smokeProvider } from "../src/diagnostics.js";

describe("provider diagnostics", () => {
  it("reports active, auto-routed, and unused providers without exposing secrets", () => {
    const config = normalizeConfig(
      {
        routing: {
          profile: "quality_first",
          mode: "auto",
          auto_rules: [{ kind: "find_relevant_files", provider: "primary" }],
          budget_rules: [{ name: "long_logs", role: "log_analyst", min_input_bytes: 20000, max_output_tokens: 3500 }]
        },
        providers: {
          bulk: {
            base_url: "https://example.test/v1",
            api_key_env: "EXTERNAL_SUBAGENTS_BULK_API_KEY",
            model: "bulk-model"
          },
          quality: {
            base_url: "https://example.test/v1",
            api_key_env: "EXTERNAL_SUBAGENTS_QUALITY_API_KEY",
            model: "quality-model"
          },
          primary: {
            base_url: "https://example.test/v1",
            chat_completions_path: "openai/chat/completions",
            api_key_env: "EXTERNAL_SUBAGENTS_PRIMARY_API_KEY",
            model: "primary-model"
          },
          unused: {
            base_url: "https://example.test/v1",
            api_key_env: "UNUSED_API_KEY",
            model: "unused-model"
          }
        },
        profiles: {
          quality_first: {
            summarizer: "bulk",
            reviewer: "quality",
            log_analyst: "quality",
            file_finder: "quality"
          }
        }
      },
      "/repo"
    );

    const report = buildProviderStatusReport(config, {
      EXTERNAL_SUBAGENTS_BULK_API_KEY: "bulk-secret",
      EXTERNAL_SUBAGENTS_QUALITY_API_KEY: "quality-secret"
    });

    expect(report.status).toBe("WARN");
    expect(report.routing).toEqual({
      profile: "quality_first",
      mode: "auto",
      budget_rules: [
        { name: "long_logs", role: "log_analyst", min_input_bytes: 20000, max_output_tokens: 3500 }
      ]
    });
    expect(report.providers.find(provider => provider.name === "bulk")).toMatchObject({
      key_status: "set",
      used_by: ["role:summarizer"]
    });
    expect(report.providers.find(provider => provider.name === "quality")?.used_by).toEqual([
      "role:reviewer",
      "role:log_analyst",
      "role:file_finder"
    ]);
    expect(report.providers.find(provider => provider.name === "primary")).toMatchObject({
      chat_completions_url: "https://example.test/v1/openai/chat/completions",
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
        provider: "primary",
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
