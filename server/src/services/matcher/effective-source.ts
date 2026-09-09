import type { MetadataSource, Provider } from 'shared';
// IMDb bindings preserve identity; IMDb has no metadata client in this app.
export function effectiveSource(binding: { provider: Provider } | null, library: { metadata_source: MetadataSource | null } | null, global: MetadataSource): MetadataSource {
  return binding?.provider === 'tvdb' || binding?.provider === 'tmdb' ? binding.provider : library?.metadata_source ?? global;
}
