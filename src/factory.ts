import { ExternalSubagentsApp } from "./app.js";
import { DiskCache } from "./cache.js";
import { type NormalizedConfig, loadConfig } from "./config.js";
import { JobManager } from "./jobs.js";
import { OpenAICompatibleProvider } from "./provider.js";
import { createWorkspace } from "./workspace.js";

export function createAppFromConfig(config: NormalizedConfig, env: NodeJS.ProcessEnv = process.env): ExternalSubagentsApp {
  const providers = new Map(
    Object.entries(config.providers).map(([name, providerConfig]) => {
      const apiKey = env[providerConfig.api_key_env];
      if (!apiKey) {
        throw new Error(`Missing API key environment variable for provider "${name}": ${providerConfig.api_key_env}`);
      }
      return [
        name,
        new OpenAICompatibleProvider({
          name,
          baseUrl: providerConfig.base_url,
          apiKey,
          model: providerConfig.model,
          timeoutMs: providerConfig.timeout_ms
        })
      ] as const;
    })
  );

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
      roles: new Map(Object.entries(config.roles)),
      globalConcurrency: config.concurrency.global,
      perProviderConcurrency: config.concurrency.perProvider
    })
  });
}

export function createAppFromEnvironment(cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): ExternalSubagentsApp {
  return createAppFromConfig(loadConfig(cwd, env), env);
}
