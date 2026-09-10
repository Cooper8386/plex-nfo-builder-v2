import type { ItemKind, AutoBulkRequest } from './index.js';
export interface BuildRequest {folder_path:string;kind?:ItemKind;force?:boolean;language?:string}
export type BuildBulkRequest = AutoBulkRequest;
export interface BuildResponse {ok:true;job:string}
export interface BuildBulkResponse {ok:true;queued:number;jobs:string[]}
