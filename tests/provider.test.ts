import { describe, expect, it, vi } from "vitest";
import { OpenAICompatibleProvider } from "../src/provider.js";

describe("OpenAICompatibleProvider", () => {
  it("normalizes JSON reports from chat completions", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  status: "DONE",
                  summary: "ok",
                  findings: [],
                  next_actions: ["verify"],
                  omitted: []
                })
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const provider = new OpenAICompatibleProvider({
      name: "local",
      baseUrl: "https://example.test/v1",
      apiKey: "secret",
      model: "example",
      fetch: fetchMock
    });

    const result = await provider.runReport({
      role: "reviewer",
      system: "Return JSON.",
      user: "Review this.",
      maxOutputTokens: 1000
    });

    expect(result.report.status).toBe("DONE");
    expect(result.report.next_actions).toEqual(["verify"]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not append chat/completions when baseUrl is already the full endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  status: "DONE",
                  summary: "ok",
                  findings: [],
                  next_actions: [],
                  omitted: []
                })
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const provider = new OpenAICompatibleProvider({
      name: "deepseek",
      baseUrl: "https://api.deepseek.com/chat/completions",
      apiKey: "secret",
      model: "deepseek-chat",
      fetch: fetchMock
    });

    await provider.runReport({
      role: "reviewer",
      system: "Return JSON.",
      user: "Review this.",
      maxOutputTokens: 1000
    });

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api.deepseek.com/chat/completions");
  });

  it("uses a configured chat completions path for nonstandard OpenAI-compatible providers", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  status: "DONE",
                  summary: "ok",
                  findings: [],
                  next_actions: [],
                  omitted: []
                })
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const provider = new OpenAICompatibleProvider({
      name: "minimax",
      baseUrl: "https://api.minimax.io/v1",
      chatCompletionsPath: "text/chatcompletion_v2",
      apiKey: "secret",
      model: "MiniMax-M1",
      fetch: fetchMock
    });

    await provider.runReport({
      role: "reviewer",
      system: "Return JSON.",
      user: "Review this.",
      maxOutputTokens: 1000
    });

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api.minimax.io/v1/text/chatcompletion_v2");
  });

  it("returns FAILED when the provider output is not parseable JSON", async () => {
    const provider = new OpenAICompatibleProvider({
      name: "local",
      baseUrl: "https://example.test/v1",
      apiKey: "secret",
      model: "example",
      fetch: vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "plain text" } }]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    });

    const result = await provider.runReport({
      role: "reviewer",
      system: "Return JSON.",
      user: "Review this.",
      maxOutputTokens: 1000
    });

    expect(result.report.status).toBe("FAILED");
    expect(result.report.summary).toMatch(/parse/);
  });

  it("normalizes token usage returned by OpenAI-compatible providers", async () => {
    const provider = new OpenAICompatibleProvider({
      name: "local",
      baseUrl: "https://example.test/v1",
      apiKey: "secret",
      model: "example",
      fetch: vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    status: "DONE",
                    summary: "ok",
                    findings: [],
                    next_actions: [],
                    omitted: []
                  })
                }
              }
            ],
            usage: {
              prompt_tokens: 1200,
              completion_tokens: 340,
              total_tokens: 1540
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    });

    const result = await provider.runReport({
      role: "reviewer",
      system: "Return JSON.",
      user: "Review this.",
      maxOutputTokens: 1000
    });

    expect(result.usage).toEqual({
      promptTokens: 1200,
      completionTokens: 340,
      totalTokens: 1540
    });
  });

  it("ignores invalid or absent usage without failing a valid report", async () => {
    const provider = new OpenAICompatibleProvider({
      name: "local",
      baseUrl: "https://example.test/v1",
      apiKey: "secret",
      model: "example",
      fetch: vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    status: "DONE",
                    summary: "ok",
                    findings: [],
                    next_actions: [],
                    omitted: []
                  })
                }
              }
            ],
            usage: {
              prompt_tokens: -1,
              completion_tokens: 2.5,
              total_tokens: "unknown"
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    });

    const result = await provider.runReport({
      role: "reviewer",
      system: "Return JSON.",
      user: "Review this.",
      maxOutputTokens: 1000
    });

    expect(result.report.status).toBe("DONE");
    expect(result.usage).toBeUndefined();
  });
});
