import type { AutoBulkRequest, AutoBulkResponse, BindRequest, BindResponse, MatchSearchQuery, MatchSearchResponse, SetSecondaryRequest, SetSecondaryResponse, SetSourceRequest, SetSourceResponse, UnbindResponse } from 'shared';
import type { Env } from '../../config/env.js';
import type { Settings } from '../../config/settings.js';
import { offLoop, workerModule } from '../fs/off-loop.js';
import type { MatchInput } from './worker.js';
export class MatcherClient {
  private pool = offLoop(workerModule('./worker.js',import.meta.url),{concurrency:1,timeoutMs:300_000});
  constructor(private env: Env, private settings: () => Settings) {}
  private run<T>(action: MatchInput['action'], payload: unknown) { return this.pool.run<T>({action,payload,env:this.env,settings:this.settings()} satisfies MatchInput); }
  bind(payload: BindRequest) { return this.run<BindResponse>('bind',payload); }
  source(payload: SetSourceRequest) { return this.run<SetSourceResponse>('source',payload); }
  secondary(payload: SetSecondaryRequest) { return this.run<SetSecondaryResponse>('secondary',payload); }
  unbind(path: string) { return this.run<UnbindResponse>('unbind',path); }
  bulk(payload: AutoBulkRequest) { return this.run<AutoBulkResponse>('bulk',payload); }
  search(payload: MatchSearchQuery) { return this.run<MatchSearchResponse>('search',payload); }
  close() { return this.pool.close(); }
}
