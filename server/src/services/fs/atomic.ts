import { randomUUID } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';

export async function atomicWrite(path: string, content: string) {
  const temp = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  const file = await open(temp, 'wx', 0o600);
  try {
    try {
      await file.writeFile(content, 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temp, path);
  } finally {
    await unlink(temp).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}
