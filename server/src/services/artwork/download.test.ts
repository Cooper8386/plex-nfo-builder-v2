import { lstat, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, expect, test, vi } from 'vitest';
import { withSandbox } from '../../../tests/support/sandbox.js';
import * as providerHttp from '../providers/http.js';
import { downloadArtwork, saveArtwork, writeArtwork } from './download.js';

afterEach(() => vi.restoreAllMocks());

test('artwork streams to a sibling part and replaces the original only after completion', async () => withSandbox(async box => {
  const path = join(box.media, 'poster.jpg');
  await writeFile(path, 'original');
  let markStarted!: () => void;
  let resumeStream!: () => void;
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  const resume = new Promise<void>(resolve => { resumeStream = resolve; });
  async function* source() {
    yield Buffer.from('first');
    markStarted();
    await resume;
    yield Buffer.from('second');
  }
  const pending = writeArtwork(path, source());
  try {
    await started;
    expect(await readFile(path, 'utf8')).toBe('original');
    const parts = (await readdir(box.media)).filter(name => name.endsWith('.part'));
    expect(parts).toHaveLength(1);
    expect(await readFile(join(box.media, parts[0]!), 'utf8')).toBe('first');
  } finally { resumeStream(); await pending; }
  expect(await readFile(path, 'utf8')).toBe('firstsecond');
  expect(await readdir(box.media)).toEqual(['poster.jpg']);
}));

test('artwork stream failure preserves original bytes and removes partial files', async () => withSandbox(async box => {
  const path = join(box.media, 'poster.jpg');
  await writeFile(path, 'original');
  async function* source() {
    yield Buffer.from('partial');
    throw new Error('Disconnected');
  }
  await expect(writeArtwork(path, source())).rejects.toThrow('Disconnected');
  expect(await readFile(path, 'utf8')).toBe('original');
  expect(await readdir(box.media)).toEqual(['poster.jpg']);
}));

test('artwork rejects empty and oversized streams but accepts the exact byte limit', async () => withSandbox(async box => {
  const path = join(box.media, 'poster.jpg');
  await writeFile(path, 'original');
  await expect(writeArtwork(path, Readable.from([]), 4)).rejects.toThrow('Empty image');
  await expect(writeArtwork(path, Readable.from([Buffer.from('12'), Buffer.from('345')]), 4)).rejects.toThrow('Artwork too large');
  expect(await readFile(path, 'utf8')).toBe('original');
  expect(await readdir(box.media)).toEqual(['poster.jpg']);
  await writeArtwork(path, Readable.from([Buffer.from('12'), Buffer.from('34')]), 4);
  expect(await readFile(path, 'utf8')).toBe('1234');
}));

test('artwork real downloader blocks loopback before opening an HTTP connection', async () => withSandbox(async box => {
  const plain = vi.spyOn(http, 'request');
  const secure = vi.spyOn(https, 'request');
  for (const url of ['http://127.0.0.1/poster.jpg', 'https://[::1]/poster.jpg', 'http://169.254.169.254/latest/meta-data/']) {
    await expect(downloadArtwork(url, join(box.media, 'poster.jpg'))).rejects.toThrow('Unsafe URL address');
  }
  expect(plain).not.toHaveBeenCalled();
  expect(secure).not.toHaveBeenCalled();
  expect(await readdir(box.media)).toEqual([]);
}));

test('artwork downloader writes successful image responses and rejects HTTP errors and unsupported types', async () => withSandbox(async box => {
  const stream = (statusCode: number, type: string, body: string) => Object.assign(Readable.from([Buffer.from(body)]),
    { statusCode, headers: { 'content-type': type } }) as unknown as IncomingMessage;
  const response = stream(200, 'image/jpeg; charset=binary', 'image bytes');
  const fetch = vi.spyOn(providerHttp, 'responseStream').mockResolvedValue(response);
  const path = join(box.media, 'poster.jpg');
  await downloadArtwork('https://example.com/poster.jpg', path);
  expect(await readFile(path, 'utf8')).toBe('image bytes');
  expect(response.destroyed).toBe(true);
  const failed = stream(404, 'image/jpeg', 'missing');
  fetch.mockResolvedValueOnce(failed);
  await expect(downloadArtwork('https://example.com/missing.jpg', path)).rejects.toThrow('HTTP 404');
  expect(failed.destroyed).toBe(true);
  const html = stream(200, 'text/html', '<html>');
  fetch.mockResolvedValueOnce(html);
  await expect(downloadArtwork('https://example.com/html', path)).rejects.toThrow('Unsupported image type');
  expect(html.destroyed).toBe(true);
  expect(await readFile(path, 'utf8')).toBe('image bytes');
  expect(await readdir(box.media)).toEqual(['poster.jpg']);
}));

test('artwork replacement replaces an existing file symlink without changing its target', async () => withSandbox(async box => {
  const target = join(box.config, 'original.jpg');
  const path = join(box.media, 'poster.jpg');
  await writeFile(target, 'outside original');
  await symlink(target, path, 'file');
  await saveArtwork(path, Buffer.from('new portrait'));
  expect(await readFile(target, 'utf8')).toBe('outside original');
  expect(await readFile(path, 'utf8')).toBe('new portrait');
  expect((await lstat(path)).isSymbolicLink()).toBe(false);
  expect(await readdir(box.media)).toEqual(['poster.jpg']);
}));
