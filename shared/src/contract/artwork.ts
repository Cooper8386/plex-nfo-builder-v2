import type { ItemKind, OkResponse } from './index.js';
export interface ArtworkChoice { slot: string; url: string; language: string | null; score: number | null }
export interface ArtworkCandidate { provider: 'tvdb'|'tmdb'|'fanart'; id: string; slot: string; url: string; thumb: string | null; language: string | null; score: number; width: number | null; height: number | null; season: number | null }
export interface SeasonPosterProgress {
  state: 'not_started'|'in_progress'|'selected'|'not_applicable';
  required_seasons: number[]; selected_seasons: number[]; missing_seasons: number[]; unresolved_files: string[];
}
export interface ArtworkCandidatesQuery { path: string; kind?: ItemKind }
export interface ArtworkCandidatesResponse { path: string; candidates: Record<string,ArtworkCandidate[]>; selections: ArtworkChoice[]; season_poster_progress: SeasonPosterProgress; warnings: string[] }
export interface SelectArtworkRequest { folder_path: string; slot: string; url: string; language?: string | null; score?: number | null }
export interface ClearArtworkRequest { folder_path: string; slot?: string }
export interface CustomArtworkRequest { folder_path: string; url: string; slot?: string }
export interface CustomArtwork { id: string; folder_path: string; slot: string; source: 'upload'|'url'; origin: string | null; file_path: string | null; content_type: string | null; size: number | null; created_at: number; url: string }
export interface CustomArtworkResponse { items: CustomArtwork[] }
export interface ArtworkLanguage { code: string; name: string; native_name: string }
export interface ArtworkLanguagesResponse { tvdb: ArtworkLanguage[]; tmdb: ArtworkLanguage[] }
export type ArtworkResponse = OkResponse;
