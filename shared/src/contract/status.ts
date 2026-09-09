import type { ItemKind, NfoStatus } from './index.js';

export interface SeasonCoverage {
  season: number | null;
  folder: string;
  video_count: number;
  nfo_count: number;
  foreign_nfo_count: number;
  missing: string[];
  foreign: string[];
}
export interface NfoExplanation {
  path: string;
  kind: ItemKind;
  status: NfoStatus;
  video_count: number;
  nfo_count: number;
  foreign_nfo_count: number;
  missing: string[];
  foreign: string[];
  seasons: SeasonCoverage[];
  orphan_count: number;
  reasons: string[];
}
