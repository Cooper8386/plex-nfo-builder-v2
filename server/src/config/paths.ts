import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathBoundary } from '../middleware/path-boundary.js';

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
  return pathBoundary(root,path);
}
