import type { ItemKind } from './index.js';

// Queued is required by the durable queue decision; the queue itself is phase 7.
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';
export interface Job {
  id: string;
  kind: ItemKind;
  folder: string;
  status: JobStatus;
  progress: number;
  total: number;
  started_at: number | null;
  finished_at: number | null;
  messages: string[];
}
export interface JobParams { id: string }
export interface JobsResponse { jobs: Job[] }
export type JobResponse = Job;
/** GET /api/jobs/{id}/log returns text/plain, not a JSON envelope. */
export type JobLogResponse = string;
