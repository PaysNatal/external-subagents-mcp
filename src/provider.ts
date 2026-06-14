import { failedReport, parseDelegateReportResult } from "./report.js";
import type {
  ProviderClient,
  ProviderConversationMessage,
  ProviderRunRequest,
  ProviderRunResult,
  ProviderToolCall,
  ProviderToolTurnRequest,
  ProviderToolTurnResult,
  ProviderUsage
} from "./types.js";

export interface ProviderOptions {
  name: string;
  baseUrl: string;
  chatCompletionsPath?: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

interface ChatCompletionsResponse {
  choices?: Array<{
    finish_reason?: unknown;
    message?: {
      role?: unknown;
      content?: string | null;
      tool_calls?: unknown;
      [key: string]: unknown;
    };
  }>;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
  };
}

export class OpenAICompatibleProvider implements ProviderClient {
  readonly name: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly chatCompletionsUrl: string;

  constructor(private readonly options: ProviderOptions) {
    this.name = options.name;
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 120000;
    this.chatCompletionsUrl = resolveChatCompletionsUrl(options.baseUrl, options.chatCompletionsPath);
  }

  async runReport(request: ProviderRunRequest): Promise<ProviderRunResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("Provider request timed out.")), this.timeoutMs);
    const signal = request.signal ? AbortSignal.any([request.signal, controller.signal]) : controller.signal;

    try {
      const response = await this.fetchImpl(new URL(this.chatCompletionsUrl), {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: this.options.model,
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.user }
          ],
          temperature: 0.1,
          max_tokens: request.maxOutputTokens
        }),
        signal
      });

      if (!response.ok) {
        return { report: failedReport(`Provider ${this.name} returned HTTP ${response.status}: ${await safeBody(response)}`) };
      }

      const data = (await response.json()) as ChatCompletionsResponse;
      const content = data.choices?.[0]?.message?.content;
      const finishReason = data.choices?.[0]?.finish_reason;
      if (!content) {
        return { report: failedReport(`Provider ${this.name} returned no message content.`), usage: normalizeUsage(data.usage) };
      }

      try {
        const parsed = parseDelegateReportResult(content, { outputTruncated: finishReason === "length" || finishReason === "max_tokens" });
        return { ...parsed, usage: normalizeUsage(data.usage) };
      } catch (error) {
        return {
          report: failedReport(
            `Provider ${this.name} returned output that could not be parsed as the delegate report JSON contract: ${
              error instanceof Error ? error.message : String(error)
            }`
          ),
          usage: normalizeUsage(data.usage)
        };
      }
    } catch (error) {
      return { report: failedReport(`Provider ${this.name} request failed: ${error instanceof Error ? error.message : String(error)}`) };
    } finally {
      clearTimeout(timeout);
    }
  }

  async runToolTurn(request: ProviderToolTurnRequest): Promise<ProviderToolTurnResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("Provider request timed out.")), this.timeoutMs);
    const signal = request.signal ? AbortSignal.any([request.signal, controller.signal]) : controller.signal;

    try {
      const response = await this.fetchImpl(new URL(this.chatCompletionsUrl), {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: this.options.model,
          messages: request.messages,
          tools: request.tools,
          tool_choice: "auto",
          temperature: 0.1,
          max_tokens: request.maxOutputTokens
        }),
        signal
      });

      if (!response.ok) {
        throw new Error(`Provider ${this.name} returned HTTP ${response.status}: ${await safeBody(response)}`);
      }

      const data = (await response.json()) as ChatCompletionsResponse;
      const rawMessage = data.choices?.[0]?.message;
      if (!rawMessage) {
        throw new Error(`Provider ${this.name} returned no assistant message.`);
      }
      const assistantMessage = normalizeAssistantMessage(rawMessage);
      const text = typeof rawMessage.content === "string" ? rawMessage.content : undefined;
      const finishReason = typeof data.choices?.[0]?.finish_reason === "string" ? data.choices[0].finish_reason : undefined;

      return {
        assistantMessage,
        text,
        toolCalls: normalizeToolCalls(rawMessage.tool_calls),
        usage: normalizeUsage(data.usage),
        finishReason
      };
    } catch (error) {
      throw new Error(`Provider ${this.name} tool turn failed: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

function normalizeAssistantMessage(raw: NonNullable<NonNullable<ChatCompletionsResponse["choices"]>[number]["message"]>): ProviderConversationMessage {
  return {
    ...raw,
    role: "assistant",
    content: typeof raw.content === "string" || raw.content === null ? raw.content : null
  };
}

function normalizeToolCalls(raw: unknown): ProviderToolCall[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap(value => {
    if (!isRecord(value) || !isRecord(value.function)) {
      return [];
    }
    const id = typeof value.id === "string" ? value.id : undefined;
    const name = typeof value.function.name === "string" ? value.function.name : undefined;
    const args = typeof value.function.arguments === "string" ? value.function.arguments : undefined;
    return id && name && args !== undefined ? [{ id, name, arguments: args }] : [];
  });
}

function normalizeUsage(raw: ChatCompletionsResponse["usage"]): ProviderUsage | undefined {
  if (!raw) {
    return undefined;
  }
  const usage: ProviderUsage = {
    promptTokens: validTokenCount(raw.prompt_tokens),
    completionTokens: validTokenCount(raw.completion_tokens),
    totalTokens: validTokenCount(raw.total_tokens)
  };
  return Object.values(usage).some(value => value !== undefined) ? usage : undefined;
}

function validTokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

export function resolveChatCompletionsUrl(baseUrl: string, chatCompletionsPath = "chat/completions"): string {
  const endpointPath = stripSlashes(chatCompletionsPath);
  const parsed = new URL(baseUrl);
  const basePath = stripTrailingSlash(parsed.pathname);

  if (endpointPath && (basePath === `/${endpointPath}` || basePath.endsWith(`/${endpointPath}`))) {
    parsed.pathname = basePath;
    return parsed.toString();
  }

  return new URL(endpointPath, ensureTrailingSlash(baseUrl)).toString();
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

function stripSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/g, "") || "/";
}

async function safeBody(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 1000);
  } catch {
    return "";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
