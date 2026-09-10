// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Link, Routes, Route } from 'react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Item, LibraryListEntry, ArtworkCandidatesResponse, SettingsResponse, Settings, ItemDetailResponse } from 'shared';
import { Library } from './Library.js';
import { Artwork } from './Artwork.js';
import { Settings as SettingsView, SettingsDraftProvider } from './Settings.js';
import { ConfirmProvider, useConfirm } from '../components/ConfirmDialog.js';
import { api } from '../lib/api.js';
import { settingsSchema } from '../../../server/src/config/settings.js';
import { useAction } from './common.js';
import { Detail } from './Detail.js';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks(); });
function wrapper(children: React.ReactNode, path = '/libraries/TV') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const result = render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><SettingsDraftProvider><ConfirmProvider>{children}</ConfirmProvider></SettingsDraftProvider></MemoryRouter></QueryClientProvider>);
  return { ...result, client };
}
const library: LibraryListEntry = { name: 'TV', kind: 'tv', enabled: 1, detected_at: 1, metadata_source: 'tvdb', effective_metadata_source: 'tvdb' };
function item(title: string, selected: number[]): Item {
  return { folder_path: `/media/TV/${title}`, library: 'TV', kind: 'series', title, year: 2020, external_id: '1', provider: 'tvdb', nfo_status: 'complete', episode_count_local: 2, episode_count_tvdb: 2, season_count_local: 2, last_scanned: 1, last_built: 1, poster_path: null, sort_title: title, orphan_count: 0, date_added: 1, date_updated: 1, season_poster_progress: { state: selected.length === 2 ? 'selected' : selected.length ? 'in_progress' : 'not_started', selected_seasons: selected, required_seasons: [1, 2], missing_seasons: [1, 2].filter(value => !selected.includes(value)), unresolved_files: [] } };
}
test('optional season filter separates saved selections, preserves partial progress and stays inside the panel', async () => {
  const user = userEvent.setup(), rows = [item('Selected Show', [1, 2]), item('Partial Show', [1]), item('New Show', [])];
  vi.spyOn(api, 'items').mockImplementation(async query => ({ items: rows.filter(row => query.poster_selection === 'selected' ? row.season_poster_progress!.state === 'selected' : query.poster_selection === 'needs_selection' ? row.season_poster_progress!.state !== 'selected' : true) }));
  const { client } = wrapper(<Library library={library} />);
  await screen.findByRole('link', { name: /Selected Show/ });
  expect(screen.queryByLabelText('Season posters')).toBeNull();expect(screen.queryByText('In progress')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Filters' }));
  const panel = within(screen.getByRole('region', { name: 'Library filters' }));
  await user.click(panel.getByText('Selection details'));
  expect(panel.getByText('In progress')).toBeTruthy();expect(panel.getByText('1/2 seasons selected')).toBeTruthy();expect(panel.getByText('Missing: Season 2')).toBeTruthy();
  await user.selectOptions(panel.getByLabelText('Season posters'), 'selected');
  await waitFor(() => expect(screen.queryByRole('link', { name: /Partial Show/ })).toBeNull());
  expect(screen.getByRole('link', { name: /Selected Show/ })).toBeTruthy();
  await user.selectOptions(panel.getByLabelText('Season posters'), 'needs_selection');
  await screen.findByRole('link', { name: /Partial Show/ });expect(screen.queryByRole('link', { name: /Selected Show/ })).toBeNull();
  expect(panel.getByText('In progress')).toBeTruthy();
  rows[0]!.season_poster_progress = { state: 'in_progress', selected_seasons: [1, 2], required_seasons: [1, 2, 3], missing_seasons: [3], unresolved_files: [] };
  await act(() => client.invalidateQueries({ queryKey: ['items'] }));
  await screen.findByRole('link', { name: /Selected Show/ });expect(panel.getByText('Missing: Season 3')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Filters' }));expect(screen.queryByLabelText('Season posters')).toBeNull();expect(screen.queryByText('In progress')).toBeNull();
});
test('manual season choices remain editable in Artwork and update progress', async () => {
  const user = userEvent.setup();
  const data: ArtworkCandidatesResponse = { path: '/media/TV/Show', selections: [{ slot: 'season-01-poster', url: 'https://example.com/one.jpg', language: null, score: null }], season_poster_progress: item('Show', [1]).season_poster_progress!, warnings: [], candidates: { 'season-02-poster': [{ provider: 'tvdb', id: '2', slot: 'season-02-poster', url: 'https://example.com/two.jpg', thumb: null, language: 'eng', score: 1, width: 600, height: 900, season: 2 }] } };
  vi.spyOn(api, 'get').mockImplementation(async path => path === '/api/artwork/candidates' ? structuredClone(data) : { items: [] });
  const send = vi.spyOn(api, 'send').mockImplementation(async (_path, body) => { const choice = body as { slot: string; url?: string }; if (choice.url) { data.selections.push({ slot: choice.slot, url: choice.url, language: null, score: null }); data.season_poster_progress = item('Show', [1, 2]).season_poster_progress!; } else { data.selections = data.selections.filter(row => row.slot !== choice.slot); data.season_poster_progress = item('Show', [1]).season_poster_progress!; } return { ok: true }; });
  wrapper(<Artwork path={data.path} bound />);
  await screen.findByText('In progress');await user.selectOptions(screen.getByLabelText('Artwork slot'), 'season-02-poster');
  await user.click(screen.getByRole('button', { name: /TVDB season-02-poster/ }));
  await screen.findByText('Selected');expect(send).toHaveBeenCalledWith('/api/artwork/select', { folder_path: data.path, slot: 'season-02-poster', url: 'https://example.com/two.jpg' });
  await user.click(screen.getByRole('button', { name: /No selection/ }));await screen.findByText('In progress');
});
test('confirm focuses Cancel, traps Tab both ways, and resolves a replaced confirmation as cancelled', async () => {
  const user = userEvent.setup(), first = vi.fn(), second = vi.fn();
  function Harness() { const confirm = useConfirm(); return <><button onClick={() => void confirm({ title: 'First deletion', body: <p>First target</p>, action: 'Delete first' }).then(first)}>First</button><button onClick={() => void confirm({ title: 'Second deletion', body: <p>Second target</p>, action: 'Delete second' }).then(second)}>Second</button></>; }
  wrapper(<Harness />);
  await user.click(screen.getByRole('button', { name: 'First' }));expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  await user.tab({ shift: true });expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete first' }));
  await user.tab();expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Second' }));await waitFor(() => expect(first).toHaveBeenCalledWith(false));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));expect(second).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Delete second' }));expect(second).toHaveBeenCalledWith(true);
});
test('a failed library query exposes error and Retry loads the view', async () => {
  const user = userEvent.setup();vi.spyOn(api, 'items').mockRejectedValueOnce(new Error('Media unavailable')).mockResolvedValue({ items: [item('Recovered', [])] });
  wrapper(<Library library={library} />);expect(await screen.findByRole('alert')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Retry' }));expect(await screen.findByRole('link', { name: /Recovered/ })).toBeTruthy();
});
test('unbound item matching defaults to its library provider and allows an explicit choice', async()=>{
  const user=userEvent.setup(),state=item('Unbound',[]);
  const detail:ItemDetailResponse={path:state.folder_path,binding:null,state,artwork_files:[],overrides:{},provider_episode_count:null,provider_used:null,tags:{tvdb:[],tmdb:[],custom:[]},library_kind:'tv',season_poster_progress:state.season_poster_progress!};
  vi.spyOn(api,'get').mockResolvedValue(detail);vi.spyOn(api,'libraries').mockResolvedValue({libraries:[{...library,effective_metadata_source:'tmdb'}]});
  wrapper(<Detail/>,`/items?${new URLSearchParams({path:state.folder_path})}`);
  const provider=await screen.findByLabelText('Provider');await waitFor(()=>expect((provider as HTMLSelectElement).value).toBe('tmdb'));
  await user.selectOptions(provider,'tvdb');expect((provider as HTMLSelectElement).value).toBe('tvdb');
});
test('cancelling an action restores its trigger without mutation or success feedback', async () => {
  const user=userEvent.setup(),mutate=vi.fn();
  function Harness(){const confirm=useConfirm(),action=useAction();return <><button disabled={action.busy} onClick={()=>void action.run(async()=>{if(!await confirm({title:'Delete target?',body:<p>Captured target</p>}))return false;mutate();})}>Delete target</button>{action.feedback}</>;}
  wrapper(<Harness/>);
  const trigger=screen.getByRole('button',{name:'Delete target'});
  await user.click(trigger);await user.click(screen.getByRole('button',{name:'Cancel'}));
  await waitFor(()=>expect(document.activeElement).toBe(trigger));
  expect(mutate).not.toHaveBeenCalled();expect(screen.queryByRole('status')).toBeNull();
});
test('settings retain drafts across navigation and refresh, save only the edited field, and keep newer edits during save', async () => {
  const user = userEvent.setup();const { tvdb_api_key: _a, tvdb_pin: _b, tmdb_api_key: _c, fanart_api_key: _d, plex_token: _e, ...settings } = settingsSchema.parse({});void [_a, _b, _c, _d, _e];
  const data: SettingsResponse = { ...settings, preferred_artwork_source: 'auto', tvdb_api_key_configured: false, tvdb_pin_configured: false, tmdb_api_key_configured: false, fanart_api_key_configured: false, plex_token_configured: false };
  vi.spyOn(api, 'get').mockImplementation(async path => path === '/api/settings' ? { ...data } : path === '/api/schedules' ? { schedules: [] } : path === '/api/version' ? { name: 'App', version: '0.21.0', repo: 'owner/repo' } : { items: [] });
  vi.spyOn(api, 'libraries').mockResolvedValue({ libraries: [] });
  let finish: (() => void) | undefined;
  const send = vi.spyOn(api, 'send').mockImplementation(async (_path, patch) => { await new Promise<void>(resolve => { finish = resolve; }); Object.assign(data, patch as Partial<Settings>); return { ok: true }; });
  const { client } = wrapper(<><Link to="/settings">Settings page</Link><Link to="/elsewhere">Elsewhere</Link><Routes><Route path="/settings" element={<SettingsView />} /><Route path="/elsewhere" element={<p>Other view</p>} /></Routes></>, '/settings');
  const input = await screen.findByLabelText('Preferred language');await user.clear(input);await user.type(input, 'fra');
  await user.click(screen.getByRole('link', { name: 'Elsewhere' }));await user.click(screen.getByRole('link', { name: 'Settings page' }));
  expect((await screen.findByLabelText('Preferred language') as HTMLInputElement).value).toBe('fra');
  data.cache_ttl_hours = 72;await act(() => client.invalidateQueries({ queryKey: ['settings'] }));
  expect((screen.getByLabelText('Preferred language') as HTMLInputElement).value).toBe('fra');
  await user.click(screen.getByRole('button', { name: 'Save Preferred language' }));await waitFor(() => expect(send).toHaveBeenCalledWith('/api/settings', { preferred_language: 'fra' }));
  await user.clear(screen.getByLabelText('Preferred language'));await user.type(screen.getByLabelText('Preferred language'), 'deu');
  await act(async () => { finish!(); });await waitFor(() => expect((screen.getByLabelText('Preferred language') as HTMLInputElement).value).toBe('deu'));
  await user.click(screen.getByRole('button', { name: 'Discard drafts' }));await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard drafts' }));
  await waitFor(() => expect((screen.getByLabelText('Preferred language') as HTMLInputElement).value).toBe('fra'));
});
