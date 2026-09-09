import type { ItemKind } from 'shared';
import { apiUrl, ProviderHttp } from './http.js';
import { row, rows, str, num, yearOf, type Row, type Artwork, type Metadata, type SearchResult, type Cast, type Episode } from './normalized.js';
const image = (v: unknown) => str(v) ? `https://image.tmdb.org/t/p/original${str(v)}` : null;
const kindPath = (kind: ItemKind) => kind === 'series' ? 'tv' : 'movie';
export function tmdbCast(value: unknown): Cast[] {
  return rows(value).map((r, i) => ({ id: str(r.id), name: str(r.name), character: str(r.character), character_type: 'actor', order: num(r.order) ?? i, image: image(r.profile_path) })).sort((a,b) => a.order - b.order);
}
function artwork(value: unknown, season: number | null = null): Artwork[] {
  const data = row(value);
  return Object.entries({ posters: 'poster', backdrops: 'background', logos: 'clearlogo', stills: 'thumb' }).flatMap(([key, slot]) => rows(data[key]).map(r => ({
    provider: 'tmdb' as const, id: str(r.file_path), slot, url: image(r.file_path)!, thumb: image(r.file_path), language: str(r.iso_639_1) || null,
    score: num(r.vote_average) ?? 0, width: num(r.width), height: num(r.height), season,
  })).filter(a => a.url));
}
function result(r: Row, kind: ItemKind): SearchResult { return { provider: 'tmdb', id: str(r.id), kind, title: str(r.name ?? r.title), year: yearOf(r.first_air_date ?? r.release_date), plot: str(r.overview), image: image(r.poster_path) }; }
function episode(r: Row): Episode { return { id: str(r.id), season: num(r.season_number) ?? 0, episode: num(r.episode_number) ?? 0, title: str(r.name), plot: str(r.overview), aired: str(r.air_date) || null, runtime: num(r.runtime), image: image(r.still_path) }; }
export class TmdbClient {
  constructor(private http: ProviderHttp, private key: string, private base = 'https://api.themoviedb.org/3') {}
  private get(path: string, query: Record<string, string | number | undefined> = {}, force = false) {
    if (!this.key) throw new Error('TMDB API key is not configured');
    return this.http.json(apiUrl(this.base, path, { ...query, api_key: this.key }), { force });
  }
  async search(kind: ItemKind, title: string, year?: number, language?: string) {
    const data = row(await this.get(`/search/${kindPath(kind)}`, { query: title, [kind === 'series' ? 'first_air_date_year' : 'year']: year, language }));
    return rows(data.results).map(r => result(r, kind));
  }
  async findImdb(id: string, kind: ItemKind) {
    const data = row(await this.get(`/find/${encodeURIComponent(id)}`, { external_source: 'imdb_id' }));
    return rows(data[kind === 'series' ? 'tv_results' : 'movie_results']).map(r => result(r, kind));
  }
  async details(kind: ItemKind, id: string, options: { force?: boolean; language?: string } = {}): Promise<Metadata> {
    const root = `/${kindPath(kind)}/${encodeURIComponent(id)}`;
    const data = row(await this.get(root, { append_to_response: 'credits,images,external_ids', language: options.language }, options.force));
    const ids = row(data.external_ids), seasons = [], episodes: Episode[] = [], art = artwork(data.images);
    if (kind === 'series') for (const season of rows(data.seasons)) {
      const number = num(season.season_number) ?? 0;
      const detail = row(await this.get(`${root}/season/${number}`, { append_to_response: 'images', language: options.language }, options.force));
      const seasonArt = artwork(detail.images, number);
      if (!seasonArt.length && season.poster_path) seasonArt.push(...artwork({ posters: [{ file_path: season.poster_path }] }, number));
      seasons.push({ id: str(season.id), season: number, title: str(detail.name ?? season.name), plot: str(detail.overview ?? season.overview), artwork: seasonArt });
      episodes.push(...rows(detail.episodes).map(episode)); art.push(...seasonArt);
    }
    for (const [field, slot] of [['poster_path','poster'],['backdrop_path','background']]) if (data[field!] && !art.some(a => a.slot === slot && a.season === null)) art.push({ provider: 'tmdb', id: str(data[field!]), slot: slot!, url: image(data[field!])!, thumb: image(data[field!]), language: null, score: 0, width: null, height: null, season: null });
    return { ...result(data, kind), id, original_title: str(data.original_name ?? data.original_title), sort_title: str(data.name ?? data.title), tagline: str(data.tagline),
      runtime: num(data.runtime) ?? (Array.isArray(data.episode_run_time) ? num(data.episode_run_time[0]) : null), aired: str(data.first_air_date ?? data.release_date) || null,
      genres: rows(data.genres).map(r => str(r.name)), studios: rows(data.production_companies).map(r => str(r.name)), rating: num(data.vote_average), content_rating: '', status: str(data.status),
      ids: { tmdb: id, ...(ids.tvdb_id ? { tvdb: str(ids.tvdb_id) } : {}), ...(ids.imdb_id ?? data.imdb_id ? { imdb: str(ids.imdb_id ?? data.imdb_id) } : {}) },
      cast: tmdbCast(row(data.credits).cast), episodes, seasons, artwork: art };
  }
}
