import { describe, expect, it } from "vitest";
import { normalizeConfig } from "../src/config.js";
import { createAppFromConfig } from "../src/factory.js";

describe("createAppFromConfig", () => {
  it("requires API keys only for providers referenced by roles", () => {
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

  it("fails fast when a referenced provider API key is missing", () => {
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
          summarizer: { provider: "mimo" }
        }
      },
      "/repo"
    );

    expect(() => createAppFromConfig(config, {})).toThrow(/MIMO_API_KEY/);
  });
});
