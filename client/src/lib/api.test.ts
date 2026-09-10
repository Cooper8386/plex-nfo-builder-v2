// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { api, ApiError, authenticatedImageUrl } from './api.js';
import { clearToken, setToken, unauthorizedEvent } from './auth.js';

afterEach(() => { clearToken(); vi.unstubAllGlobals(); vi.useRealTimers(); });

test('JSON requests use the token header and encode query fields; image URLs encode tokens only on API paths', async () => {
  const token = 'A&B?# /東京';
  setToken(token);
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 }));
  vi.stubGlobal('fetch', fetcher);
  await api.items({ library: 'Movies & TV', q: 'A/B?', hide_organized: false });
  const [url, options] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
  expect(url.searchParams.get('library')).toBe('Movies & TV');
  expect(url.searchParams.get('q')).toBe('A/B?');
  expect(url.searchParams.get('hide_organized')).toBe('false');
  expect(url.searchParams.has('api_token')).toBe(false);
  expect(options.headers).toMatchObject({ 'x-api-token': token });
  const image = new URL(authenticatedImageUrl('/api/image', { path: '/TV/A & B/poster.jpg' }), window.location.origin);
  expect(image.searchParams.get('api_token')).toBe(token);
  expect(image.searchParams.get('path')).toBe('/TV/A & B/poster.jpg');
  for (const path of ['https://example.com/api/image', '//example.com/api/image', '/api/../elsewhere']) expect(() => authenticatedImageUrl(path)).toThrow('same-origin');
});

test('API failures retain status and cancellation/timeout end pending requests', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: 'Invalid API token' }), { status: 401 })));
  await expect(api.health()).rejects.toEqual(new ApiError(401, 'Invalid API token'));
  vi.stubGlobal('fetch', vi.fn((_url: URL, options: RequestInit) => new Promise((_resolve, reject) => {
    options.signal?.addEventListener('abort', () => reject(options.signal?.reason));
  })));
  const controller = new AbortController();
  const cancelled = api.health(controller.signal);
  const cancellation = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await cancellation;
  vi.useFakeTimers();
  const timeout = expect(api.health()).rejects.toThrow('too long');
  await vi.advanceTimersByTimeAsync(30_000);
  await timeout;
});

test('a cancelled 401 body cannot invalidate a replacement session', async () => {
  const unauthorized = vi.fn();
  window.addEventListener(unauthorizedEvent, unauthorized);
  let rejectBody!: (reason: unknown) => void;
  const json = vi.fn(() => new Promise((_resolve, reject) => { rejectBody = reject; }));
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json })));
  try {
    setToken('saved-token');
    const controller = new AbortController();
    const pending = expect(api.health(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(json).toHaveBeenCalled());
    controller.abort();
    setToken('saved-token');
    rejectBody(controller.signal.reason);
    await pending;
    expect(unauthorized).not.toHaveBeenCalled();
  } finally { window.removeEventListener(unauthorizedEvent, unauthorized); }
});
