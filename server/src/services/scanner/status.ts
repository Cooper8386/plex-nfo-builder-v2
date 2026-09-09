import { open, readdir } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { ItemKind, NfoExplanation, NfoStatus, SeasonCoverage } from 'shared';
import { mediaFolders, videoPattern } from './layout.js';

async function ours(path: string) {
  const file = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(2048);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString('utf8').includes('<!-- plex-nfo-builder');
  } finally { await file.close(); }
}

export async function classifyStatus(folder: string, kind: ItemKind): Promise<NfoExplanation> {
  const missing: string[] = [], foreign: string[] = [], seasons: SeasonCoverage[] = [];
  let nfoCount = 0, videoCount = 0, orphanCount = 0;
  for (const group of await mediaFolders(folder)) {
    const entries = (await readdir(group.path, { withFileTypes: true })).filter(entry => entry.isFile());
    const videos = entries.filter(entry => videoPattern.test(entry.name));
    const nfos = entries.filter(entry => /\.nfo$/i.test(entry.name));
    const nfoNames = new Set(nfos.map(entry => entry.name.toLowerCase()));
    const stems = new Set(videos.map(entry => basename(entry.name, extname(entry.name)).toLowerCase()));
    const expected = videos.map(entry => `${basename(entry.name, extname(entry.name))}.nfo`);
    if (group.path === folder && kind === 'series') expected.push('tvshow.nfo');
    if (group.path === folder && kind === 'movie' && !videos.length) expected.push('movie.nfo');
    const groupMissing = expected.filter(name => !nfoNames.has(name.toLowerCase())).map(name => join(group.path, name));
    const groupForeign: string[] = [];
    for (const entry of nfos) {
      const path = join(group.path, entry.name);
      if (!await ours(path)) groupForeign.push(path);
      if (!['tvshow.nfo', 'season.nfo', 'movie.nfo'].includes(entry.name.toLowerCase()) && !stems.has(basename(entry.name, extname(entry.name)).toLowerCase())) orphanCount++;
    }
    videoCount += videos.length;
    nfoCount += nfos.length;
    missing.push(...groupMissing); foreign.push(...groupForeign);
    seasons.push({ season: group.season, folder: group.path, video_count: videos.length, nfo_count: nfos.length,
      foreign_nfo_count: groupForeign.length, missing: groupMissing, foreign: groupForeign });
  }
  let status: NfoStatus;
  if (!nfoCount) status = 'none';
  else if (foreign.length === nfoCount) status = 'foreign';
  else if (foreign.length) status = 'mixed';
  else if (missing.length) status = 'partial';
  else status = 'complete';
  const reasons: string[] = [];
  if (!nfoCount) reasons.push('No NFO files found.');
  if (missing.length) reasons.push(`${missing.length} expected NFO file(s) are missing.`);
  if (foreign.length) reasons.push(`${foreign.length} NFO file(s) have no application provenance.`);
  if (orphanCount) reasons.push(`${orphanCount} orphan NFO companion(s) found.`);
  return { path: folder, kind, status, video_count: videoCount, nfo_count: nfoCount,
    foreign_nfo_count: foreign.length, missing, foreign, seasons, orphan_count: orphanCount, reasons };
}
