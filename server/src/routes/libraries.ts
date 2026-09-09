import type { FastifyInstance } from 'fastify';
import type { DetectLibrariesResponse, LibrariesResponse, LibraryParams, UpdateLibraryRequest, UpdateLibraryResponse } from 'shared';
import type { ScannerClient } from '../services/scanner/client.js';

export function libraryRoutes(app: FastifyInstance, scanner: ScannerClient) {
  app.get<{ Reply: LibrariesResponse }>('/api/libraries', async () => ({ libraries: await scanner.libraries() }));
  app.post<{ Reply: DetectLibrariesResponse }>('/api/libraries/detect', async () => ({ libraries: await scanner.detect() }));
  app.post<{ Params: LibraryParams; Body: UpdateLibraryRequest; Reply: UpdateLibraryResponse }>('/api/libraries/:name', {
    schema: { body: { type: 'object', additionalProperties: false, properties: {
      kind: { type: 'string', enum: ['tv', 'movies', 'mixed'] }, enabled: { type: 'boolean' }, metadata_source: { anyOf: [{ type: 'string', enum: ['tvdb', 'tmdb'] }, { type: 'null' }] },
    } } },
  }, async request => scanner.update(request.params.name, request.body));
}
