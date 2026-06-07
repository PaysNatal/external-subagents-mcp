import { describe, expect, it } from "vitest";
import { normalizeConfig } from "../src/config.js";

describe("normalizeConfig", () => {
  it("rejects provider API keys embedded in config", () => {
    expect(() =>
      normalizeConfig(
        {
          providers: {
            bad: {
              base_url: "https://example.test/v1",
              api_key: "secret",
              api_key_env: "BAD_API_KEY",
              model: "example"
            }
          },
          roles: {
            reviewer: { provider: "bad" }
          }
        },
        "/repo"
      )
    ).toThrow(/api_key_env/);
  });

  it("applies secure workspace, cache, and concurrency defaults", () => {
    const config = normalizeConfig(
      {
        providers: {
          local: {
            base_url: "https://example.test/v1",
            api_key_env: "EXAMPLE_API_KEY",
            model: "example-model"
          }
        },
        roles: {
          summarizer: { provider: "local" }
        }
      },
      "/repo"
    );

    expect(config.workspace.allow).toContain("src/**");
    expect(config.workspace.deny).toContain("**/.env*");
    expect(config.cache.dir).toBe("/repo/.external-subagents/cache");
    expect(config.concurrency.global).toBe(3);
    expect(config.roles.summarizer.max_output_tokens).toBe(2000);
  });

  it("activates the selected profile and supports provider shorthand role entries", () => {
    const config = normalizeConfig(
      {
        routing: { profile: "balanced_three_model" },
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
          }
        },
        profiles: {
          cost_first: {
            summarizer: "mimo",
            reviewer: "glm",
            log_analyst: "mimo",
            file_finder: "mimo"
          },
          balanced_three_model: {
            summarizer: "mimo",
            reviewer: { provider: "glm", max_output_tokens: 3000 },
            log_analyst: "glm",
            file_finder: { provider: "fast", max_output_tokens: 1200 }
          }
        }
      },
      "/repo"
    );

    expect(config.routing.profile).toBe("balanced_three_model");
    expect(config.roles.summarizer.provider).toBe("mimo");
    expect(config.roles.reviewer.provider).toBe("glm");
    expect(config.roles.file_finder.provider).toBe("fast");
    expect(config.roles.file_finder.max_output_tokens).toBe(1200);
  });

  it("normalizes auto routing rules without making them rewrite inputs", () => {
    const config = normalizeConfig(
      {
        routing: {
          profile: "code_quality_first",
          mode: "auto",
          auto_rules: [
            { kind: "find_relevant_files", provider: "fast" },
            { role: "log_analyst", min_input_bytes: 100000, provider: "long_context", max_output_tokens: 4000 }
          ]
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
          long_context: {
            base_url: "https://example.test/v1",
            api_key_env: "LONG_API_KEY",
            model: "long-code"
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

    expect(config.routing.mode).toBe("auto");
    expect(config.routing.autoRules).toEqual([
      { kinds: ["find_relevant_files"], provider: "fast" },
      { role: "log_analyst", minInputBytes: 100000, provider: "long_context", maxOutputTokens: 4000 }
    ]);
  });
});
