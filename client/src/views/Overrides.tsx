import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ItemDetailResponse, EpisodesResponse, OverridesResponse, OverrideField, ThumbResponse } from 'shared';
import { api } from '../lib/api.js';
import { Button, Dialog, Input, Select } from '../design/primitives/index.js';
import { QueryState } from '../app/QueryState.js';
import { DangerAction, useAction } from './common.js';
import { imageSource } from './Artwork.js';
export function Overrides({ path, detail }: { path: string; detail: ItemDetailResponse }) {
  const kind = detail.binding?.kind ?? detail.state?.kind ?? 'series', [scope, setScope] = useState<string>(kind);
  const overrides = useQuery({ queryKey: ['overrides', path], queryFn: ({ signal }) => api.get<OverridesResponse>('/api/overrides', { path }, signal) });
  const episodes = useQuery({ queryKey: ['episodes', path], queryFn: ({ signal }) => api.get<EpisodesResponse>('/api/episodes', { path }, signal), enabled: !!detail.binding && kind === 'series' });
  const [thumb, setThumb] = useState<{ season: number; episode: number } | null>(null);
  const seasons = [...new Set([...detail.season_poster_progress.required_seasons, ...(episodes.data?.tvdb_episodes.map(episode => episode.season) ?? [])])].sort((a, b) => a - b);
  return <><section className="panel"><h2>NFO field overrides</h2><p>Empty fields fall back to the source. Saved edits apply on the next build.</p><Select label="Override scope" value={scope} onChange={event => setScope(event.target.value)}><option value={kind}>{kind === 'series' ? 'Series' : 'Movie'}</option>{seasons.map(season => <option key={season} value={`season-${String(season).padStart(2, '0')}`}>Season {season}</option>)}{episodes.data?.tvdb_episodes.map(episode => <option key={episode.id} value={`episode-${episode.id}`}>S{episode.season} E{episode.number}: {episode.name}</option>)}</Select>
    <QueryState query={overrides} label="field overrides">{value => <div className="field-list">{(['title', 'sorttitle', 'originaltitle', 'tagline', 'plot'] as OverrideField[]).map(field => <OverrideEdit key={`${scope}:${field}`} path={path} scope={scope} field={field} saved={value.overrides.find(row => row.scope === scope && row.field === field)?.value ?? ''} />)}</div>}</QueryState></section>
    {kind === 'series' && detail.binding && <section className="panel"><h2>Episode thumbnails</h2><QueryState query={episodes} label="episodes">{value => <ul className="episode-list">{value.tvdb_episodes.map(episode => <li key={episode.id}><span>S{episode.season} E{episode.number} · {episode.name}</span><Button onClick={() => { setScope(`episode-${episode.id}`); window.scrollTo(0, 0); }}>Edit fields</Button><Button onClick={() => setThumb({ season: episode.season, episode: episode.number })}>Choose thumbnail</Button></li>)}</ul>}</QueryState></section>}
    <details className="panel danger-zone"><summary>Reset overrides</summary><DangerAction label="Clear overrides in this scope" description={`Clear the previewed manual fields in ${scope}. Provider values will be used on the next build.`} record={{ op: 'overrides-clear', folder_path: path, scope }} /><DangerAction label="Clear all NFO overrides" description="Clear the previewed manual fields across this item." record={{ op: 'overrides-clear', folder_path: path }} /></details>
    <Dialog open={!!thumb} onClose={() => setThumb(null)} title="Choose episode thumbnail">{thumb && <ThumbnailPicker key={`${thumb.season}:${thumb.episode}`} path={path} {...thumb} />}</Dialog>
  </>;
}
function OverrideEdit({ path, scope, field, saved }: { path: string; scope: string; field: OverrideField; saved: string }) {
  const [draft, setDraft] = useState<string | null>(null), action = useAction(), value = draft ?? saved;
  const label = ({ title: 'Title', sorttitle: 'Sort title', originaltitle: 'Original title', tagline: 'Tagline', plot: 'Plot' })[field];
  return <form className="field-editor" onSubmit={event => { event.preventDefault(); void action.run(async () => { await api.send('/api/overrides', { folder_path: path, scope, field, value }); setDraft(null); }); }}>
    {field === 'plot' ? <label className="ui-field"><span>{label}</span><textarea className="ui-input" rows={5} value={value} onChange={event => setDraft(event.target.value)} /></label> : <Input label={label} value={value} onChange={event => setDraft(event.target.value)} />}
    <div className="actions"><Button type="submit" disabled={action.busy || value === saved}>Save field</Button><Button disabled={action.busy || !value} onClick={() => setDraft('')}>Use source value</Button>{value !== saved && <span role="status">Unsaved</span>}</div>{action.feedback}
  </form>;
}
function ThumbnailPicker({ path, season, episode }: { path: string; season: number; episode: number }) {
  const query = useQuery({ queryKey: ['thumbs', path, season, episode], queryFn: ({ signal }) => api.get<ThumbResponse>('/api/episodes/thumb-candidates', { path, season: String(season), episode: String(episode) }, signal) }), action = useAction();
  return <><QueryState query={query} label="episode thumbnails">{value => <>{value.note && <p>{value.note}</p>}<div className="artwork-grid thumbnail-grid"><Button disabled={action.busy || !value.external_id} aria-pressed={!value.current_selection} onClick={() => void action.run(() => api.send('/api/episodes/thumb-select', { folder_path: path, external_id: value.external_id, url: null }), 'Automatic thumbnail restored.')}>Auto</Button>{value.candidates.map(candidate => <button type="button" className="artwork-choice" key={candidate.url} disabled={action.busy || !value.external_id} aria-pressed={candidate.selected} onClick={() => void action.run(() => api.send('/api/episodes/thumb-select', { folder_path: path, external_id: value.external_id, url: candidate.url }), 'Thumbnail saved. Build to write it beside the video.')}><img src={imageSource(candidate.thumb ?? candidate.url)} alt={`Episode still ${candidate.width ?? '?'} by ${candidate.height ?? '?'}`} /></button>)}</div>{!value.external_id && <p>No provider episode is available for this selection.</p>}</>}</QueryState>{action.feedback}</>;
}
