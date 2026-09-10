// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Shell } from '../app/Shell.js';
import { api } from '../lib/api.js';
import { libraryUrl } from './index.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); delete document.documentElement.dataset.theme; });
beforeEach(()=>{vi.spyOn(window,'scrollTo').mockImplementation(()=>{});});

function renderAt(path: string, name = 'TV & Anime') {
  vi.spyOn(api, 'health').mockResolvedValue({ ok: true, version: '0.12.0', media_root: '/media', tvdb_configured: true, tmdb_configured: false, fanart_configured: false, metadata_source: 'tvdb', plex_configured: false, plex_auto_refresh: false });
  vi.spyOn(api, 'libraries').mockResolvedValue({ libraries: [{ name, kind: 'tv', enabled: 1, detected_at: 1, metadata_source: null, effective_metadata_source: 'tvdb' }] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Shell /></MemoryRouter></QueryClientProvider>);
}

test('a linked library opens directly, renders real items, and navigates back to the directory', async () => {
  const user = userEvent.setup();
  const items = vi.spyOn(api, 'items').mockResolvedValue({ items: [{ folder_path: '/media/TV & Anime/Arrival', library: 'TV & Anime', kind: 'series', title: 'Arrival', year: 2024, external_id: '42', provider: 'tvdb', nfo_status: 'complete', episode_count_local: 8, episode_count_tvdb: 8, season_count_local: 1, last_scanned: 1, last_built: null, poster_path: null, sort_title: 'Arrival', orphan_count: 0, date_added: 1, date_updated: 1 }] });
  renderAt(libraryUrl('TV & Anime'));
  const main = within(screen.getByRole('main'));
  expect(await main.findByRole('heading', { level: 1, name: 'TV & Anime' })).toBeTruthy();
  expect(await main.findByRole('link', { name: /Arrival/ })).toBeTruthy();
  await user.click(main.getByRole('button', { name: 'List' }));
  expect(await main.findByRole('rowheader', { name: /Arrival/ })).toBeTruthy();
  expect(main.getAllByText('Complete').length).toBeGreaterThan(0);
  expect(items).toHaveBeenCalledWith({ library: 'TV & Anime' }, expect.any(AbortSignal));
  await user.click(main.getByRole('link', { name: 'All libraries' }));
  expect(await main.findByRole('heading', { name: 'Your libraries' })).toBeTruthy();
  expect(main.getByRole('link', { name: /TV & Anime/ }).getAttribute('href')).toBe('/libraries/TV%20%26%20Anime');
});

test('unknown paths and unknown libraries render a not-found route', async () => {
  const view = renderAt('/not-a-page');
  expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Your libraries' })).toBeNull();
  view.unmount();
  renderAt('/libraries/absent');
  expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy();
});

test('library names containing URL escape text round-trip without double decoding', async () => {
  const name = 'Anime %2F %25';
  const items = vi.spyOn(api, 'items').mockResolvedValue({ items: [] });
  renderAt(libraryUrl(name), name);
  expect(await screen.findByRole('heading', { name })).toBeTruthy();
  expect(items).toHaveBeenCalledWith({ library: name }, expect.any(AbortSignal));
});

test('theme and mobile navigation controls work with keyboard input', async () => {
  const user = userEvent.setup();
  renderAt('/libraries');
  await screen.findByRole('heading', { name: 'Your libraries' });
  await user.click(screen.getByRole('button', { name: 'Theme: system' }));
  await user.click(screen.getByRole('menuitem', { name: 'Dark' }));
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(localStorage.getItem('plex-nfo-theme')).toBe('dark');
  const toggle = screen.getByRole('button', { name: 'Libraries' });
  await user.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  await user.keyboard('{Escape}');
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(toggle);
});
