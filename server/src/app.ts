import Fastify, { type FastifyError, type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import { installAuth, safeUrl } from './middleware/auth.js';
import { loadEnv, type Env } from './config/env.js';
import { settingsSchema, type Settings } from './config/settings.js';
import { healthRoutes } from './routes/health.js';
import { createRequire } from 'node:module';

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
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ detail: 'Not found' }));
  app.setErrorHandler<FastifyError>((error, _request, reply) => {
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    reply.code(status).send({ detail: status === 500 ? 'Internal server error' : error.message });
  });
  return app;
}
