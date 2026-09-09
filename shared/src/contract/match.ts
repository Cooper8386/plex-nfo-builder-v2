import type { ItemKind, MetadataSource, OkResponse } from './index.js';
export interface MatchSearchQuery { q: string; type?: ItemKind; year?: number; language?: string; provider?: MetadataSource; library?: string }
export interface MatchCandidate { provider: MetadataSource; id: string; kind: ItemKind; title: string; year: number | null; plot: string; image: string | null }
export interface MatchSearchResponse { results: MatchCandidate[]; provider: MetadataSource }
export interface AutoBulkRequest { folder_paths?: string[]; library?: string; only_unmatched?: boolean; only_unbuilt?: boolean; force?: boolean; language?: string }
export interface AutoMatchResult { folder_path: string; matched: boolean; reason: 'matched' | 'existing' | 'locked' | 'no_match' | 'low_confidence' | 'error'; score?: number; detail?: string }
export interface AutoBulkResponse extends OkResponse { total: number; matched: number; results: AutoMatchResult[] }
