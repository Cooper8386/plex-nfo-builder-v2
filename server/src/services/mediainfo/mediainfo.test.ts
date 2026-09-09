import { join } from 'node:path';
import { writeFile, utimes } from 'node:fs/promises';
import { expect, test, vi } from 'vitest';
import { parseProbe, ProbeCache, MediaInfoClient, type Probe } from './mediainfo.js';
import { withSandbox } from '../../../tests/support/sandbox.js';

const fixture: Probe = { streams: [
  { codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } },
  { codec_type: 'video', codec_name: 'hevc', pix_fmt: 'yuv420p10le', height: 2160, color_transfer: 'smpte2084', side_data_list: [{ side_data_type: 'DOVI configuration record' }] },
  { codec_type: 'audio', codec_name: 'aac', channels: 2, tags: { language: 'jpn' } },
  { codec_type: 'audio', codec_name: 'truehd', channels: 8, disposition: { default: 1 }, tags: { title: 'Dolby Atmos', language: 'eng' } },
] };
test('mediainfo extracts fixed ffprobe JSON, variants, quality and groups', () => {
  expect(parseProbe(fixture, 'Film.WEB-DL-Group.mkv')).toMatchObject({ video_codec: 'h265', video_bit_depth: '10', hdr_type: 'DV', audio_codec: 'TrueHD Atmos', audio_channels: '7.1', audio_languages: '[JA+EN]', quality: 'WEBDL-2160p', release_group: 'Group' });
  for (const [profile, expected] of [['DTS-HD MA', 'DTS-HD MA'], ['DTS:X', 'DTS-X']]) expect(parseProbe({ streams: [{ codec_type: 'audio', codec_name: 'dts', profile }] }).audio_codec).toBe(expected);
  expect(parseProbe({ streams: [{ codec_type: 'audio', codec_name: 'eac3', tags: { title: 'Atmos' } }] }).audio_codec).toBe('EAC3 Atmos');
  for (const [transfer, expected] of [['smpte2084', 'HDR10'], ['arib-std-b67', 'HLG']]) expect(parseProbe({ streams: [{ codec_type: 'video', color_transfer: transfer }] }).hdr_type).toBe(expected);
  expect(parseProbe({}, '[Group] Show - 01 [1080p].mkv')).toMatchObject({ release_group: 'Group', resolution: '1080p' });
});
test('mediainfo cache keys path and mtime, failures remain safe off-loop', async () => withSandbox(async box => {
  const a = join(box.media, 'a.mkv'), b = join(box.media, 'b.mkv');
  await writeFile(a, ''); await writeFile(b, ''); await utimes(a, 1000, 1000); await utimes(b, 1000, 1000);
  const probe = vi.fn(async () => fixture), cache = new ProbeCache(probe);
  await cache.get(a); await cache.get(a); expect(probe).toHaveBeenCalledTimes(1);
  await cache.get(b); expect(probe).toHaveBeenCalledTimes(2);
  await utimes(a, 2000, 2000); await cache.get(a); expect(probe).toHaveBeenCalledTimes(3);
  const client = new MediaInfoClient();
  try { expect((await client.probe(join(box.media, 'missing.mkv'))).video_codec).toBe(''); }
  finally { await client.close(); }
}));
