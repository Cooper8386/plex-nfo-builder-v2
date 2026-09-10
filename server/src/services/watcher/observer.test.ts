import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { ChildProcess } from 'node:child_process';
import { expect, test } from 'vitest';
import { withSandbox } from '../../../tests/support/sandbox.js';
import { ObserverClient } from './observer.js';

test('watcher observer emits recursive video and real directory arrivals while ignoring generated artwork', async () => withSandbox(async box => {
  const show = join(box.media, 'Show'), season = join(show, 'Season 01'); await mkdir(season, { recursive: true });
  const events: { library: string; path: string }[] = [], errors: string[] = [];
  const observer = new ObserverClient((library, path) => events.push({ library, path }), message => errors.push(message));
  try {
    expect(await observer.replace([{ library: 'TV', path: box.media }])).toEqual([box.media]);
    const video = join(season, 'Show.S01E01.mkv'); await writeFile(video, 'video');
    await expect.poll(() => events.some(event => event.library === 'TV' && event.path === video), { timeout: 5000 }).toBe(true);
    const arrived = join(box.media, 'New Show'); await mkdir(arrived);
    await expect.poll(() => events.some(event => event.path === arrived), { timeout: 5000 }).toBe(true);
    await delay(150); events.length = 0;
    await writeFile(join(show, 'tvshow.nfo'), 'nfo'); await writeFile(join(show, 'poster.jpg'), 'art');
    await mkdir(join(show, '.actors')); await writeFile(join(show, '.actors', 'Actor.jpg'), 'portrait');
    await symlink(box.config, join(show, 'Linked'), process.platform === 'win32' ? 'junction' : 'dir'); await writeFile(join(box.config, 'outside.mkv'), 'outside');
    await writeFile(join(show, '.incoming.mkv'), 'partial'); await writeFile(join(show, 'video.mkv.part'), 'partial');
    await delay(200);
    expect(events).toEqual([]); expect(errors).toEqual([]);
  } finally { await observer.close(); }
}), 15000);

test('watcher observer replaces watched roots and closes handles without stale events', async () => withSandbox(async box => {
  const first = join(box.media, 'First'), second = join(box.media, 'Second'); await mkdir(first); await mkdir(second);
  const events: string[] = [], observer = new ObserverClient((_library, path) => events.push(path), () => {});
  try {
    await observer.replace([{ library: 'First', path: first }]);
    expect(await Promise.all([observer.replace([{ library: 'First', path: first }]), observer.replace([{ library: 'Second', path: second }])])).toEqual([[], [second]]);
    await writeFile(join(first, 'old.mkv'), 'old'); await writeFile(join(second, 'new.mkv'), 'new');
    await expect.poll(() => events.includes(join(second, 'new.mkv')), { timeout: 5000 }).toBe(true);
    expect(events).not.toContain(join(first, 'old.mkv'));
    expect(await observer.replace([])).toEqual([]); await delay(100); events.length = 0;
    await writeFile(join(second, 'disabled.mkv'), 'disabled'); await delay(150); expect(events).toEqual([]);
    await Promise.all([observer.close(), observer.close()]);
    await expect(observer.replace([{ library: 'First', path: first }])).rejects.toThrow(/closed/i);
  } finally { await observer.close(); }
}), 15000);

test('watcher observer reports bad roots while keeping successful watches', async () => withSandbox(async box => {
  const errors: string[] = [], observer = new ObserverClient(() => {}, message => errors.push(message));
  try {
    const missing = join(box.media, 'missing');
    expect(await observer.replace([{ library: 'Missing', path: missing }, { library: 'TV', path: box.media }])).toEqual([box.media]);
    expect(errors.some(message => message.includes(missing))).toBe(true);
  } finally { await observer.close(); }
}), 15000);

test('watcher observer lost-root IPC updates watched paths before notifying and ignores stale generations', async () => withSandbox(async box => {
  const first = join(box.media, 'First'), second = join(box.media, 'Second'); await mkdir(first); await mkdir(second);
  const notices: string[][] = [];
  const observer = new ObserverClient(() => {}, () => notices.push(observer.watchedPaths));
  try {
    await observer.replace([{ library: 'First', path: first }, { library: 'Second', path: second }]);
    expect(observer.watchedPaths).toEqual([first, second]);
    const snapshot = observer.watchedPaths; snapshot.length = 0; expect(observer.watchedPaths).toHaveLength(2);
    const child = Reflect.get(observer, 'child') as ChildProcess, generation = Reflect.get(observer, 'generation') as number;
    // Native watch errors differ by OS; exercise the child's lost-root IPC contract directly.
    child.emit('message', { type: 'lost-root', id: generation - 1, path: second, message: 'Old error' });
    expect(observer.watchedPaths).toHaveLength(2); expect(notices).toEqual([]);
    child.emit('message', { type: 'lost-root', id: generation, path: first, message: 'Watch failed' });
    expect(observer.watchedPaths).toEqual([second]); expect(notices).toEqual([[second]]);
    child.kill(); await expect.poll(() => observer.watchedPaths, { timeout: 5000 }).toEqual([]);
    expect(notices.at(-1)).toEqual([]);
    await observer.close(); expect(observer.watchedPaths).toEqual([]);
  } finally { await observer.close(); }
}), 15000);
