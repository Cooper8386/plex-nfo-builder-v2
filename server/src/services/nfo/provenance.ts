import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const version = (createRequire(import.meta.url)('../../../package.json') as { version: string }).version;
export function withProvenance(body: string, sourceId: string, generatedAt = Math.floor(Date.now() / 1000)) {
  if (!/^[A-Za-z0-9._-]*$/.test(sourceId) || sourceId.includes('--')) throw new Error('Invalid provenance source ID');
  const hash = createHash('sha256').update(body).digest('hex');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<!-- plex-nfo-builder version=${version} generated_at=${generatedAt} tvdb_id=${sourceId} content_hash=sha256:${hash} -->\n${body}`;
}
export function readProvenance(text: string) {
  const match = /^<\?xml version="1.0" encoding="UTF-8" standalone="yes"\?>\n<!-- plex-nfo-builder version=([^ ]+) generated_at=(\d+) tvdb_id=([^ ]*) content_hash=sha256:([a-f0-9]{64}) -->\n/.exec(text);
  return match ? { version:match[1]!,generated_at:Number(match[2]),source_id:match[3]!,hash:match[4]!,body:text.slice(match[0].length) } : null;
}
