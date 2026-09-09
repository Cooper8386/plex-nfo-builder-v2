import { basename, extname } from 'node:path';
import { readdir } from 'node:fs/promises';
import type { Provider } from 'shared';
import { seasonNumber, videoPattern } from '../scanner/layout.js';
export { seasonNumber } from '../scanner/layout.js';

export function parseFolder(name: string) {
  const clean = name.replace(/\{edition-[^}]*\}/gi, '').trim();
  const id = /\{(tvdb|tmdb|imdb)-([^}]+)\}/i.exec(clean);
  const year = /\((\d{4})\)/.exec(clean);
  return { title: clean.replace(/\{(?:tvdb|tmdb|imdb)-[^}]+\}/gi, '').replace(/\(\d{4}\)/, '').trim(),
    year: year ? Number(year[1]) : null, provider: id ? id[1]!.toLowerCase() as Provider : null, external_id: id?.[2]?.trim() || null };
}
const cleanTitle = (value: string) => value.replace(/\[[^\]]*\]/g, '').replace(/\s+-\S+$|-[^\s-]+$/g, '').replace(/^[\s._-]+|[\s._-]+$/g, '').replace(/\./g, ' ') || null;
export function parseEpisode(path: string) {
  if (!videoPattern.test(path)) return null;
  const extension = extname(path).toLowerCase(), stem = basename(path, extname(path));
  const base = { path, extension, season: 0, episode: 0, end_episode: null as number | null, raw_title: null as string | null, air_date: null as string | null, parsed: false };
  const standard = /s(\d{1,2})e(\d{1,3})(?:[-e](\d{1,3}))?/i.exec(stem);
  if (standard) return { ...base, parsed: true, season: Number(standard[1]), episode: Number(standard[2]),
    end_episode: standard[3] ? Number(standard[3]) : null, raw_title: cleanTitle(stem.slice(standard.index + standard[0].length)) };
  const anime = /^\[[^\]]+\][^[]*?\s-\s(\d{1,4})(?:v\d+)?(?=\s|\[|$)/i.exec(stem);
  if (anime && Number(anime[1]) > 0 && Number(anime[1]) < 2000) return { ...base, parsed: true, season: 1, episode: Number(anime[1]) };
  const daily = /(?<!\d)(\d{4}-\d{2}-\d{2})(?!\d)/.exec(stem);
  if (daily) {
    const date = new Date(`${daily[1]}T00:00:00Z`);
    if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === daily[1]) return { ...base, parsed: true, air_date: daily[1]!, raw_title: cleanTitle(stem.slice(daily.index + daily[0].length)) };
  }
  return base;
}
export function parseMovie(path: string) {
  const stem = basename(path, extname(path));
  const parsed = parseFolder(stem.replace(/\[[^\]]*\]/g, ''));
  return { ...parsed, path, title: cleanTitle(parsed.title) ?? stem };
}
export async function isMovieFolder(folder: string) {
  const entries = await readdir(folder, { withFileTypes: true });
  if (entries.some(e => e.isDirectory() && seasonNumber(e.name) !== null)) return false;
  const videos = entries.filter(e => e.isFile() && videoPattern.test(e.name));
  return videos.length > 0 && !videos.some(e => parseEpisode(e.name)?.parsed);
}
