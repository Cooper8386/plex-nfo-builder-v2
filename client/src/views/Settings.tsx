import { createContext, useContext, useEffect, useState, useRef, useCallback, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Settings as AppSettings, SettingsResponse, SettingsSecret, UpdateSettingsRequest, PlexTestResponse, PlexSectionsResponse, PlexRefreshResponse, VersionResponse, ArtworkLanguagesResponse } from 'shared';
import { api } from '../lib/api.js';
import { Button, Input, Select, Badge } from '../design/primitives/index.js';
import { QueryState } from '../app/QueryState.js';
import { useConfirm } from '../components/ConfirmDialog.js';
import { DangerAction, useAction } from './common.js';
import { Schedules } from './Watcher.js';

const secretFields: SettingsSecret[] = ['tvdb_api_key', 'tvdb_pin', 'tmdb_api_key', 'fanart_api_key', 'plex_token'];
type Draft = Partial<Record<keyof AppSettings, string>>;
let memoryDraft: Draft = {};
function initialDraft(): Draft { try { return { ...JSON.parse(sessionStorage.getItem('settings-draft') ?? '{}'), ...memoryDraft }; } catch { return memoryDraft; } }
const DraftContext = createContext<{ draft: Draft; setDraft: React.Dispatch<React.SetStateAction<Draft>> } | null>(null);
export function SettingsDraftProvider({ children }: { children: ReactNode }) {
  const [draft, updateState] = useState<Draft>(initialDraft), current=useRef(draft);
  const setDraft=useCallback<React.Dispatch<React.SetStateAction<Draft>>>(update=>{
    const next=typeof update==='function'?update(current.current):update;
    current.current=next;memoryDraft=next;updateState(next);
    try { sessionStorage.setItem('settings-draft', JSON.stringify(Object.fromEntries(Object.entries(next).filter(([key]) => !secretFields.includes(key as SettingsSecret))))); } catch { /* In-memory drafts still survive view navigation. */ }
  },[]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    if (Object.keys(draft).length) window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [draft]);
  return <DraftContext value={{ draft, setDraft }}>{children}</DraftContext>;
}
export function useSettingsDraft() { const value = useContext(DraftContext); if (!value) throw new Error('Settings draft provider missing'); return value; }
type Field = { key: keyof AppSettings; label: string; kind?: 'boolean' | 'number' | 'list' | 'json' | 'secret'; options?: string[]; note?: string; disabled?: boolean };
const groups: { title: string; fields: Field[] }[] = [
  { title: 'Metadata', fields: [{ key: 'metadata_source', label: 'Default provider', options: ['tvdb', 'tmdb'] }, { key: 'preferred_language', label: 'Preferred language' }, { key: 'fallback_languages', label: 'Fallback languages', kind: 'list' }, { key: 'include_original_title', label: 'Include original title', kind: 'boolean' }, { key: 'auto_match_threshold', label: 'Auto-match threshold', kind: 'number' }, { key: 'overwrite_foreign_nfo', label: 'Overwrite foreign NFOs', kind: 'boolean' }, { key: 'cache_ttl_hours', label: 'Provider cache lifetime (hours)', kind: 'number' }] },
  { title: 'Provider credentials', fields: [{ key: 'tvdb_api_key', label: 'TVDB API key', kind: 'secret' }, { key: 'tvdb_pin', label: 'TVDB PIN', kind: 'secret' }, { key: 'tmdb_api_key', label: 'TMDB API key', kind: 'secret' }, { key: 'fanart_api_key', label: 'Fanart.tv API key', kind: 'secret' }] },
  { title: 'Artwork', fields: [{ key: 'preferred_artwork_source', label: 'Preferred artwork provider', options: ['auto', 'tvdb', 'tmdb'] }, { key: 'fanart_enabled', label: 'Enable Fanart.tv', kind: 'boolean' }, { key: 'tmdb_artwork_enabled', label: 'Enable TMDB artwork', kind: 'boolean' }, { key: 'tvdb_artwork_languages', label: 'TVDB artwork languages (three-letter codes)', kind: 'list' }, { key: 'tmdb_artwork_languages', label: 'TMDB artwork languages (two-letter codes)', kind: 'list' }, { key: 'tvdb_artwork_allow_null_language', label: 'Allow TVDB artwork without a language', kind: 'boolean' }, { key: 'tmdb_artwork_allow_null_language', label: 'Allow TMDB artwork without a language', kind: 'boolean' }] },
  { title: 'Automation', fields: [{ key: 'watcher_enabled', label: 'Watcher enabled', options: ['null', 'true', 'false'], note: 'null uses the server environment default. The kill switch always takes precedence.' }, { key: 'watcher_debounce_seconds', label: 'Watcher debounce (seconds)', kind: 'number', note: 'Empty uses the server environment default.' }, { key: 'auto_sweep_orphans', label: 'Automatic orphan sweeps', kind: 'boolean', note: 'Enabling this authorizes automatic cleanup after successful builds. Each sweep captures and rechecks its candidates.' }] },
  { title: 'Rename templates', fields: [{ key: 'rename_enabled', label: 'Enable renaming', kind: 'boolean' }, ...(['rename_episode_template', 'rename_daily_template', 'rename_anime_template', 'rename_movie_template', 'rename_series_folder_template', 'rename_season_folder_template', 'rename_movie_folder_template'] as const).map(key => ({ key, label: key.replace('rename_', '').replaceAll('_', ' ') }))] },
  { title: 'Plex', fields: [{ key: 'plex_url', label: 'Plex URL' }, { key: 'plex_token', label: 'Plex token', kind: 'secret' }, { key: 'plex_path_mappings', label: 'Plex path mappings', kind: 'json', note: 'JSON list of local from paths and Plex to paths: [{"from":"/media","to":"/plex/media"}]' }, { key: 'plex_refresh_delay_seconds', label: 'Refresh delay (seconds)', kind: 'number' }, { key: 'plex_auto_refresh', label: 'Automatic Plex refresh', kind: 'boolean', disabled: true, note: 'Automatic refresh is not available yet. Use the manual refresh below.' }] },
];
function display(value: unknown, field: Field) { return field.kind === 'json' ? JSON.stringify(value, null, 2) : field.kind === 'list' ? (value as string[]).join(', ') : value === null ? field.options ? 'null' : '' : String(value ?? ''); }
function parse(value: string, field: Field): unknown {
  if (field.kind === 'json') { const mappings: unknown = JSON.parse(value); if (!Array.isArray(mappings) || mappings.some(row => !row || typeof row.from !== 'string' || typeof row.to !== 'string')) throw new Error('Use a JSON list with from and to strings.'); return mappings; }
  if (field.kind === 'list') return value.split(',').map(part => part.trim()).filter(Boolean);
  if (field.kind === 'boolean' || field.key === 'watcher_enabled') return value === 'null' ? null : value === 'true';
  if (field.kind === 'number') { if (!value.trim() && field.key === 'watcher_debounce_seconds') return null; if (!value.trim() || !Number.isFinite(Number(value))) throw new Error('Enter a valid number.'); return Number(value); }
  return value || (field.key === 'plex_url' ? null : value);
}
export function Settings() {
  const query = useQuery({ queryKey: ['settings'], queryFn: ({ signal }) => api.get<SettingsResponse>('/api/settings', {}, signal) }), { draft, setDraft } = useSettingsDraft(), confirm = useConfirm();
  return <><header className="page-heading"><div><h1>Settings</h1><p>Save individual fields. Drafts remain when you change views.</p></div>{Object.keys(draft).length > 0 && <div className="actions"><Badge tone="warning">{Object.keys(draft).length} unsaved fields</Badge><Button onClick={() => { void confirm({ title: 'Discard settings drafts?', body: <p>Discard all unsaved settings edits in this browser.</p>, action: 'Discard drafts' }).then(yes => { if (yes) setDraft({}); }); }}>Discard drafts</Button></div>}</header><QueryState query={query} label="settings">{data => <>{groups.map(group => <section className="panel" key={group.title}><h2>{group.title}</h2><div className="field-list">{group.fields.map(field => <SettingField key={field.key} field={field} settings={data} />)}</div></section>)}<LanguageReference /><PlexControls /><Schedules /><section className="panel"><h2>Provider cache</h2><DangerAction label="Clear provider cache" description="Discard the previewed cache entries. Later requests fetch fresh provider data." record={{ op: 'cache-clear' }} /></section><About /></>}</QueryState></>;
}
function SettingField({ field, settings }: { field: Field; settings: SettingsResponse }) {
  const { draft, setDraft } = useSettingsDraft(), action = useAction(), confirm = useConfirm(), client = useQueryClient();
  const saved = field.kind === 'secret' ? '' : display(settings[field.key as keyof SettingsResponse], field), value = draft[field.key] ?? saved;
  const dirty = draft[field.key] !== undefined;
  function change(value: string) { setDraft(current => { const next = { ...current }; if (value === saved) delete next[field.key]; else next[field.key] = value; return next; }); }
  return <form className="field-editor" onSubmit={event => { event.preventDefault(); const submitted = value; void action.run(async () => {
    const parsed = parse(submitted, field);
    if (field.key === 'auto_sweep_orphans' && parsed === true && !await confirm({ title: 'Enable automatic orphan cleanup?', body: <p>Authorize future post-build sweeps to remove orphan NFOs and thumbnails after capturing and rechecking each candidate set. This stays enabled until you turn it off.</p>, action: 'Enable automatic sweeps' })) return false;
    await api.send('/api/settings', { [field.key]: parsed } satisfies UpdateSettingsRequest);
    await client.invalidateQueries({ queryKey: ['settings'] });
    setDraft(current => { if (current[field.key] !== submitted) return current; const next = { ...current }; delete next[field.key]; return next; });
  }); }}>
    {field.options ? <Select label={field.label} value={value} disabled={field.disabled} onChange={event => change(event.target.value)}>{field.options.map(option => <option key={option} value={option}>{option === 'null' ? 'Environment default' : option}</option>)}</Select> : field.kind === 'boolean' ? <label><input type="checkbox" checked={value === 'true'} disabled={field.disabled} onChange={event => change(String(event.target.checked))} /> {field.label}</label> : field.kind === 'json' ? <label className="ui-field"><span>{field.label}</span><textarea className="ui-input" rows={4} value={value} onChange={event => change(event.target.value)} /></label> : <Input label={field.label} type={field.kind === 'secret' ? 'password' : field.kind === 'number' ? 'number' : 'text'} autoComplete={field.kind === 'secret' ? 'new-password' : undefined} value={value} onChange={event => change(event.target.value)} />}
    {field.note && <p className="muted">{field.note}</p>}{field.kind === 'secret' && <p>{settings[`${field.key as SettingsSecret}_configured`] ? 'Configured. Enter a replacement to change it.' : 'Not configured.'} Secret drafts stay in memory only.</p>}
    <div className="actions"><Button type="submit" disabled={!dirty || action.busy || field.disabled}>Save {field.label}</Button>{dirty && <><span role="status">Unsaved</span><Button disabled={action.busy} onClick={() => change(saved)}>Discard field edit</Button></>}</div>{action.feedback}
  </form>;
}
function LanguageReference() {
  const [open, setOpen] = useState(false), query = useQuery({ queryKey: ['artwork-languages'], queryFn: ({ signal }) => api.get<ArtworkLanguagesResponse>('/api/artwork/languages', {}, signal), enabled: open });
  return <details className="panel" onToggle={event => setOpen(event.currentTarget.open)}><summary>Available artwork language codes</summary>{open && <QueryState query={query} label="artwork languages">{data => <>{(['tvdb', 'tmdb'] as const).map(provider => <p key={provider}><strong>{provider.toUpperCase()}: </strong>{data[provider].map(language => `${language.name} (${language.code})`).join(', ')}</p>)}</>}</QueryState>}</details>;
}
function PlexControls() {
  const action = useAction(), [test, setTest] = useState<PlexTestResponse | null>(null), [sections, setSections] = useState<PlexSectionsResponse | null>(null), [path, setPath] = useState(''), [result, setResult] = useState<PlexRefreshResponse | null>(null);
  return <section className="panel"><h2>Plex connection</h2><div className="actions"><Button disabled={action.busy} onClick={() => void action.run(async () => { const value = await api.get<PlexTestResponse>('/api/plex/test'); setTest(value); if (!value.ok) throw new Error(value.error || 'Plex connection failed.'); }, 'Connection test finished.')}>Test connection</Button><Button disabled={action.busy} onClick={() => void action.run(async () => { setSections(await api.get<PlexSectionsResponse>('/api/plex/sections')); }, 'Sections loaded.')}>List Plex sections</Button></div>{test?.ok && <p>Connected: {test.identity?.friendly_name ?? 'Plex'} {test.identity?.version}</p>}{sections && <ul>{sections.sections.map(section => <li key={section.id}>{section.title} · {section.type} · {section.locations.join(', ')}</li>)}</ul>}<form className="actions" onSubmit={event => { event.preventDefault(); void action.run(async () => { const value = await api.send<PlexRefreshResponse>('/api/plex/refresh', { path }); setResult(value); if (value.error) throw new Error(value.error); }, 'Refresh request finished.'); }}><Input label="Local folder to refresh in Plex" value={path} onChange={event => setPath(event.target.value)} /><Button type="submit" disabled={action.busy || !path.trim()}>Refresh folder</Button></form>{result && <p>{result.section_title}: {result.refreshed ? 'Refresh requested' : 'No refresh'} · {result.translated_path}</p>}{action.feedback}</section>;
}
function About() {
  const query = useQuery({ queryKey: ['version'], queryFn: ({ signal }) => api.get<VersionResponse>('/api/version', {}, signal) });
  return <section className="panel"><h2>About</h2><QueryState query={query} label="version">{value => <p>{value.name} · {value.version} · <a href={`https://github.com/${value.repo}`} target="_blank" rel="noreferrer">Project repository</a></p>}</QueryState></section>;
}
