import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const layouts = {
  'season-tv': ['Show/Season 01/Show.S01E01.mkv', 'Show/Season 01/Show.S01E02.mp4'],
  'root-tv': ['Anime/Anime.S01E01.mkv', 'Anime/Anime.S01E02.mkv'],
  movie: ['Movie (2020)/Movie (2020).mkv'],
  foreign: ['Foreign/Season 01/Foreign.S01E01.mkv', 'Foreign/tvshow.nfo', 'Foreign/Season 01/Foreign.S01E01.nfo'],
} as const;

export async function writeTree(root: string, files: Record<string, string>) {
  for (const [name, contents] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents);
  }
}

export async function mediaTree(root: string, layout: keyof typeof layouts) {
  const files = layouts[layout];
  await writeTree(root, Object.fromEntries(files.map(path => [path, path.endsWith('.nfo') ? '<tvshow><title>Foreign</title></tvshow>' : 'fixture video'])));
  return files.map(path => join(root, path));
}
