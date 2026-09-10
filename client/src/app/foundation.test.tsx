// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { afterEach, expect, test, vi } from 'vitest';
import { AuthGate } from './AuthGate.js';
import { ErrorBoundary } from './ErrorBoundary.js';
import { QueryState } from './QueryState.js';
import { queryClient } from './query-client.js';
import { api } from '../lib/api.js';
import { clearToken, getToken, setToken } from '../lib/auth.js';

afterEach(() => { cleanup(); clearToken(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const reply = (status: number, data: object) => new Response(JSON.stringify(data), { status });

test('a failed query shows its error and Retry recovers data', async () => {
  let attempts = 0;
  const queryFn = vi.fn(async () => { if (++attempts === 1) throw new Error('Media mount unavailable'); return ['Example library']; });
  function Screen() {
    const query = useQuery({ queryKey: ['retry-proof'], queryFn });
    return <QueryState query={query} label="libraries">{data => <p>{data.join(', ')}</p>}</QueryState>;
  }
  render(<QueryClientProvider client={queryClient}><Screen /></QueryClientProvider>);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByText('Media mount unavailable')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('Example library')).toBeTruthy();
  expect(queryFn).toHaveBeenCalledTimes(2);
  await queryClient.invalidateQueries({ queryKey: ['retry-proof'] });
  queryFn.mockRejectedValueOnce(new Error('Connection lost during refresh'));
  await queryClient.invalidateQueries({ queryKey: ['retry-proof'] });
  expect(await screen.findByText('Connection lost during refresh')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
});

test('the error boundary catches render failure and can retry the screen', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  let fail = true;
  function Screen() { if (fail) throw new Error('Render failed'); return <p>Screen restored</p>; }
  render(<ErrorBoundary><Screen /></ErrorBoundary>);
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Reload application' })).toBeTruthy();
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Retry screen' }));
  expect(screen.getByText('Screen restored')).toBeTruthy();
});

test('auth distinguishes missing server configuration from missing token, clears cache, and recovers an expired token', async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(reply(503, { detail: 'API_TOKEN must be configured' }))
    .mockResolvedValueOnce(reply(401, { detail: 'API token required' }))
    .mockResolvedValueOnce(reply(200, { ok: true }))
    .mockResolvedValueOnce(reply(401, { detail: 'Invalid API token' }))
    .mockResolvedValueOnce(reply(200, { ok: true }));
  vi.stubGlobal('fetch', fetcher);
  render(<QueryClientProvider client={queryClient}><AuthGate><p>Private library</p></AuthGate></QueryClientProvider>);
  expect(await screen.findByText('Server setup required')).toBeTruthy();
  expect(screen.queryByLabelText('API token')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry connection' }));
  expect(await screen.findByText('An API token is required to connect.')).toBeTruthy();
  queryClient.setQueryData(['old-library'], { title: 'Previous session' });
  fireEvent.change(screen.getByLabelText('API token'), { target: { value: 'correct&token' } });
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
  expect(await screen.findByText('Private library')).toBeTruthy();
  expect(getToken()).toBe('correct&token');
  expect(queryClient.getQueryData(['old-library'])).toBeUndefined();
  expect(fetcher.mock.calls[2]?.[1].headers).toMatchObject({ 'x-api-token': 'correct&token' });
  await expect(api.libraries()).rejects.toThrow('Invalid API token');
  expect(await screen.findByText('The API token was not accepted. Enter a valid token to reconnect.')).toBeTruthy();
  expect(screen.queryByText('Private library')).toBeNull();
  fireEvent.change(screen.getByLabelText('API token'), { target: { value: 'replacement' } });
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
  expect(await screen.findByText('Private library')).toBeTruthy();
});

test('stored-token network failure offers a working connection retry', async () => {
  setToken('saved-token');
  const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('Network failure')).mockResolvedValueOnce(reply(200, { ok: true }));
  vi.stubGlobal('fetch', fetcher);
  render(<QueryClientProvider client={queryClient}><AuthGate><p>Connected</p></AuthGate></QueryClientProvider>);
  expect(await screen.findByText('Unable to reach the server. Check your connection and retry.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Retry connection' }));
  await waitFor(() => expect(screen.getByText('Connected')).toBeTruthy());
  expect(fetcher.mock.calls[1]?.[1].headers).toMatchObject({ 'x-api-token': 'saved-token' });
});
