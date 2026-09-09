import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { realpath } from 'node:fs/promises';

export function configPaths(configDir: string) {
  const root = resolve(configDir);
  return {
    root, settings: join(root, 'settings.json'), libraries: join(root, 'libraries.json'),
    database: join(root, 'app.db'), logs: join(root, 'logs'), custom_artwork: join(root, 'custom-artwork'),
  };
}

export function isWithin(root: string, path: string) {
  const rel = relative(resolve(root), resolve(path));
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
}

export async function mediaPath(root: string, path: string) {
  const [base, target] = await Promise.all([realpath(root), realpath(resolve(root, path))]);
  if (!isWithin(base, target)) throw new Error('Path outside MEDIA_ROOT');
  return target;
}
