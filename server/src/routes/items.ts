import type { FastifyInstance } from 'fastify';
import type { ItemQuery, ItemsQuery, ItemsResponse, NfoExplanation } from 'shared';
import type { ScannerClient } from '../services/scanner/client.js';

export function itemRoutes(app: FastifyInstance, scanner: ScannerClient) {
  app.get<{ Querystring: ItemsQuery; Reply: ItemsResponse }>('/api/items', {
    schema: { querystring: { type: 'object', properties: {
      library: { type: 'string' }, status: { type: 'string' }, q: { type: 'string' }, hide_organized: { type: 'boolean' },
      poster_selection: { enum: ['all', 'needs_selection', 'selected'] },
    } } },
  }, async request => ({ items: await scanner.items(request.query) }));
  app.get<{ Querystring: ItemQuery; Reply: NfoExplanation }>('/api/items/nfo-explain', {
    schema: { querystring: { type: 'object', required: ['path'], properties: { path: { type: 'string', minLength: 1 } } } },
  }, async request => scanner.explain(request.query.path));
}
