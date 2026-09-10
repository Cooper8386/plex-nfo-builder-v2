import type { OkResponse } from './index.js';
export type OverrideField = 'title'|'sorttitle'|'plot'|'tagline'|'originaltitle';
export interface NfoOverride { scope: string; field: OverrideField; value: string }
export interface OverridesResponse { path: string; overrides: NfoOverride[] }
export interface OverrideRequest { folder_path: string; scope: string; field: OverrideField; value?: string|null }
export interface ClearOverridesRequest { folder_path: string; scope?: string; field?: OverrideField }
export type OverrideResponse = OkResponse;
