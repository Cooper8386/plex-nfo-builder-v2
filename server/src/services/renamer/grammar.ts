type Context = Record<string, string | number | boolean | null | undefined>;

export function sanitize(value: string): string {
  // eslint-disable-next-line no-control-regex -- Windows/SMB forbid these filename characters.
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ').trim().replace(/\s+/g, ' ').replace(/[. ]+$/, '');
}

const aliases: Record<string, string> = {
  'series titleyear': 'series_titleyear', 'series titlethe': 'series_title_the', 'series title': 'title', 'series cleantitle': 'series_cleantitle',
  'movie title': 'title', 'movie cleantitle': 'movie_cleantitle', 'movie titlethe': 'title', 'movie titleyear': 'series_titleyear',
  'season number': 'season', season: 'season', 'episode number': 'episode', episode: 'episode', 'episode cleantitle': 'episode_cleantitle', 'episode title': 'episode_title', 'air-date': 'air_date', 'air date': 'air_date',
  'quality full': 'quality_full', 'quality title': 'quality_full',
  'mediainfo videocodec': 'video_codec', 'mediainfo videobitdepth': 'video_bit_depth', 'mediainfo videodynamicrangetype': 'hdr_type', 'mediainfo videodynamicrange': 'hdr_type',
  'mediainfo audiocodec': 'audio_codec', 'mediainfo audiochannels': 'audio_channels', 'mediainfo audiolanguages': 'audio_languages', 'mediainfo subtitlelanguages': '', 'mediainfo 3d': 'is_3d',
  'mediainfo simplevideocodec': 'video_codec', 'mediainfo simpleaudiocodec': 'audio_codec',
  'release group': 'release_group', releasegroup: 'release_group', 'custom formats': 'custom_formats', 'custom format': 'custom_formats',
  'release year': 'year', '(release year)': 'year_parens', 'edition tags': 'edition_tags',
  tvdbid: 'tvdb_id', 'tvdb id': 'tvdb_id', tmdbid: 'tmdb_id', 'tmdb id': 'tmdb_id', imdbid: 'imdb_id', 'imdb id': 'imdb_id',
};

function lookup(inner: string, context: Context): string {
  const colon = inner.indexOf(':'), key = (colon < 0 ? inner : inner.slice(0, colon)).trim().toLowerCase();
  const format = colon < 0 ? '' : inner.slice(colon + 1).trim();
  if (!key) return '';
  const mapped = Object.hasOwn(aliases, key) ? aliases[key]! : key.replace(/ /g, '_');
  let raw = Object.hasOwn(context, mapped) ? context[mapped] : undefined;
  if (mapped === 'series_title_the' && (raw === undefined || raw === null || raw === '')) {
    const title = String(context.title ?? '');
    raw = title.replace(/^(the|an|a)\s+(.+)$/i, '$2, $1');
  }
  if (raw === undefined || raw === null || raw === '') return '';
  if (/^0+$/.test(format)) {
    const numeric = typeof raw === 'string' ? /^[+-]?\d+$/.test(raw.trim()) ? Number(raw) : NaN : Number(raw);
    if (Number.isFinite(numeric)) {
      const integer = Math.trunc(numeric), negative = integer < 0;
      return (negative ? '-' : '') + String(Math.abs(integer)).padStart(format.length - Number(negative), '0');
    }
  }
  if (typeof raw === 'boolean') return raw ? mapped === 'is_3d' ? '3D' : 'True' : '';
  return String(raw);
}

function matching(text: string, start: number, opening: string, closing: string) {
  let depth = 0;
  for (let index = start; index < text.length; index++) {
    if (text[index] === opening) depth++;
    else if (text[index] === closing && --depth === 0) return index;
  }
  return -1;
}

function renderInner(template: string, context: Context): { text: string; hasValue: boolean } {
  let text = '', hasValue = false;
  for (let index = 0; index < template.length;) {
    if (template.startsWith('{[', index)) {
      const end = template.indexOf(']}', index + 2);
      if (end >= 0) {
        const rendered = template.slice(index + 2, end).split('}{').map((part, partIndex) => {
          const separator = partIndex ? /^\s*/.exec(part)![0] : '';
          const value = lookup(part.replace(/\]+$/, '').trim(), context);
          return value ? separator + value : '';
        }).join('').trim();
        if (rendered) { text += `[${rendered}]`; hasValue = true; }
        else text = text.replace(/[ \t]+$/, '');
        index = end + 2; continue;
      }
    }
    if (template.startsWith('[{', index)) {
      const end = matching(template, index, '[', ']');
      if (end >= 0) {
        const rendered = renderInner(template.slice(index + 1, end), context);
        if (rendered.hasValue && rendered.text.trim()) { text += `[${rendered.text}]`; hasValue = true; }
        else text = text.replace(/[ \t]+$/, '');
        index = end + 1; continue;
      }
    }
    if (template[index] !== '{') { text += template[index++]; continue; }
    const end = matching(template, index, '{', '}');
    if (end < 0) { text += template[index++]; continue; }
    const inner = template.slice(index + 1, end);
    if (inner.startsWith('-')) {
      const value = lookup(inner.slice(1), context);
      if (value) { text += `-${value}`; hasValue = true; }
    } else if (inner.includes('{')) {
      const rendered = renderInner(inner, context);
      if (rendered.hasValue && rendered.text) { text += rendered.text; hasValue = true; }
      else text = text.replace(/[ \t]+$/, '');
    } else {
      const value = lookup(inner, context);
      if (value) { text += value; hasValue = true; }
    }
    index = end + 1;
  }
  return { text, hasValue };
}

export function renderTemplate(template: string, context: Context): string {
  let text = renderInner(template, context).text.replace(/ {2,}/g, ' ').replace(/\s+(\.[A-Za-z0-9]+)$/, '$1');
  const extension = /^(.*?)(\.[A-Za-z0-9]+)$/.exec(text);
  text = extension ? extension[1]!.replace(/[\s-]+$/, '') + extension[2]! : text.replace(/[\s-]+$/, '');
  return text;
}
