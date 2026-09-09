import Fastify, { type FastifyError, type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import { installAuth, safeUrl } from './middleware/auth.js';
import { loadEnv, type Env } from './config/env.js';
import { settingsSchema, type Settings } from './config/settings.js';
import { healthRoutes } from './routes/health.js';
import { createRequire } from 'node:module';
import { ScannerClient } from './services/scanner/client.js';
import { libraryRoutes } from './routes/libraries.js';
import { itemRoutes } from './routes/items.js';
import { MatcherClient } from './services/matcher/client.js';
import { matchRoutes } from './routes/match.js';

const pkg = createRequire(import.meta.url)('../package.json') as { version: string };

export function createApp(options: { env?: Env; logger?: FastifyServerOptions['logger']; settings?: () => Settings } = {}) {
  const env = options.env ?? loadEnv();
  const app = Fastify({
    logger: options.logger === false ? false : {
      level: env.log_level.toLowerCase().replace('warning', 'warn'),
      ...(typeof options.logger === 'object' ? options.logger : {}),
      serializers: { req: req => ({ method: req.method, url: safeUrl(req.url), hostname: req.hostname, remoteAddress: req.ip }) },
      redact: ['req.headers.authorization', 'req.headers.x-api-token'],
    },
  });
  installAuth(app, env.api_token);
  if (env.trusted_hosts.length) app.addHook('onRequest', async (request, reply) => {
    if (!env.trusted_hosts.includes(request.hostname.toLowerCase())) return reply.code(400).send({ detail: 'Invalid Host header' });
  });
  if (env.cors_allow_origins.length) app.register(cors, { origin: env.cors_allow_origins });
  healthRoutes(app, env, options.settings ?? (() => settingsSchema.parse({})), pkg.version);
  const scanner = new ScannerClient(env, options.settings ?? (() => settingsSchema.parse({})));
  libraryRoutes(app, scanner);
  itemRoutes(app, scanner);
  const matcher = new MatcherClient(env, options.settings ?? (() => settingsSchema.parse({})));
  matchRoutes(app, matcher);
  app.addHook('onClose', () => matcher.close());
  app.addHook('onClose', () => scanner.close());
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ detail: 'Not found' }));
  app.setErrorHandler<FastifyError>((error, _request, reply) => {
    const status = error.validation ? 422 : error.message === 'Path outside MEDIA_ROOT' || error.message.startsWith('Match validation:') ? 400 : error.message.startsWith('Provider returned HTTP') ? 502 : error.message === 'Library not found' || error.message.includes('ENOENT:') ? 404 : error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    reply.code(status).send({ detail: status === 500 ? 'Internal server error' : error.message });
  });
  return Object.assign(app, { scanner, matcher });
}
