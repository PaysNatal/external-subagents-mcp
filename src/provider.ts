import { failedReport, parseDelegateReport } from "./report.js";
import type { DelegateReport, ProviderClient, ProviderRunRequest } from "./types.js";

export interface ProviderOptions {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

interface ChatCompletionsResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
}

export class OpenAICompatibleProvider implements ProviderClient {
  readonly name: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: ProviderOptions) {
    this.name = options.name;
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 120000;
  }

  async runReport(request: ProviderRunRequest): Promise<DelegateReport> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("Provider request timed out.")), this.timeoutMs);
    const signal = request.signal ? AbortSignal.any([request.signal, controller.signal]) : controller.signal;

    try {
      const response = await this.fetchImpl(new URL("chat/completions", ensureTrailingSlash(this.options.baseUrl)), {
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
        return failedReport(`Provider ${this.name} returned HTTP ${response.status}: ${await safeBody(response)}`);
      }

      const data = (await response.json()) as ChatCompletionsResponse;
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        return failedReport(`Provider ${this.name} returned no message content.`);
      }

      try {
        return parseDelegateReport(content);
      } catch (error) {
        return failedReport(
          `Provider ${this.name} returned output that could not be parsed as the delegate report JSON contract: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    } catch (error) {
      return failedReport(`Provider ${this.name} request failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

async function safeBody(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 1000);
  } catch {
    return "";
  }
}
