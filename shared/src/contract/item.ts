import type { Binding, ItemKind, LibraryKind, Provider } from './index.js';

export type NfoStatus = 'none' | 'partial' | 'complete' | 'foreign' | 'mixed';
export interface Item {
  folder_path: string;
  library: string;
  kind: ItemKind;
  title: string | null;
  year: number | null;
  external_id: string | null;
  provider: Provider | null;
  nfo_status: NfoStatus;
  episode_count_local: number;
  episode_count_tvdb: number;
  season_count_local: number;
  last_scanned: number | null;
  last_built: number | null;
  poster_path: string | null;
  sort_title: string | null;
  orphan_count: number;
  date_added: number;
  date_updated: number | null;
}
export interface ItemsQuery {
  library?: string;
  /** Comma-separated NFO statuses, as accepted by the API. */
  status?: string;
  q?: string;
  hide_organized?: boolean;
}
export interface ItemsResponse { items: Item[] }
export interface ItemQuery { path: string }
export type NfoField = 'title' | 'sorttitle' | 'originaltitle' | 'tagline' | 'plot';
export type NfoScope = 'series' | 'movie' | `season-${string}` | `episode-${string}`;
export interface ItemDetailResponse {
  path: string;
  binding: Binding | null;
  state: Item | null;
  artwork_files: string[];
  overrides: Partial<Record<NfoScope, Partial<Record<NfoField, string>>>>;
  provider_episode_count: number | null;
  provider_used: Provider | null;
  tags: { tvdb: string[]; tmdb: string[]; custom: string[] };
  library_kind: LibraryKind | null;
}
