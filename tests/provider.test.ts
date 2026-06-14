import { describe, expect, it, vi } from "vitest";
import { OpenAICompatibleProvider } from "../src/provider.js";

describe("OpenAICompatibleProvider", () => {
  it("normalizes OpenAI-compatible tool-calling turns", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: null,
              reasoning_content: "Need to inspect the file.",
              tool_calls: [{
                id: "call_1",
                type: "function",
                function: {
                  name: "read_file",
                  arguments: '{"path":"src/auth.ts"}'
                }
              }]
            }
          }],
          usage: { prompt_tokens: 90, completion_tokens: 30, total_tokens: 120 }
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

    const result = await provider.runToolTurn({
      messages: [{ role: "user", content: "Find auth flow" }],
      tools: [{
        type: "function",
        function: {
          name: "read_file",
          description: "Read one file",
          parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }
        }
      }],
      maxOutputTokens: 1000
    });

    expect(result.toolCalls).toEqual([{
      id: "call_1",
      name: "read_file",
      arguments: '{"path":"src/auth.ts"}'
    }]);
    expect(result.assistantMessage).toMatchObject({ role: "assistant", reasoning_content: "Need to inspect the file." });
    expect(result.finishReason).toBe("tool_calls");
    expect(result.usage?.totalTokens).toBe(120);
  });

  it("normalizes a final text tool-loop turn without tool calls", async () => {
    const provider = new OpenAICompatibleProvider({
      name: "local",
      baseUrl: "https://example.test/v1",
      apiKey: "secret",
      model: "example",
      fetch: vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [{
              finish_reason: "stop",
              message: { role: "assistant", content: '{"status":"DONE","summary":"Found it"}' }
            }]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    });

    const result = await provider.runToolTurn({
      messages: [{ role: "user", content: "Find auth flow" }],
      tools: [],
      maxOutputTokens: 1000
    });

    expect(result.text).toContain("Found it");
    expect(result.toolCalls).toEqual([]);
    expect(result.finishReason).toBe("stop");
  });

  it("preserves malformed tool arguments for explorer validation", async () => {
    const provider = new OpenAICompatibleProvider({
      name: "local",
      baseUrl: "https://example.test/v1",
      apiKey: "secret",
      model: "example",
      fetch: vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [{
              message: {
                role: "assistant",
                tool_calls: [{
                  id: "bad",
                  type: "function",
                  function: { name: "read_file", arguments: "{bad" }
                }]
              }
            }]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    });

    const result = await provider.runToolTurn({
      messages: [{ role: "user", content: "Read" }],
      tools: [],
      maxOutputTokens: 1000
    });

    expect(result.toolCalls[0]?.arguments).toBe("{bad");
  });

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
            choices: [{ message: { content: "ok" } }]
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

  it("recovers truncated provider output and exposes finish reason metadata", async () => {
    const provider = new OpenAICompatibleProvider({
      name: "local",
      baseUrl: "https://example.test/v1",
      apiKey: "secret",
      model: "example",
      fetch: vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [{
              finish_reason: "length",
              message: {
                content:
                  '{"status":"DONE_WITH_CONCERNS","summary":"One complete issue","findings":[' +
                  '{"severity":"high","title":"Complete","description":"Useful","recommendation":"Verify","confidence":0.9},' +
                  '{"severity":"low","title":"Cut'
              }
            }],
            usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    });

    const result = await provider.runReport({
      role: "reviewer",
      system: "Return JSON.",
      user: "Review this.",
      maxOutputTokens: 50
    });

    expect(result.report.status).toBe("DONE_WITH_CONCERNS");
    expect(result.report.findings[0]?.title).toBe("Complete");
    expect(result.recovery).toMatchObject({
      parseMode: "salvaged",
      outputTruncated: true
    });
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
