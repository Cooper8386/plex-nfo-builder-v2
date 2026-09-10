import type { BuildRequest } from 'shared';
import type { Env } from '../../src/config/env.js';
import type { Settings } from '../../src/config/settings.js';
import { openDatabase } from '../../src/db/connection.js';
import type { StoredJob } from '../../src/queue/jobs-table.js';
import { buildItem } from '../../src/services/builder/builder.js';
import { saveArtwork } from '../../src/services/artwork/download.js';

// Test-only module: the fixture key carries the local canned provider's address over IPC.
export async function handle(job: StoredJob & { context: { env: Env; settings: Settings } }) {
  const { env, settings } = job.context;
  const db = await openDatabase(env.config_dir);
  try {
    return await buildItem(db, env, settings, job.payload as BuildRequest, {
      send: async (url, options) => {
        const response = await fetch(new URL(new URL(url).pathname, env.tmdb_api_key!), options);
        return { status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) };
      },
      download: (url, path) => saveArtwork(path, Buffer.from(url)),
    });
  } finally { db.close(); }
}
