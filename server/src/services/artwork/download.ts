import { randomUUID } from 'node:crypto';
import { open, rename, unlink, realpath } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import { Readable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';
import { responseStream, ProviderError, retryDelay } from '../providers/http.js';

export const maxArtworkBytes = 50 * 1024 * 1024;
// Stream into an exclusive sibling; neither a partial response nor an old symlink becomes the destination.
export async function writeArtwork(path: string, source: AsyncIterable<Uint8Array>, limit = maxArtworkBytes) {
  const directory = await realpath(dirname(path));
  const destination = join(directory, basename(path)), part = join(directory, `.${basename(path)}.${randomUUID()}.part`);
  const file = await open(part, 'wx', 0o600);
  try {
    let size = 0;
    for await (const chunk of source) {
      size += chunk.byteLength;
      if (size > limit) throw new Error('Artwork too large');
      // FileHandle.write can perform a short write.
      let offset = 0;
      while (offset < chunk.byteLength) {
        const result = await file.write(chunk, offset, chunk.byteLength - offset);
        if (!result.bytesWritten) throw new Error('Artwork write failed');
        offset += result.bytesWritten;
      }
    }
    if (!size) throw new Error('Artwork validation: Empty image');
    await file.sync(); await file.close(); await rename(part, destination);
  } finally { await file.close().catch(()=>{}); await unlink(part).catch(()=>{}); }
}
export async function downloadArtwork(url: string, path: string) {
  const response = await artworkResponse(url);
  if ((response.statusCode ?? 502) < 200 || (response.statusCode ?? 502) >= 300) {response.destroy();throw new ProviderError(response.statusCode ?? 502);}
  const type = response.headers['content-type']?.split(';')[0];
  if (type && !['image/jpeg','image/png','image/webp','image/gif','application/octet-stream'].includes(type)) {response.destroy();throw new Error('Artwork validation: Unsupported image type');}
  try { await writeArtwork(path,response); } finally {response.destroy();}
}
async function artworkResponse(url: string) {
  for (let attempt=0;attempt<3;attempt++) {
    let response;
    try {response=await responseStream(url);} catch(error) {
      if (attempt===2 || error instanceof Error && error.message.startsWith('Unsafe URL')) throw error;
      await sleep(retryDelay(undefined,attempt));continue;
    }
    if (attempt<2 && (response.statusCode===429 || (response.statusCode??502)>=500)) {
      response.destroy();await sleep(retryDelay(response.headers['retry-after'],attempt));continue;
    }
    return response;
  }
  throw new Error('Provider request failed');
}
export const saveArtwork = (path: string, data: Buffer) => writeArtwork(path, Readable.from([data]));
