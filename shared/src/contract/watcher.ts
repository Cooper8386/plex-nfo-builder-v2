import type { ItemKind } from './index.js';
export interface WatcherStatus {available:boolean;enabled:boolean;running:boolean;debounce_seconds:number;watched_paths:string[];pending_count:number;in_flight_count:number}
export interface WatcherEvent {timestamp:number;event_type:string;folder_path:string;library:string|null;message:string}
export interface WatcherReview {folder_path:string;library:string;kind:ItemKind;reason:'no_match'|'low_confidence'|'error'|'ambiguous';detail:string|null;detected_at:number;last_attempt_at:number|null;attempts:number}
