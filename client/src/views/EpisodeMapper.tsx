import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { EpisodeLocal, EpisodesResponse, ItemKind } from 'shared';
import { api } from '../lib/api.js';
import { Button, Input, Select } from '../design/primitives/index.js';
import { QueryState } from '../app/QueryState.js';
import { useAction } from './common.js';
import { Rename } from './Rename.js';
export function EpisodeMapper({ path, bound, kind }: { path: string; bound: boolean; kind: ItemKind }) {
  const query = useQuery({ queryKey: ['episodes', path], queryFn: ({ signal }) => api.get<EpisodesResponse>('/api/episodes', { path }, signal), enabled: bound && kind === 'series' });
  if (!bound) return <p>Match this item before mapping or renaming media.</p>;
  return <>{kind === 'series' && <section className="panel"><h2>Episode file mappings</h2><p>Map local files to provider episodes. Saved mappings survive renames and rebuilds.</p><QueryState query={query} label="episode mappings">{value => <div className="mapping-list">{value.locals.length === 0 && <p>No local video files found.</p>}{value.locals.map(file => <Mapping key={file.file_path} path={path} file={file} episodes={value.tvdb_episodes} />)}</div>}</QueryState></section>}<Rename path={path} /></>;
}
function Mapping({ path, file, episodes }: { path: string; file: EpisodeLocal; episodes: EpisodesResponse['tvdb_episodes'] }) {
  const [season, setSeason] = useState(String(file.effective_season ?? '')), [episode, setEpisode] = useState(String(file.effective_episode ?? '')), [external, setExternal] = useState(file.override_episode_id ?? file.matched_episode_id ?? ''), action = useAction();
  return <form className="mapping-row" onSubmit={event => { event.preventDefault(); void action.run(() => api.send('/api/episodes/override-file', { folder_path: path, file_path: file.file_path, season: season === '' ? null : Number(season), episode: episode === '' ? null : Number(episode), external_id: external || null })); }}><strong className="file-path">{file.file_name}</strong><p>{file.unparsed ? 'Filename needs mapping' : file.matched_title ?? 'No provider match'}</p><div className="form-grid"><Input label={`Season for ${file.file_name}`} type="number" min="0" value={season} onChange={event => setSeason(event.target.value)} /><Input label={`Episode for ${file.file_name}`} type="number" min="0" value={episode} onChange={event => setEpisode(event.target.value)} /><Select label={`Provider episode for ${file.file_name}`} value={external} onChange={event => { const selected = episodes.find(value => value.id === event.target.value); setExternal(event.target.value); if (selected) { setSeason(String(selected.season)); setEpisode(String(selected.number)); } }}><option value="">Use season and episode</option>{episodes.map(value => <option key={value.id} value={value.id}>S{value.season} E{value.number} · {value.name}</option>)}</Select></div><div className="actions"><Button type="submit" disabled={action.busy}>Save mapping</Button><Button disabled={action.busy} onClick={() => void action.run(() => api.send('/api/episodes/override-file', { folder_path: path, file_path: file.file_path, clear: true }), 'Mapping cleared. Reload to see filename defaults.')}>Clear mapping</Button></div>{action.feedback}</form>;
}
