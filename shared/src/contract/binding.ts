import type { ItemKind, MetadataSource, OkResponse, Provider } from './index.js';

export interface Binding {
  folder_path: string;
  kind: ItemKind;
  provider: Provider;
  external_id: string;
  title: string | null;
  year: number | null;
  language: string | null;
  source_locked: boolean;
  secondary_provider: MetadataSource | null;
  secondary_external_id: string | null;
  created_at: number;
  updated_at: number;
}
export interface BindRequest {
  folder_path: string;
  kind: ItemKind;
  provider?: MetadataSource;
  external_id: string;
  title?: string | null;
  year?: number | null;
  language?: string | null;
  lock_source?: boolean;
}
export type BindResponse = OkResponse;
export interface SetSourceRequest {
  folder_path: string;
  provider: MetadataSource;
  external_id?: string | null;
  locked?: boolean;
  kind?: ItemKind;
  title?: string | null;
  year?: number | null;
}
export type SetSourceResponse = OkResponse;
export interface SetSecondaryRequest {
  folder_path: string;
  provider?: MetadataSource | null;
  external_id?: string | null;
}
export interface SetSecondaryResponse extends OkResponse {
  secondary_provider: MetadataSource | null;
  secondary_external_id: string | null;
}
export interface UnbindQuery { folder_path: string }
export type UnbindResponse = OkResponse;
