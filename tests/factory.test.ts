import { describe, expect, it } from "vitest";
import { normalizeConfig } from "../src/config.js";
import { createAppFromConfig } from "../src/factory.js";

describe("createAppFromConfig", () => {
  it("starts with API keys only for providers that are currently available", () => {
    const config = normalizeConfig(
      {
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
          }
        },
        roles: {
          summarizer: { provider: "mimo" },
          reviewer: { provider: "mimo" }
        }
      },
      "/repo"
    );

    expect(() => createAppFromConfig(config, { MIMO_API_KEY: "secret" })).not.toThrow();
  });

  it("reports a missing API key only when a job routes to that provider", async () => {
    const config = normalizeConfig(
      {
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
          }
        },
        roles: {
          summarizer: { provider: "mimo" },
          reviewer: { provider: "glm" }
        }
      },
      "/repo"
    );

    const app = createAppFromConfig(config, { MIMO_API_KEY: "secret" });
    await expect(
      app.delegateReviewDiff({
        diff_text: "diff --git a/src/a.ts b/src/a.ts\n+export const a = 1;",
        focus: "smoke"
      })
    ).rejects.toThrow(/ZAI_API_KEY/);
  });
});
