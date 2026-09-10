import type { ItemKind } from 'shared';
import { apiUrl, ProviderError, ProviderHttp } from './http.js';
import { row, rows, str, num, yearOf, type Metadata, type SearchResult, type Cast, type Artwork, type Row } from './normalized.js';
const typePath = (kind: ItemKind) => kind === 'series' ? 'series' : 'movies';
export function tvdbCast(value: unknown): Cast[] { return rows(value).map((r,i) => ({ id: str(r.peopleId ?? r.personId ?? r.id), name: str(r.personName), character: str(r.name), character_type: str(r.peopleType ?? r.type), order: num(r.sort) ?? i, image: str(r.personImgURL) || null })).sort((a,b) => a.order - b.order); }
function artwork(value: unknown, season: number | null = null): Artwork[] {
  const slots: Record<string,string> = { '1': 'banner', '2': 'poster', '3': 'background', '6': 'poster', '7': 'banner', '8': 'thumb', '14': 'poster', '15': 'background', '18': 'clearlogo', '19': 'clearlogo', '20': 'clearart', '21': 'clearart' };
  return rows(value).filter(r => r.image && slots[str(r.type)]).map(r => ({ provider: 'tvdb', id: str(r.id), slot: slots[str(r.type)]!, url: str(r.image), thumb: str(r.thumbnail) || null, language: str(r.language) || null, score: num(r.score) ?? 0, width: num(r.width), height: num(r.height), season }));
}
function result(r: Row, kind: ItemKind): SearchResult { return { provider: 'tvdb', id: str(r.tvdb_id ?? r.id).replace(/^(series|movie)-/, ''), kind, title: str(r.name), year: yearOf(r.year ?? r.firstAired), plot: str(r.overview), image: str(r.image_url ?? r.image) || null }; }
export class TvdbClient {
  private token = ''; private expires = 0; private loginPending?: Promise<string>;
  constructor(private http: ProviderHttp, private key: string, private pin?: string, private base = 'https://api4.thetvdb.com/v4') {}
  private async login() {
    if (this.token && Date.now() < this.expires) return this.token;
    if (!this.loginPending) this.loginPending = (async () => {
      if (!this.key) throw new Error('TVDB API key is not configured');
      const data = row(await this.http.json(apiUrl(this.base, '/login'), { method: 'POST', cache: false, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apikey: this.key, ...(this.pin ? { pin: this.pin } : {}) }) }));
      this.token = str(row(data.data).token); if (!this.token) throw new Error('TVDB login returned no token');
      this.expires = Date.now() + 23 * 3600_000; return this.token;
    })().finally(() => { this.loginPending = undefined; });
    return this.loginPending;
  }
  private async get(path: string, query: Record<string, string | number | undefined> = {}, force = false): Promise<Row> {
    for (let auth = 0; auth < 2; auth++) {
      const token = await this.login();
      try { return row(await this.http.json(apiUrl(this.base, path, query), { force, headers: { Authorization: `Bearer ${token}` } })); }
      catch (error) { if (!(error instanceof ProviderError) || error.status !== 401 || auth === 1) throw error; if (this.token === token) this.token = ''; }
    }
    throw new Error('TVDB authentication failed');
  }
  async search(kind: ItemKind, title: string, year?: number, language?: string) {
    const data = await this.get('/search', { query: title, type: kind, year, language, limit: 20 });
    return rows(data.data).map(r => result(r, kind));
  }
  async languages() {
    return rows((await this.get('/languages')).data).map(r=>({code:str(r.id),name:str(r.name),native_name:str(r.nativeName)}));
  }
  async details(kind: ItemKind, id: string, options: { force?: boolean; language?: string } = {}): Promise<Metadata> {
    const root = `/${typePath(kind)}/${encodeURIComponent(id)}`;
    const data = row((await this.get(`${root}/extended`, { meta: 'translations' }, options.force)).data);
    const ids: Metadata['ids'] = { tvdb: id };
    for (const remote of rows(data.remoteIds)) {
      const name = str(remote.sourceName).toLowerCase();
      if (/themoviedb|tmdb|the movie db/.test(name)) ids.tmdb = str(remote.id);
      if (/imdb/.test(name)) ids.imdb = str(remote.id);
    }
    const eps: Row[] = [], seasons: Metadata['seasons'] = [], art = artwork(data.artworks);
    if (kind === 'series') {
      for (let page = 0; ; page++) {
        const payload = await this.get(`${root}/episodes/default${options.language ? '/' + encodeURIComponent(options.language) : ''}`, { page }, options.force);
        eps.push(...rows(row(payload.data).episodes));
        if (!row(payload.links).next) break;
        if (page >= 999) throw new Error('TVDB episode pagination exceeded limit');
      }
      for (const s of rows(data.seasons).filter(s => row(s.type).type === 'official' || num(row(s.type).id) === 1)) {
        const d = row((await this.get(`/seasons/${encodeURIComponent(str(s.id))}/extended`, {}, options.force)).data);
        const number = num(d.number ?? s.number) ?? 0, seasonArt = artwork(d.artwork ?? d.artworks, number);
        seasons.push({ id: str(s.id), season: number, title: str(d.name), plot: str(d.overview), artwork: seasonArt }); art.push(...seasonArt);
      }
    }
    return { ...result(data, kind), id, original_title: str(data.name), sort_title: str(data.name), tagline: str(data.tagline), runtime: num(data.runtime ?? data.averageRuntime), aired: str(data.firstAired) || null,
      genres: rows(data.genres).map(r => str(r.name)), studios: rows(data.companies).map(r => str(r.name)), rating: num(data.score), content_rating: str(rows(data.contentRatings)[0]?.name), status: str(row(data.status).name), ids,
      cast: tvdbCast(data.characters), seasons, artwork: art,
      episodes: eps.map(e => ({ id: str(e.id), season: num(e.seasonNumber) ?? 0, episode: num(e.number) ?? 0, title: str(e.name), plot: str(e.overview), aired: str(e.aired) || null, runtime: num(e.runtime), image: str(e.image) || null })) };
  }
}
