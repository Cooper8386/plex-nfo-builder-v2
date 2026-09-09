import type { ItemKind } from 'shared';
import { apiUrl, ProviderHttp } from './http.js';
import { row, rows, str, num, type Artwork } from './normalized.js';
export class FanartClient {
  constructor(private http: ProviderHttp, private key: string, private base = 'https://webservice.fanart.tv/v3') {}
  async artwork(kind: ItemKind, id: string, force = false): Promise<Artwork[]> {
    if (!this.key) return [];
    const data = row(await this.http.json(apiUrl(this.base, `/${kind === 'series' ? 'tv' : 'movies'}/${encodeURIComponent(id)}`, { api_key: this.key }), { force, cache404: 3600 }));
    const slots: Record<string,string> = { tvposter:'poster', movieposter:'poster', showbackground:'background', moviebackground:'background', tvbanner:'banner', moviebanner:'banner', hdtvlogo:'clearlogo', clearlogo:'clearlogo', hdmovielogo:'clearlogo', movielogo:'clearlogo', seasonposter:'poster', seasonbanner:'banner', hdclearart:'clearart', clearart:'clearart', hdmovieclearart:'clearart', movieclearart:'clearart' };
    return Object.entries(slots).flatMap(([key,slot]) => rows(data[key]).filter(r => r.url).map(r => ({ provider:'fanart' as const, id:str(r.id), slot, url:str(r.url), thumb:null, language:str(r.lang) || null, score:num(r.likes) ?? 0, width:null, height:null, season:key.startsWith('season') ? num(r.season) : null })));
  }
}
