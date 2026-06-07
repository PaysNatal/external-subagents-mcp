import { ExternalSubagentsApp } from "./app.js";
import { DiskCache } from "./cache.js";
import { type NormalizedConfig, loadConfig } from "./config.js";
import { JobManager } from "./jobs.js";
import { OpenAICompatibleProvider } from "./provider.js";
import { createWorkspace } from "./workspace.js";

export function createAppFromConfig(config: NormalizedConfig, env: NodeJS.ProcessEnv = process.env): ExternalSubagentsApp {
  const providers = new Map<string, OpenAICompatibleProvider>();
  const missingProviderKeys = new Map<string, string>();

  for (const [name, providerConfig] of Object.entries(config.providers)) {
    const apiKey = env[providerConfig.api_key_env];
    if (!apiKey) {
      missingProviderKeys.set(name, providerConfig.api_key_env);
      continue;
    }
    providers.set(
      name,
      new OpenAICompatibleProvider({
        name,
        baseUrl: providerConfig.base_url,
        apiKey,
        model: providerConfig.model,
        timeoutMs: providerConfig.timeout_ms
      })
    );
  }

  return new ExternalSubagentsApp({
    config,
    workspace: createWorkspace(config),
    cache: new DiskCache({
      dir: config.cache.dir,
      ttlHours: config.cache.ttlHours,
      maxBytes: config.cache.maxBytes
    }),
    jobs: new JobManager({
      providers,
      missingProviderKeys,
      roles: new Map(Object.entries(config.roles)),
      routing: config.routing,
      globalConcurrency: config.concurrency.global,
      perProviderConcurrency: config.concurrency.perProvider
    })
  });
}

export function createAppFromEnvironment(cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): ExternalSubagentsApp {
  return createAppFromConfig(loadConfig(cwd, env), env);
}
