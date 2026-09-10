import type { HealthResponse, ItemsQuery, ItemsResponse, LibrariesResponse } from 'shared';
import { getToken, requireAuthentication } from './auth.js';

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = 'ApiError'; }
}

function apiUrl(path: string, params: Record<string, string> = {}) {
  const url = new URL(path, window.location.origin);
  if (!path.startsWith('/api/') || url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) throw new Error('Expected a same-origin API path');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

export function authenticatedImageUrl(path: string, params: Record<string, string> = {}) {
  const url = apiUrl(path, params);
  url.searchParams.set('api_token', getToken());
  return url.pathname + url.search;
}

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const token = getToken();
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = window.setTimeout(() => controller.abort(new Error('The server took too long to respond. Please retry.')), 30_000);
  try {
    const response = await fetch(apiUrl(path), { headers: { 'x-api-token': token, Accept: 'application/json' }, signal: controller.signal });
    const data: unknown = await response.json().catch(() => null);
    controller.signal.throwIfAborted();
    if (!response.ok) {
      if (response.status === 401 && getToken() === token) requireAuthentication();
      const detail = data && typeof data === 'object' && 'detail' in data && typeof data.detail === 'string' ? data.detail : `The server returned an error (${response.status}).`;
      throw new ApiError(response.status, detail);
    }
    if (data === null) throw new ApiError(response.status, 'The server returned an unreadable response. Please retry.');
    return data as T;
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    if (error instanceof ApiError) throw error;
    throw new Error('Unable to reach the server. Check your connection and retry.', { cause: error });
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export const api = {
  health: (signal?: AbortSignal) => request<HealthResponse>('/api/health', signal),
  libraries: (signal?: AbortSignal) => request<LibrariesResponse>('/api/libraries', signal),
  items: (query: ItemsQuery, signal?: AbortSignal) => {
    const params = Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
    const url = apiUrl('/api/items', params);
    return request<ItemsResponse>(url.pathname + url.search, signal);
  },
};
