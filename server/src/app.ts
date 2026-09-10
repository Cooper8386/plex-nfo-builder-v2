import Fastify, { type FastifyError, type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import { installAuth, safeUrl } from './middleware/auth.js';
import { loadEnv, type Env } from './config/env.js';
import { SettingsStore,settingsSchema, type Settings } from './config/settings.js';
import { configPaths } from './config/paths.js';
import { healthRoutes } from './routes/health.js';
import { createRequire } from 'node:module';
import { ScannerClient } from './services/scanner/client.js';
import { libraryRoutes } from './routes/libraries.js';
import { itemRoutes } from './routes/items.js';
import { MatcherClient } from './services/matcher/client.js';
import { matchRoutes } from './routes/match.js';
import { overrideRoutes } from './routes/overrides.js';
import { artworkRoutes } from './routes/artwork.js';
import { BuilderClient } from './services/builder/client.js';
import { buildRoutes } from './routes/build.js';
import { dangerRoutes } from './routes/danger.js';
import { renameRoutes } from './routes/rename.js';
import { Watcher } from './services/watcher/watcher.js';
import { watcherRoutes } from './routes/watcher.js';
import { Scheduler } from './services/scheduler/scheduler.js';
import { scheduleRoutes } from './routes/schedules.js';
import { installHostAllowlist } from './middleware/host-allowlist.js';
import { ApiClient } from './services/api/client.js';
import { apiRoutes } from './routes/api.js';
import { ZodError } from 'zod';
import { fileURLToPath } from 'node:url';
import { spaRoutes } from './routes/spa.js';

const pkg = createRequire(import.meta.url)('../package.json') as { version: string };

export function createApp(options: { env?: Env; logger?: FastifyServerOptions['logger']; settings?: () => Settings;spaRoot?:string } = {}) {
  const env = options.env ?? loadEnv();
  let loadedSettings:Settings|undefined;
  const settings=()=>loadedSettings??options.settings?.()??settingsSchema.parse({});
  const store=new SettingsStore(configPaths(env.config_dir).settings);
  const app = Fastify({
    logger: options.logger === false ? false : {
      level: env.log_level.toLowerCase().replace('warning', 'warn'),
      ...(typeof options.logger === 'object' ? options.logger : {}),
      serializers: { req: req => ({ method: req.method, url: safeUrl(req.url), hostname: req.hostname, remoteAddress: req.ip }) },
      redact: ['req.headers.authorization', 'req.headers.x-api-token'],
    },
  });
  installAuth(app, env.api_token);
  installHostAllowlist(app,env.trusted_hosts);
  if (env.cors_allow_origins.length) app.register(cors, { origin: env.cors_allow_origins });
  healthRoutes(app, env, settings, pkg.version);
  const scanner = new ScannerClient(env, settings,()=>{void watcher?.reload().catch(()=>app.log.error('Watcher reload failed'));});
  libraryRoutes(app, scanner);
  itemRoutes(app, scanner);
  const matcher = new MatcherClient(env, settings);
  matchRoutes(app, matcher);
  overrideRoutes(app, matcher);
  artworkRoutes(app, matcher);
  dangerRoutes(app,matcher,()=>watcher.reload());
  renameRoutes(app,matcher);
  const builder=new BuilderClient(env,settings);
  buildRoutes(app,builder);
  const watcher=new Watcher(env,settings,scanner,matcher,builder);
  const saveSettings=async(patch:Partial<Settings>)=>{loadedSettings=await store.save(patch);};
  watcherRoutes(app,watcher,enabled=>saveSettings({watcher_enabled:enabled}),matcher);
  const scheduler=new Scheduler(env,builder);scheduleRoutes(app,scheduler);
  const api=new ApiClient(env,settings);apiRoutes(app,api,matcher,scanner,builder,watcher,env,settings,saveSettings,pkg.version);
  spaRoutes(app,options.spaRoot??fileURLToPath(new URL('../../client/dist/',import.meta.url)));
  app.addHook('onClose',async()=>{await scheduler.close();await watcher.close();await api.close();await builder.close();await matcher.close();await scanner.close();});
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ detail: 'Not found' }));
  app.setErrorHandler<FastifyError>((error, _request, reply) => {
    if(error instanceof ZodError)return reply.code(422).send({detail:'Invalid settings or request values'});
    if(error.message.startsWith('API validation:'))return reply.code(400).send({detail:error.message});
    const status = error.validation ? 422 : error.message === 'Artwork too large' ? 413 : error.message === 'Path outside MEDIA_ROOT' || error.message.startsWith('Match validation:') || error.message.startsWith('NFO validation:') || error.message.startsWith('Artwork validation:') || error.message.startsWith('Build validation:') || error.message.startsWith('Schedule validation:') || error.message.startsWith('Watcher validation:') || error.message.startsWith('Rename validation:') || error.message.startsWith('Danger validation:') || error.message.startsWith('Unsafe URL') ? 400 : error.message.startsWith('Provider returned HTTP') ? 502 : error.message === 'Schedule not found' || error.message === 'Library not found' || error.message === 'Artwork file not found' || error.message.includes('ENOENT:') ? 404 : error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    reply.code(status).send({ detail: status === 500 ? 'Internal server error' : error.message });
  });
  return Object.assign(app, { scanner, matcher, builder,watcher,scheduler,settings,saveSettings,loadSettings:async()=>{loadedSettings=await store.load();} });
}
