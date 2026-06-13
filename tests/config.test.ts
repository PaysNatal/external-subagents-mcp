import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfigFile, normalizeConfig } from "../src/config.js";

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
    expect(config.roles.summarizer.maxOutputTokens).toBe(2000);
  });

  it("activates the selected profile and supports provider shorthand role entries", () => {
    const config = normalizeConfig(
      {
        routing: { profile: "quality_first" },
        providers: {
          lite: {
            base_url: "https://example.test/v1",
            api_key_env: "EXTERNAL_SUBAGENTS_LITE_API_KEY",
            model: "lite-model"
          },
          pro: {
            base_url: "https://example.test/v1",
            api_key_env: "EXTERNAL_SUBAGENTS_PRO_API_KEY",
            model: "pro-model"
          },
          standard: {
            base_url: "https://example.test/v1",
            api_key_env: "EXTERNAL_SUBAGENTS_STANDARD_API_KEY",
            model: "standard-model"
          }
        },
        profiles: {
          cost_first: {
            summarizer: "lite",
            reviewer: "pro",
            log_analyst: "lite",
            file_finder: "lite"
          },
          quality_first: {
            summarizer: "lite",
            reviewer: { provider: "pro", max_output_tokens: 3000 },
            log_analyst: "pro",
            file_finder: { provider: "standard", max_output_tokens: 1200 }
          }
        }
      },
      "/repo"
    );

    expect(config.routing.profile).toBe("quality_first");
    expect(config.roles.summarizer.provider).toBe("lite");
    expect(config.roles.reviewer.provider).toBe("pro");
    expect(config.roles.file_finder.provider).toBe("standard");
    expect(config.roles.file_finder.maxOutputTokens).toBe(1200);
  });

  it("normalizes auto routing rules without making them rewrite inputs", () => {
    const config = normalizeConfig(
      {
        routing: {
          profile: "quality_first",
          mode: "auto",
          auto_rules: [
            { kind: "find_relevant_files", provider: "standard" },
            { role: "log_analyst", min_input_bytes: 100000, provider: "long_context", max_output_tokens: 4000 }
          ]
        },
        providers: {
          lite: {
            base_url: "https://example.test/v1",
            api_key_env: "EXTERNAL_SUBAGENTS_LITE_API_KEY",
            model: "lite-model"
          },
          pro: {
            base_url: "https://example.test/v1",
            api_key_env: "EXTERNAL_SUBAGENTS_PRO_API_KEY",
            model: "pro-model"
          },
          standard: {
            base_url: "https://example.test/v1",
            api_key_env: "EXTERNAL_SUBAGENTS_STANDARD_API_KEY",
            model: "standard-model"
          },
          long_context: {
            base_url: "https://example.test/v1",
            api_key_env: "EXTERNAL_SUBAGENTS_LONG_API_KEY",
            model: "long-model"
          }
        },
        profiles: {
          quality_first: {
            summarizer: "lite",
            reviewer: "pro",
            log_analyst: "pro",
            file_finder: "pro"
          }
        }
      },
      "/repo"
    );

    expect(config.routing.mode).toBe("auto");
    expect(config.routing.autoRules).toEqual([
      { kinds: ["find_relevant_files"], provider: "standard" },
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

  it("loads a specific config file without upward discovery", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "external-subagents-direct-config-"));
    const configPath = path.join(root, ".external-subagents-mcp.json");
    await writeFile(
      configPath,
      JSON.stringify({
        workspace: { allow: ["approved/**"] },
        providers: {
          local: {
            base_url: "https://example.test/v1",
            api_key_env: "EXAMPLE_API_KEY",
            model: "example-model"
          }
        },
        roles: { summarizer: "local" }
      })
    );

    const config = loadConfigFile(configPath);

    expect(config.configPath).toBe(configPath);
    expect(config.workspace.root).toBe(root);
    expect(config.workspace.allow).toEqual(["approved/**"]);
  });
});
