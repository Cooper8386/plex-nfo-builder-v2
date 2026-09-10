export type ScheduleAction='scan_only'|'match_only'|'build_only'|'match_and_build'|'full';
export interface Schedule {id:string;library:string|null;cron:string;action:ScheduleAction;enabled:number;last_run:number|null;last_status:string|null;last_message:string|null;created_at:number;updated_at:number}
export interface ScheduleRequest {library?:string|null;cron:string;action:ScheduleAction;enabled?:boolean}
