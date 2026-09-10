import { readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { parseEpisode } from '../parser/parser.js';
import { mediaFolders, videoPattern } from '../scanner/layout.js';
import type { Sidecar } from '../sidecar/format.js';

export function seasonSlot(season: number): string {
  return `season-${String(season).padStart(2, '0')}-poster`;
}

export function selectSeasonPosters(selections: Sidecar['artwork_selections']): Record<string, string> {
  return Object.fromEntries(selections.filter(selection => /^season-\d{2}-poster$/.test(selection.slot))
    .map(selection => [selection.slot, selection.url]));
}

export async function seasonPosterProgress(
  folder: string,
  selections: Sidecar['artwork_selections'],
  fileOverrides: Sidecar['episode_file_overrides'] = [],
): Promise<{
  state: 'not_started' | 'in_progress' | 'selected' | 'not_applicable';
  required_seasons: number[];
  selected_seasons: number[];
  missing_seasons: number[];
  unresolved_files: string[];
}> {
  const overrides = new Map(fileOverrides.map(override => [override.file_path, override.season]));
  const required = new Set<number>();
  const unresolved_files: string[] = [];
  for (const directory of await mediaFolders(folder)) {
    for (const entry of await readdir(directory.path, { withFileTypes: true })) {
      if (!entry.isFile() || !videoPattern.test(entry.name)) continue;
      const path = relative(folder, join(directory.path, entry.name)).split(sep).join('/');
      const parsed = parseEpisode(entry.name);
      const season = overrides.get(path) ?? directory.season ??
        (parsed?.parsed && !parsed.air_date ? parsed.season : null);
      if (season === null) unresolved_files.push(path);
      else required.add(season);
    }
  }
  const saved = selectSeasonPosters(selections);
  const required_seasons = [...required].sort((a, b) => a - b);
  const selected_seasons = required_seasons.filter(season => saved[seasonSlot(season)] !== undefined);
  const missing_seasons = required_seasons.filter(season => saved[seasonSlot(season)] === undefined);
  const state = !required.size && !unresolved_files.length ? 'not_applicable' :
    !missing_seasons.length && !unresolved_files.length ? 'selected' :
      Object.keys(saved).length ? 'in_progress' : 'not_started';
  return { state, required_seasons, selected_seasons, missing_seasons, unresolved_files: unresolved_files.sort() };
}
