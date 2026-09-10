export interface RenameRequest {folder_path:string;template?:string;daily_template?:string;anime_template?:string;series_type?:'auto'|'standard'|'daily'|'anime';release_group?:string;only_src?:string[];preview_id?:string;confirm?:boolean}
export interface RenameItem {src:string;dst:string;src_name:string;dst_name:string;season:number|null;episode:number|null;matched_title:string|null;conflict:'exists'|'duplicate'|null;unchanged:boolean;companions?:RenameMove[]}
export interface RenamePreview {folder_path:string;template:string;items:RenameItem[];preview_id?:string}
export interface RenameMove {src:string;dst:string}
export interface RenameFailure {src:string;dst?:string;reason:string}
export interface RenameResult {ok:true;renamed:RenameMove[];skipped:RenameFailure[];failed:RenameFailure[];companions_moved:RenameMove[];companions_failed:RenameFailure[]}
