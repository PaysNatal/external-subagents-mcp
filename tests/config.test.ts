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
});
