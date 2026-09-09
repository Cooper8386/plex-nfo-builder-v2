import { z } from 'zod';

const id = z.string().trim().min(1);
export const bindingSchema = z.object({
  kind: z.enum(['series', 'movie']), provider: z.enum(['tvdb', 'tmdb', 'imdb']), external_id: id,
  title: z.string().nullable().default(null), year: z.number().int().nullable().default(null),
  language: z.string().nullable().default(null), source_locked: z.boolean().default(false),
  secondary_provider: z.enum(['tvdb', 'tmdb']).nullable().default(null),
  secondary_external_id: id.nullable().default(null),
}).strict().refine(b => (b.secondary_provider === null && b.secondary_external_id === null) ||
  (b.secondary_provider !== null && b.secondary_external_id !== null && b.secondary_provider !== b.provider), 'Secondary provider must differ from primary and include an ID');

const scope = z.string().regex(/^(series|movie|season-\d{2}|episode-[A-Za-z0-9_-]+)$/);
const slot = z.string().regex(/^(poster|background|banner|clearlogo|season-\d{2}-poster|episode-thumb-[A-Za-z0-9_-]+)$/);
const nullableNumber = z.number().int().nonnegative().nullable().default(null);
const relativeFile = z.string().min(1).refine(path => !path.includes('\\') && !path.includes(':') && !path.includes('\0') &&
  !path.startsWith('/') && path.split('/').every(part => part !== '..' && part !== '.' && part !== ''), 'Expected a relative media file path');

// Version 2 intentionally rejects the legacy format. All file keys use portable relative paths.
export const sidecarSchema = z.object({
  version: z.literal(2), binding: bindingSchema.nullable(),
  overrides: z.array(z.object({ scope, field: z.enum(['title', 'sorttitle', 'plot', 'tagline', 'originaltitle']), value: z.string() }).strict()).default([]),
  artwork_selections: z.array(z.object({ slot, url: z.string().min(1), language: z.string().nullable().default(null), score: z.number().nullable().default(null) }).strict()).default([]),
  episode_overrides: z.array(z.object({ season: z.number().int().nonnegative(), episode: z.number().int().nonnegative(), tvdb_episode_id: id }).strict()).default([]),
  episode_file_overrides: z.array(z.object({ file_path: relativeFile, season: nullableNumber, episode: nullableNumber, external_id: id.nullable().default(null) }).strict()).default([]),
  custom_tags: z.array(z.string().trim().min(1)).transform(tags => tags.filter((tag, index) => tags.findIndex(t => t.toLowerCase() === tag.toLowerCase()) === index)).default([]),
}).strict();

export type Binding = z.infer<typeof bindingSchema>;
export type Sidecar = z.infer<typeof sidecarSchema>;
