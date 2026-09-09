import type { ItemKind, MetadataSource, Provider } from 'shared';
export interface Cast { id: string; name: string; character: string; character_type: string; order: number; image: string | null }
export interface Artwork { provider: 'tvdb' | 'tmdb' | 'fanart'; id: string; slot: string; url: string; thumb: string | null; language: string | null; score: number; width: number | null; height: number | null; season: number | null }
export interface Episode { id: string; season: number; episode: number; title: string; plot: string; aired: string | null; runtime: number | null; image: string | null }
export interface Season { id: string; season: number; title: string; plot: string; artwork: Artwork[] }
export interface SearchResult { provider: MetadataSource; id: string; kind: ItemKind; title: string; year: number | null; plot: string; image: string | null }
export interface Metadata extends SearchResult {
  original_title: string; sort_title: string; tagline: string; runtime: number | null; aired: string | null;
  genres: string[]; studios: string[]; rating: number | null; content_rating: string; status: string;
  ids: Partial<Record<Provider, string>>; cast: Cast[]; episodes: Episode[]; seasons: Season[]; artwork: Artwork[];
}
export interface MetadataProvider {
  search(kind: ItemKind, title: string, year?: number, language?: string): Promise<SearchResult[]>;
  details(kind: ItemKind, id: string, options?: { force?: boolean; language?: string }): Promise<Metadata>;
}
export type Row = Record<string, unknown>;
export const row = (v: unknown): Row => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};
export const rows = (v: unknown): Row[] => Array.isArray(v) ? v.map(row) : [];
export const str = (v: unknown) => typeof v === 'string' || typeof v === 'number' ? String(v) : '';
export const num = (v: unknown) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
export const yearOf = (v: unknown) => num(str(v).slice(0,4));
