import { failedReport, parseDelegateReportResult } from "./report.js";
import type { ProviderClient, ProviderRunRequest, ProviderRunResult, ProviderUsage } from "./types.js";

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
      content?: string | null;
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
