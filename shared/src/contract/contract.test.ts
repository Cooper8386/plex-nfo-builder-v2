import { expectTypeOf, test } from 'vitest';
import type {
  ApiErrorResponse, ApiErrorStatus, Binding, BindRequest, BindResponse,
  DetectLibrariesResponse, HealthResponse, Item, ItemDetailResponse, ItemsQuery,
  ItemsResponse, Job, JobLogResponse, JobParams, JobResponse, JobsResponse,
  JobStatus, LibrariesResponse, Library, LibraryKind, MetadataSource, NfoStatus,
  Provider, ScanLibraryResponse, SetSecondaryRequest, SetSecondaryResponse,
  Settings, SettingsResponse, SettingsSecret, UnbindQuery, UpdateLibraryRequest,
  UpdateSettingsRequest, UpdateSettingsResponse,
} from '../index.js';

test('health contract keeps every documented response field', () => {
  expectTypeOf<HealthResponse>().toEqualTypeOf<{
    ok: boolean; version: string; media_root: string; tvdb_configured: boolean;
    tmdb_configured: boolean; fanart_configured: boolean; metadata_source: 'tvdb' | 'tmdb';
    plex_configured: boolean; plex_auto_refresh: boolean;
  }>();
  expectTypeOf<ApiErrorResponse>().toEqualTypeOf<{ detail: unknown }>();
  expectTypeOf<ApiErrorStatus>().toEqualTypeOf<400 | 401 | 404 | 413 | 422 | 500 | 502 | 503>();
});

test('libraries keep stored flags distinct from editable booleans and resolved source', () => {
  expectTypeOf<LibraryKind>().toEqualTypeOf<'tv' | 'movies' | 'mixed'>();
  expectTypeOf<Library['enabled']>().toEqualTypeOf<0 | 1>();
  expectTypeOf<Library['metadata_source']>().toEqualTypeOf<MetadataSource | null>();
  expectTypeOf<LibrariesResponse['libraries'][number]['effective_metadata_source']>().toEqualTypeOf<MetadataSource>();
  expectTypeOf<DetectLibrariesResponse>().toEqualTypeOf<{ libraries: Library[] }>();
  expectTypeOf<UpdateLibraryRequest>().toEqualTypeOf<{ kind?: LibraryKind; enabled?: boolean; metadata_source?: MetadataSource | null }>();
  expectTypeOf<ScanLibraryResponse>().toEqualTypeOf<{ ok: true; scheduled: true }>();
});

test('items exclude stale and preserve nullable binding and scan data', () => {
  expectTypeOf<NfoStatus>().toEqualTypeOf<'none' | 'partial' | 'complete' | 'foreign' | 'mixed'>();
  expectTypeOf<Item['provider']>().toEqualTypeOf<Provider | null>();
  expectTypeOf<Item['year']>().toEqualTypeOf<number | null>();
  expectTypeOf<Item['date_added']>().toEqualTypeOf<number>();
  expectTypeOf<Item['date_updated']>().toEqualTypeOf<number | null>();
  expectTypeOf<ItemsResponse>().toEqualTypeOf<{ items: Item[] }>();
  expectTypeOf<ItemsQuery>().toEqualTypeOf<{ library?: string; status?: string; q?: string; hide_organized?: boolean;poster_selection?:'all'|'needs_selection'|'selected' }>();
  expectTypeOf<ItemDetailResponse['binding']>().toEqualTypeOf<Binding | null>();
  expectTypeOf<ItemDetailResponse['state']>().toEqualTypeOf<Item | null>();
});

test('binding commands preserve optional defaults and restrict secondary providers', () => {
  expectTypeOf<Provider>().toEqualTypeOf<'tvdb' | 'tmdb' | 'imdb'>();
  expectTypeOf<Binding['external_id']>().toEqualTypeOf<string>();
  expectTypeOf<Binding['source_locked']>().toEqualTypeOf<boolean>();
  expectTypeOf<BindRequest>().toEqualTypeOf<{
    folder_path: string; kind: 'series' | 'movie'; provider?: MetadataSource;
    external_id: string; title?: string | null; year?: number | null;
    language?: string | null; lock_source?: boolean;
  }>();
  expectTypeOf<BindResponse>().toEqualTypeOf<{ ok: true }>();
  expectTypeOf<SetSecondaryRequest['provider']>().toEqualTypeOf<MetadataSource | null | undefined>();
  expectTypeOf<SetSecondaryResponse['secondary_provider']>().toEqualTypeOf<MetadataSource | null>();
  expectTypeOf<UnbindQuery>().toEqualTypeOf<{ folder_path: string }>();
});

test('jobs include queued state, nullable lifecycle timestamps and plain-text logs', () => {
  expectTypeOf<JobStatus>().toEqualTypeOf<'queued' | 'running' | 'completed' | 'failed'>();
  expectTypeOf<Job>().toEqualTypeOf<{
    id: string; kind: 'series' | 'movie' | 'schedule'; folder: string; status: JobStatus;
    progress: number; total: number; started_at: number | null; finished_at: number | null; messages: string[];
  }>();
  expectTypeOf<JobParams>().toEqualTypeOf<{ id: string }>();
  expectTypeOf<JobsResponse>().toEqualTypeOf<{ jobs: Job[] }>();
  expectTypeOf<JobResponse>().toEqualTypeOf<Job>();
  expectTypeOf<JobLogResponse>().toEqualTypeOf<string>();
});

test('settings responses exclude every secret and patches allow omitted fields', () => {
  expectTypeOf<Extract<keyof SettingsResponse, SettingsSecret>>().toEqualTypeOf<never>();
  expectTypeOf<SettingsResponse[`${SettingsSecret}_configured`]>().toEqualTypeOf<boolean>();
  expectTypeOf<SettingsResponse['watcher_enabled']>().toEqualTypeOf<boolean | null>();
  expectTypeOf<UpdateSettingsRequest>().toEqualTypeOf<Partial<Settings>>();
  expectTypeOf<UpdateSettingsResponse>().toEqualTypeOf<{ ok: true }>();
  expectTypeOf<SettingsResponse['metadata_source']>().toEqualTypeOf<MetadataSource>();
  expectTypeOf<Settings['preferred_artwork_source']>().toEqualTypeOf<'auto' | MetadataSource>();
});
