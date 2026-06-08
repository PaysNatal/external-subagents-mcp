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
        routing: { profile: "quality_first" },
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
            api_key_env: "EXTERNAL_SUBAGENTS_PRIMARY_API_KEY",
            model: "primary-model"
          }
        },
        profiles: {
          cost_first: {
            summarizer: "bulk",
            reviewer: "quality",
            log_analyst: "bulk",
            file_finder: "bulk"
          },
          quality_first: {
            summarizer: "bulk",
            reviewer: { provider: "quality", max_output_tokens: 3000 },
            log_analyst: "quality",
            file_finder: { provider: "primary", max_output_tokens: 1200 }
          }
        }
      },
      "/repo"
    );

    expect(config.routing.profile).toBe("quality_first");
    expect(config.roles.summarizer.provider).toBe("bulk");
    expect(config.roles.reviewer.provider).toBe("quality");
    expect(config.roles.file_finder.provider).toBe("primary");
    expect(config.roles.file_finder.max_output_tokens).toBe(1200);
  });

  it("normalizes auto routing rules without making them rewrite inputs", () => {
    const config = normalizeConfig(
      {
        routing: {
          profile: "quality_first",
          mode: "auto",
          auto_rules: [
            { kind: "find_relevant_files", provider: "primary" },
            { role: "log_analyst", min_input_bytes: 100000, provider: "long_context", max_output_tokens: 4000 }
          ]
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
            api_key_env: "EXTERNAL_SUBAGENTS_PRIMARY_API_KEY",
            model: "primary-model"
          },
          long_context: {
            base_url: "https://example.test/v1",
            api_key_env: "EXTERNAL_SUBAGENTS_LONG_API_KEY",
            model: "long-model"
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

    expect(config.routing.mode).toBe("auto");
    expect(config.routing.autoRules).toEqual([
      { kinds: ["find_relevant_files"], provider: "primary" },
      { role: "log_analyst", minInputBytes: 100000, provider: "long_context", maxOutputTokens: 4000 }
    ]);
  });

  it("normalizes dynamic budget rules separately from provider routing", () => {
    const config = normalizeConfig(
      {
        routing: {
          profile: "mimo_only",
          budget_rules: [
            { name: "long_logs", role: "log_analyst", min_input_bytes: 20000, max_output_tokens: 3500 },
            { name: "huge_reviews", kind: ["review_diff", "summarize_paths"], min_input_bytes: 80000, max_output_tokens: 6000 }
          ]
        },
        providers: {
          mimo: {
            base_url: "https://example.test/v1",
            api_key_env: "MIMO_API_KEY",
            model: "mimo-v2.5-pro"
          }
        },
        profiles: {
          mimo_only: {
            summarizer: "mimo",
            reviewer: "mimo",
            log_analyst: "mimo",
            file_finder: "mimo"
          }
        }
      },
      "/repo"
    );

    expect(config.routing.budgetRules).toEqual([
      { name: "long_logs", role: "log_analyst", minInputBytes: 20000, maxOutputTokens: 3500 },
      { name: "huge_reviews", kinds: ["review_diff", "summarize_paths"], minInputBytes: 80000, maxOutputTokens: 6000 }
    ]);
  });

  it("accepts a custom chat completions path for providers with nonstandard endpoints", () => {
    const config = normalizeConfig(
      {
        providers: {
          minimax: {
            base_url: "https://api.minimax.io/v1",
            chat_completions_path: "text/chatcompletion_v2",
            api_key_env: "MINIMAX_API_KEY",
            model: "MiniMax-M1"
          }
        },
        roles: {
          summarizer: "minimax"
        }
      },
      "/repo"
    );

    expect(config.providers.minimax.chat_completions_path).toBe("text/chatcompletion_v2");
  });
});
