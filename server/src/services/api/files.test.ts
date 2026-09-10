import { mkdir, open, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { withSandbox } from '../../../tests/support/sandbox.js';
import { browse, appLog, jobLog } from './files.js';

test('browse returns canonical paths, directory-first ordering, parent and file sizes', async () => withSandbox(async box => {
  await mkdir(join(box.media, 'zDirectory')); await mkdir(join(box.media, 'ADirectory'));
  await writeFile(join(box.media, 'z.txt'), 'last'); await writeFile(join(box.media, 'A.txt'), 'first'); await writeFile(join(box.media, '.hidden'), 'hidden');
  const result = await browse(box.media);
  expect(result.path).toBe(box.media); expect(result.parent).toBeNull();
  expect(result.items.map(item => item.name)).toEqual(['ADirectory', 'zDirectory', 'A.txt', 'z.txt']);
  expect(result.items[0]).toMatchObject({ is_dir: true, size: null }); expect(result.items[2]).toMatchObject({ is_dir: false, size: 5 });
  expect(await browse(box.media, 'A.txt')).toEqual({ path: join(box.media, 'A.txt'), parent: box.media, items: [] });
  expect((await browse(box.media, 'ADirectory')).parent).toBe(box.media);
  await expect(browse(box.media, 'missing')).rejects.toMatchObject({ code: 'ENOENT' });
}));

test('browse refuses escapes and skips symlink entries', async () => withSandbox(async box => {
  await symlink(box.config, join(box.media, 'outside'), process.platform === 'win32' ? 'junction' : 'dir');
  await mkdir(join(box.media, 'real')); await symlink(join(box.media, 'real'), join(box.media, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
  expect((await browse(box.media)).items.map(item => item.name)).toEqual(['real']);
  await expect(browse(box.media, box.config)).rejects.toThrow('Path outside MEDIA_ROOT');
  await expect(browse(box.media, 'outside')).rejects.toThrow('Path outside MEDIA_ROOT');
}));

test('app log reads only the requested tail of a large sparse file and redacts credentials', async () => withSandbox(async box => {
  expect(await appLog(box.config)).toEqual({ lines: [] }); await mkdir(join(box.config, 'logs'));
  const file = await open(join(box.config, 'logs/app.log'), 'w');
  try { await file.write(Buffer.from('\nold\nfirst\r\n?api_token=secret&ok=1\nX-API-Token: secret-two\nAuthorization: Bearer secret-three\n'), 0, undefined, 128 * 1024 * 1024); }
  finally { await file.close(); }
  expect(await appLog(box.config, 3)).toEqual({ lines: ['?api_token=[REDACTED]&ok=1', 'X-API-Token: [REDACTED]', 'Authorization: Bearer [REDACTED]'] });
  expect(await appLog(box.config, 0)).toEqual({ lines: [] });
  await writeFile(join(box.config, 'logs/app.log'), Array.from({ length: 10002 }, (_, index) => String(index)).join('\n'));
  const tail = await appLog(box.config, 100000); expect(tail.lines).toHaveLength(10000); expect(tail.lines[0]).toBe('2');
}));

test('job log validates UUIDs, preserves text, and refuses symlinks', async () => withSandbox(async box => {
  await mkdir(join(box.config, 'logs/jobs'), { recursive: true }); const id = randomUUID();
  await writeFile(join(box.config, 'logs/jobs', `${id}.log`), 'Started\nCompleted\n');
  expect(await jobLog(box.config, id)).toBe('Started\nCompleted\n');
  await writeFile(join(box.config, 'logs/jobs', `${id}.log`), '{"x-api-token":"secret with spaces"}\n');
  expect(await jobLog(box.config, id)).toBe('{"x-api-token":"[REDACTED]"}\n');
  await expect(jobLog(box.config, '../../settings')).rejects.toThrow(/job.*id/i);
  await expect(jobLog(box.config, randomUUID())).rejects.toMatchObject({ code: 'ENOENT' });
  const linkId = randomUUID(); await symlink(box.media, join(box.config, 'logs/jobs', `${linkId}.log`), process.platform === 'win32' ? 'junction' : 'dir');
  await expect(jobLog(box.config, linkId)).rejects.toThrow(/regular file/i);
}));
