import http from 'node:http';
import https from 'node:https';
import { setTimeout as sleep } from 'node:timers/promises';
import type Database from 'better-sqlite3';
import { readCache, writeCache } from '../../db/queries.js';
import { guardUrl } from './ssrf.js';

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 8, maxTotalSockets: 16 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 8, maxTotalSockets: 16 });
export interface HttpReply { status: number; headers: Record<string, string>; body: Buffer }
export interface RequestOptions { method?: string; headers?: Record<string, string>; body?: string }
export type Transport = (url: string, options: RequestOptions) => Promise<HttpReply>;
// Validate every hop and pin the validated DNS answer for the actual connection.
export async function responseStream(value: string, options: RequestOptions = {}): Promise<http.IncomingMessage> {
  let current = value, headers = { ...options.headers };
  for (let hop = 0; hop < 6; hop++) {
    const { url, addresses } = await guardUrl(current);
    const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const req = (url.protocol === 'https:' ? https : http).request(url, {
        agent: url.protocol === 'https:' ? httpsAgent : httpAgent, method: options.method ?? 'GET', headers,
        lookup: (_hostname, opts, callback) => opts.all ? callback(null, addresses) : callback(null, addresses[0]!.address, addresses[0]!.family),
      }, resolve);
      const timer = setTimeout(() => req.destroy(new Error('Provider request timed out')), 30_000);
      req.on('close', () => clearTimeout(timer)); req.on('error', reject);
      req.end(options.body);
    });
    if (![301,302,303,307,308].includes(response.statusCode ?? 502)) return response;
    response.destroy();
    if (!response.headers.location || options.method === 'POST') throw new Error('Unexpected provider redirect');
    const next = new URL(response.headers.location, url);
    if (next.origin !== url.origin) headers = { Accept: headers.Accept ?? 'application/json' };
    current = next.href;
  }
  throw new Error('Too many provider redirects');
}
export const transport: Transport = async (value, options) => {
  const response = await responseStream(value, options), chunks: Buffer[] = []; let size = 0;
  for await (const chunk of response) {
    const data = Buffer.from(chunk as Uint8Array); size += data.length;
    if (size > 32 * 1024 * 1024) throw new Error('Provider response too large');
    chunks.push(data);
  }
  return {status:response.statusCode ?? 502,headers:Object.fromEntries(Object.entries(response.headers).map(([key,val])=>[key,Array.isArray(val)?val.join(','):val??''])),body:Buffer.concat(chunks)};
};
export class ProviderError extends Error { constructor(public status: number) { super(`Provider returned HTTP ${status}`); } }
export interface JsonOptions extends RequestOptions { force?: boolean; ttl?: number; cache404?: number; cache?: boolean }
export function retryDelay(header: string | undefined, attempt: number) {
  if (header?.trim()) {
    const seconds = Number(header), value = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
    if (Number.isFinite(value)) return Math.max(0, value);
  }
  return 500 * 2 ** attempt;
}
// Construct inside an application worker: this connection owns all cache I/O.
export class ProviderHttp {
  constructor(private db: Database.Database, private ttl = 168 * 3600, private send: Transport = transport, private wait: (ms: number) => Promise<unknown> = sleep) {}
  async request(url: string, options: RequestOptions = {}) {
    for (let attempt = 0; attempt < 3; attempt++) {
      let response: HttpReply;
      try { response = await this.send(url, options); }
      catch (error) { if (attempt === 2) throw error; await this.wait(retryDelay(undefined, attempt)); continue; }
      if (attempt < 2 && (response.status === 429 || response.status >= 500)) { await this.wait(retryDelay(response.headers['retry-after'], attempt)); continue; }
      return response;
    }
    throw new Error('Provider request failed');
  }
  async json(url: string, options: JsonOptions = {}): Promise<unknown> {
    const keyUrl = new URL(url); for (const key of ['api_key','apikey','pin','X-Plex-Token']) keyUrl.searchParams.delete(key);
    keyUrl.searchParams.sort(); const key = keyUrl.href;
    const cache = options.cache !== false && (!options.method || options.method === 'GET');
    if (cache && !options.force) { const cached = readCache(this.db, key); if (cached !== null) return cached; }
    const response = await this.request(url, options);
    if (response.status === 404 && options.cache404 !== undefined) {
      if (cache) writeCache(this.db, key, {}, options.cache404); return {};
    }
    if (response.status < 200 || response.status >= 300) throw new ProviderError(response.status);
    const data: unknown = response.body.length ? JSON.parse(response.body.toString('utf8')) : {};
    if (cache) writeCache(this.db, key, data, options.ttl ?? this.ttl); return data;
  }
}
export function apiUrl(base: string, path: string, query: Record<string, string | number | undefined> = {}) {
  const url = new URL(base.replace(/\/$/, '') + path);
  for (const [key, val] of Object.entries(query)) if (val !== undefined) url.searchParams.set(key, String(val));
  return url.href;
}
