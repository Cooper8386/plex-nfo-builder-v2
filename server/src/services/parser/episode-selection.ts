import type { Episode } from '../providers/normalized.js';
import type { Sidecar } from '../sidecar/format.js';
import { parseEpisode } from './parser.js';

export function selectEpisode(
  filename: string,
  relativeFile: string,
  episodes: Episode[],
  fileOverrides: Sidecar['episode_file_overrides'] = [],
  episodeOverrides: Sidecar['episode_overrides'] = [],
): Episode | undefined {
  const override = fileOverrides.find(value => value.file_path === relativeFile);
  if (override?.external_id) return episodes.find(episode => episode.id === override.external_id);
  const parsed = parseEpisode(filename);
  if (parsed?.air_date && override?.season == null && override?.episode == null) {
    return episodes.find(episode => episode.aired === parsed.air_date);
  }
  const numbered = parsed?.parsed && !parsed.air_date ? parsed : undefined;
  const season = override?.season ?? numbered?.season, number = override?.episode ?? numbered?.episode;
  if (season === undefined || number === undefined) return undefined;
  const legacy = episodeOverrides.find(value => value.season === season && value.episode === number);
  return legacy ? episodes.find(episode => episode.id === legacy.tvdb_episode_id) :
    episodes.find(episode => episode.season === season && episode.episode === number);
}
