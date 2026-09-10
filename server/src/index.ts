import { pathToFileURL } from 'node:url';
import { createApp } from './app.js';
import { loadEnv, type Env } from './config/env.js';
import { configPaths } from './config/paths.js';
import { SettingsStore, settingsSchema } from './config/settings.js';

export async function startServer(env: Env = loadEnv(), startup?: () => Promise<void>) {
  let settings = settingsSchema.parse({});
  const app = createApp({ env, settings: () => settings });
  await app.listen({ host: env.listen_host, port: env.listen_port });
  // Startup is deliberately scheduled only after listen resolves. Never stat the media root here.
  setImmediate(() => {
    void (async () => {
      const store = new SettingsStore(configPaths(env.config_dir).settings, message => app.log.error(message));
      settings = await store.load();
      void app.builder.start().catch(()=>app.log.error('Build queue startup failed; listener remains available.'));
      void app.scanner.detect().then(async libraries => {
        for (const library of libraries) if (library.enabled) await app.scanner.scan(library.name);
      }).catch(() => app.log.error('Startup library scan failed; check the media mount.'));
      await startup?.();
    })().catch(() => app.log.error('Startup failed; check configuration. Listener remains available.'));
  });
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().then(app => {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close(); });
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
