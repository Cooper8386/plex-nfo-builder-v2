import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { offLoop, workerModule } from '../fs/off-loop.js';

interface Stream {
  codec_type?: string; codec_name?: string; profile?: string; pix_fmt?: string; bits_per_raw_sample?: string;
  height?: number; color_transfer?: string; channels?: number; disposition?: { default?: number; attached_pic?: number };
  tags?: Record<string, string>; side_data_list?: { side_data_type?: string }[];
}
export interface Probe { streams?: Stream[] }
export interface MediaInfo {
  video_codec: string; video_bit_depth: string; hdr_type: string; audio_codec: string; audio_channels: string;
  audio_languages: string; languages: string[]; resolution: string; quality: string; release_group: string; is_3d: boolean;
}
const videoCodecs: Record<string, string> = { hevc: 'h265', h265: 'h265', h264: 'h264', avc: 'h264', mpeg2video: 'MPEG2', mpeg4: 'MPEG4', xvid: 'XviD' };
const audioCodecs: Record<string, string> = { truehd: 'TrueHD', opus: 'Opus', vorbis: 'Vorbis', pcm_s16le: 'PCM', pcm_s24le: 'PCM', pcm_s32le: 'PCM' };
const languages: Record<string, string> = { eng: 'EN', jpn: 'JA', spa: 'ES', fra: 'FR', fre: 'FR', deu: 'DE', ger: 'DE', ita: 'IT', por: 'PT', rus: 'RU', kor: 'KO', chi: 'ZH', zho: 'ZH', ara: 'AR', hin: 'HI', nld: 'NL', dut: 'NL', swe: 'SV', nor: 'NO', dan: 'DA', fin: 'FI', pol: 'PL', tur: 'TR', ces: 'CS', cze: 'CS', hun: 'HU', ron: 'RO', rum: 'RO', ell: 'EL', gre: 'EL', tha: 'TH', vie: 'VI', ind: 'ID', msa: 'MS', may: 'MS', heb: 'HE', ukr: 'UK', bul: 'BG', hrv: 'HR', srp: 'SR', slk: 'SK', slo: 'SK', slv: 'SL', lit: 'LT', lav: 'LV', est: 'ET', cat: 'CA' };
export function parseProbe(data: Probe, path = ''): MediaInfo {
  const streams = data.streams ?? [], video = streams.find(s => s.codec_type === 'video' && !s.disposition?.attached_pic && !['mjpeg', 'png'].includes(s.codec_name ?? ''));
  const audio = streams.filter(s => s.codec_type === 'audio'), track = audio.find(s => s.disposition?.default) ?? audio[0];
  const codec = video?.codec_name ?? '', pix = video?.pix_fmt ?? '', height = video?.height ?? 0;
  const side = JSON.stringify(video?.side_data_list ?? []).toLowerCase();
  const tags = Object.fromEntries(Object.entries(track?.tags ?? {}).map(([k,v]) => [k.toLowerCase(), v]));
  const profile = `${track?.profile ?? ''} ${tags.title ?? ''}`.toLowerCase(), ac = track?.codec_name ?? '';
  let audioCodec = audioCodecs[ac] ?? ac.toUpperCase();
  if (ac === 'dts') audioCodec = /dts[ :_-]?x|\bx\b/.test(profile) ? 'DTS-X' : /\bma\b|master audio/.test(profile) ? 'DTS-HD MA' : /hd|hra/.test(profile) ? 'DTS-HD' : /\bes\b/.test(profile) ? 'DTS-ES' : 'DTS';
  if (['truehd','eac3'].includes(ac) && /atmos/.test(profile + JSON.stringify(track?.side_data_list ?? []).toLowerCase())) audioCodec += ' Atmos';
  const langs = [...new Set(audio.map(s => (s.tags?.language ?? s.tags?.LANGUAGE ?? '').trim().toLowerCase()).filter(l => l && l !== 'und').map(l => languages[l] ?? l.toUpperCase()))];
  const stem = basename(path, extname(path));
  const resolution = height >= 2000 ? '2160p' : height >= 1000 ? '1080p' : height >= 700 ? '720p' : height >= 540 ? '576p' : height >= 400 ? '480p' : /\b(2160p|1080p|720p|576p|480p)\b/i.exec(stem)?.[1]?.toLowerCase() ?? '';
  const source = /\b(WEB[. -]?DL|WEB[. -]?Rip|Blu[. -]?Ray|BDRip|BDRemux|REMUX|HDTV|DVD[. -]?Rip|DVD|HDRip)\b/i.exec(stem)?.[1]?.replace(/[. -]/g, '').toUpperCase() ?? '';
  const sources: Record<string, string> = { WEBDL: 'WEBDL', WEBRIP: 'WEBRip', BLURAY: 'Bluray', BDRIP: 'Bluray', BDREMUX: 'Remux', REMUX: 'Remux', DVDRIP: 'DVD', HDRIP: 'HDRip' };
  const suffix = /-([A-Za-z0-9_]+)$/.exec(stem)?.[1];
  const group = suffix && !/^\d{1,4}[pi]?$/i.test(suffix) ? suffix : /^\[([^\]]+)\]/.exec(stem)?.[1]?.trim() ?? '';
  const channelMap: Record<number, string> = { 1: '1.0', 2: '2.0', 3: '2.1', 4: '4.0', 5: '4.1', 6: '5.1', 7: '6.1', 8: '7.1', 10: '9.1' };
  return { video_codec: videoCodecs[codec] ?? codec.toUpperCase(), video_bit_depth: Number(video?.bits_per_raw_sample) > 0 ? video!.bits_per_raw_sample! : /12/.test(pix) ? '12' : /10/.test(pix) ? '10' : pix ? '8' : '',
    hdr_type: /dolby vision|dovi/.test(side) ? 'DV' : /hdr10\+|hdr dynamic metadata/.test(side) ? 'HDR10Plus' : video?.color_transfer === 'smpte2084' ? 'HDR10' : video?.color_transfer === 'arib-std-b67' ? 'HLG' : '',
    audio_codec: audioCodec, audio_channels: track?.channels ? channelMap[track.channels] ?? `${track.channels}.0` : '',
    languages: langs, audio_languages: langs.length ? `[${langs.join('+')}]` : '', resolution, quality: [sources[source] ?? source, resolution].filter(Boolean).join('-'), release_group: group, is_3d: /stereo3d/.test(side) };
}
const execute = promisify(execFile);
async function ffprobe(path: string): Promise<Probe> {
  const { stdout } = await execute('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', path], { timeout: 30_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  return JSON.parse(stdout) as Probe;
}
// Owned by the media worker; replacement evicts old mtimes for a path.
export class ProbeCache {
  private cache = new Map<string, { mtime: number; value: MediaInfo }>();
  constructor(private probe: (path: string) => Promise<Probe> = ffprobe) {}
  async get(path: string) {
    path = resolve(path);
    try {
      const mtime = (await stat(path)).mtimeMs, cached = this.cache.get(path);
      if (cached?.mtime === mtime) return cached.value;
      const value = parseProbe(await this.probe(path), path);
      if (this.cache.size >= 2000) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(path, { mtime, value }); return value;
    } catch { return parseProbe({}, path); }
  }
}
const cache = new ProbeCache();
export function handle(input: { path: string }) { return cache.get(input.path); }
export class MediaInfoClient {
  private pool = offLoop(workerModule('./mediainfo.js', import.meta.url), { concurrency: 1, timeoutMs: 35_000 });
  probe(path: string) { return this.pool.run<MediaInfo>({ path }); }
  close() { return this.pool.close(); }
}
