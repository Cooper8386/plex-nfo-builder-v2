export type DangerOperation='clean'|'orphans'|'wipe-nfo'|'wipe-sidecars'|'library-orphans'|'prune'|'prune-empty';
export interface DangerRequest {folder_path?:string;library?:string;dry_run?:boolean;keep_sidecar?:boolean;delete_files?:boolean;rescan?:boolean;confirm?:boolean;preview_id?:string}
export interface DangerPreview {dry_run:true;preview_id:string;files:string[];folders:string[];skipped:{path:string;reason:string}[]}
export interface DangerResult {ok:true;removed:string[];skipped:{path:string;reason:string}[]}
export type DangerResponse=DangerPreview|DangerResult;
