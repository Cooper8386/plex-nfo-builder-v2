export type MetadataSource = 'tvdb' | 'tmdb';
export type Provider = MetadataSource | 'imdb';
export type ItemKind = 'series' | 'movie';
export interface OkResponse { ok: true }
// Validation errors may carry structured detail; clients must narrow before rendering.
export interface ApiErrorResponse { detail: unknown }
export type ApiErrorStatus = 400 | 401 | 404 | 413 | 422 | 500 | 502 | 503;

export type * from './health.js';
export type * from './library.js';
export type * from './item.js';
export type * from './binding.js';
export type * from './job.js';
export type * from './settings.js';
export type * from './status.js';
export type * from './match.js';
export type * from './overrides.js';
