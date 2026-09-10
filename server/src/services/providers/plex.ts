import { apiUrl, ProviderHttp } from './http.js';
import { row, rows, str } from './normalized.js';
export interface PlexSection { id: string; title: string; type: string; locations: string[] }
export function translatePath(path: string, mappings: { from: string; to: string }[]) {
  const normalized = path.replace(/\\/g, '/');
  const mapping = mappings.map(m => ({ from: m.from.replace(/\\/g, '/').replace(/\/+$/, ''), to: m.to.replace(/\\/g, '/').replace(/\/+$/, '') }))
    .filter(m => m.from && (normalized === m.from || normalized.startsWith(m.from + '/'))).sort((a,b) => b.from.length - a.from.length)[0];
  return mapping ? mapping.to + normalized.slice(mapping.from.length) || '/' : path;
}
export class PlexClient {
  constructor(private http: ProviderHttp, private url: string, private token: string) {}
  private get(path: string, query: Record<string,string> = {}) { return this.http.json(apiUrl(this.url, path, query), { cache: false, headers: { 'X-Plex-Token': this.token, Accept: 'application/json' } }); }
  async identityOrThrow() {
    const data = row(row(await this.get('/identity')).MediaContainer);
    return { machine_identifier: str(data.machineIdentifier), version: str(data.version), friendly_name: str(data.friendlyName) };
  }
  async identity() {
    try { return await this.identityOrThrow(); }
    catch { return null; }
  }
  async sectionsOrThrow(): Promise<PlexSection[]> {
    return rows(row(row(await this.get('/library/sections')).MediaContainer).Directory).map(d => ({ id:str(d.key), title:str(d.title), type:str(d.type), locations:rows(d.Location).map(l => str(l.path)) }));
  }
  async sections(): Promise<PlexSection[]> {
    try { return await this.sectionsOrThrow(); }
    catch { return []; }
  }
  async refresh(path: string, mappings: { from: string; to: string }[] = []) {
    try {
      const translated = translatePath(path, mappings);
      const section = (await this.sections()).flatMap(s => s.locations.map(location => ({ ...s, location: location.replace(/\/+$/, '') }))).filter(s => translated === s.location || translated.startsWith(s.location + '/')).sort((a,b) => b.location.length - a.location.length)[0];
      if (!section) return false;
      await this.get(`/library/sections/${encodeURIComponent(section.id)}/refresh`, { path: translated }); return true;
    } catch { return false; }
  }
}
