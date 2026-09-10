import type { AutoBulkRequest, AutoBulkResponse, BindRequest, BindResponse, MatchSearchQuery, MatchSearchResponse, SetSecondaryRequest, SetSecondaryResponse, SetSourceRequest, SetSourceResponse, UnbindResponse } from 'shared';
import type { Env } from '../../config/env.js';
import type { Settings } from '../../config/settings.js';
import { offLoop, workerModule } from '../fs/off-loop.js';
import type { MatchInput } from './worker.js';
import type { OverrideRequest, ClearOverridesRequest, OverridesResponse, OverrideResponse } from 'shared';
import type { ArtworkInput } from '../artwork/artwork.js';
import type { DangerInput } from '../cleaner/danger.js';
import type { DangerResponse } from 'shared';
import type { RenameRequest } from 'shared';
import type { ApiInput } from '../api/worker.js';
import type { RecordRequest,RecordResponse } from 'shared';
export class MatcherClient {
  preview(payload:RecordRequest){return this.run<RecordResponse>('preview',payload);}
  api<T>(payload:ApiInput){return this.run<T>('api',payload);}
  private pool = offLoop(workerModule('./worker.js',import.meta.url),{concurrency:1,timeoutMs:300_000});
  constructor(private env: Env, private settings: () => Settings) {}
  private run<T>(action: MatchInput['action'], payload: unknown) { return this.pool.run<T>({action,payload,env:this.env,settings:this.settings()} satisfies MatchInput); }
  bind(payload: BindRequest) { return this.run<BindResponse>('bind',payload); }
  source(payload: SetSourceRequest) { return this.run<SetSourceResponse>('source',payload); }
  secondary(payload: SetSecondaryRequest) { return this.run<SetSecondaryResponse>('secondary',payload); }
  unbind(path: string) { return this.run<UnbindResponse>('unbind',path); }
  bulk(payload: AutoBulkRequest) { return this.run<AutoBulkResponse>('bulk',payload); }
  search(payload: MatchSearchQuery) { return this.run<MatchSearchResponse>('search',payload); }
  overrides(path: string) { return this.run<OverridesResponse>('overrides-get',{folder_path:path}); }
  setOverride(payload: OverrideRequest) { return this.run<OverrideResponse>('overrides-set',payload); }
  clearOverrides(payload: ClearOverridesRequest) { return this.run<OverrideResponse>('overrides-clear',payload); }
  artwork<T>(payload: ArtworkInput) { return this.run<T>('artwork',payload); }
  danger(payload:DangerInput) {return this.run<DangerResponse>('danger',payload);}
  rename<T>(payload:RenameRequest,apply=false) {return this.run<T>(apply?'rename-apply':'rename-preview',payload);}
  close() { return this.pool.close(); }
}
