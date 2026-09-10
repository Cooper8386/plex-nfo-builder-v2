import type { ArtworkCandidate,MetadataSource } from './index.js';
export interface BrowseResponse {path:string;parent:string|null;items:{name:string;path:string;is_dir:boolean;size:number|null}[]}
export interface TagRequest {folder_path:string;tag:string}
export interface EpisodeOverrideRequest {folder_path:string;season:number;episode:number;tvdb_episode_id?:string|null}
export interface EpisodeFileOverrideRequest {folder_path:string;file_path:string;season?:number|null;episode?:number|null;external_id?:string|null;clear?:boolean}
export interface EpisodeThumbRequest {folder_path:string;external_id:string;url?:string|null}
export interface EpisodeLocal {file_path:string;file_name:string;parsed_season:number;parsed_episode:number;effective_season:number|null;effective_episode:number|null;override_episode_id:string|null;matched_episode_id:string|null;matched_season:number|null;matched_number:number|null;matched_title:string|null;matched_image:string|null;local_thumb:string|null;unparsed:boolean;has_file_override:boolean}
export interface EpisodeEntry {id:string;season:number;number:number;name:string;aired:string|null;image:string|null}
export interface EpisodesResponse {path:string;provider:MetadataSource;locals:EpisodeLocal[];tvdb_episodes:EpisodeEntry[]}
export interface ThumbQuery {path:string;season:number;episode:number}
export interface ThumbCandidate {url:string;thumb:string|null;width:number|null;height:number|null;language:string|null;vote_average:number|null;is_default:boolean;selected:boolean}
export interface ThumbResponse {path:string;provider:MetadataSource;season:number;episode:number;external_id:string|null;candidates:ThumbCandidate[];current_selection:string|null;note:string|null}
export interface PlexSection {id:string;key:string;title:string;type:string;locations:string[]}
export interface PlexIdentity {machine_identifier:string;version:string;friendly_name:string}
export interface PlexTestResponse {ok:boolean;error?:string;identity?:PlexIdentity|null;sections?:PlexSection[]}
export interface PlexRefreshRequest {path:string;delay_seconds?:number}
export interface PlexSectionsResponse {sections:PlexSection[]}
export interface PlexRefreshResponse {requested_local_path:string;translated_path:string|null;section_id:string|null;section_title:string|null;refreshed:boolean;error:string|null;rating_key:string|null;item_title:string|null;strategy:'metadata-refresh'|'partial-scan-only'|null;item_count?:number}
export interface CacheClearResponse {cleared:number}
export interface VersionResponse {version:string;name:string;repo:string}
export interface LogResponse {lines:string[]}
export type ProviderPayload=Record<string,unknown>;
export type EpisodeImages=ArtworkCandidate[];
