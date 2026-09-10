import type { MetadataSource, OkResponse } from './index.js';

export type LibraryKind = 'tv' | 'movies' | 'mixed';
export interface Library {
  name: string;
  kind: LibraryKind;
  enabled: 0 | 1;
  detected_at: number;
  metadata_source: MetadataSource | null;
}
export interface LibraryListEntry extends Library { effective_metadata_source: MetadataSource }
export interface LibrariesResponse { libraries: LibraryListEntry[] }
export interface DetectLibrariesResponse { libraries: Library[] }
export interface LibraryParams { name: string }
export interface UpdateLibraryRequest {
  kind?: LibraryKind;
  enabled?: boolean;
  metadata_source?: MetadataSource | null;
}
export interface UpdateLibraryResponse extends OkResponse {
  library: Library;
  effective_metadata_source: MetadataSource;
}
export type DeleteLibraryResponse = import('./danger.js').RecordResponse;
export interface ScanLibraryResponse extends OkResponse { scheduled: true }
