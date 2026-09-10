import type { Env } from '../../config/env.js';
import type { Settings } from '../../config/settings.js';
import { offLoop,workerModule } from '../fs/off-loop.js';
import type { ApiInput } from './worker.js';
export class ApiClient{
  private pool=offLoop(workerModule('./worker.js',import.meta.url),{concurrency:2,timeoutMs:660_000});
  constructor(private env:Env,private settings:()=>Settings){}
  run<T>(payload:ApiInput){return this.pool.run<T>({env:this.env,settings:this.settings(),payload});}
  close(){return this.pool.close();}
}
