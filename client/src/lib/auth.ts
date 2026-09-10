import { useSyncExternalStore } from 'react';
import { queryClient } from '../app/query-client.js';

const tokenKey = 'plex-nfo-builder.api-token';
const tokenEvent = 'plex-nfo-builder:token';
export const unauthorizedEvent = 'plex-nfo-builder:unauthorized';
let revision = 0;
let memoryToken: string | undefined;

export function getToken() {
  if (memoryToken !== undefined) return memoryToken;
  try { return localStorage.getItem(tokenKey) ?? ''; }
  catch { return ''; }
}

function changed() {
  queryClient.clear();
  revision++;
  window.dispatchEvent(new Event(tokenEvent));
}

export function setToken(token: string) {
  memoryToken = token;
  try {
    if (token) localStorage.setItem(tokenKey, token); else localStorage.removeItem(tokenKey);
    memoryToken = undefined;
  }
  catch { /* Browser storage may be disabled; this session can still connect. */ }
  changed();
}

export function clearToken() { setToken(''); }
export function requireAuthentication() { window.dispatchEvent(new Event(unauthorizedEvent)); }

function subscribe(listener: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === tokenKey || event.key === null) { memoryToken = undefined; changed(); }
  };
  window.addEventListener(tokenEvent, listener);
  window.addEventListener('storage', storage);
  return () => { window.removeEventListener(tokenEvent, listener); window.removeEventListener('storage', storage); };
}

export function useAuthRevision() { return useSyncExternalStore(subscribe, () => revision, () => 0); }
export function useToken() { useAuthRevision(); return getToken(); }
