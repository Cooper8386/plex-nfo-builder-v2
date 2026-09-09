export type RemovableType = 'sidecar' | 'nfo' | 'artwork' | 'thumbnail' | 'actors';
export const imagePattern = /\.(?:jpe?g|png|webp|gif|bmp|tiff?)$/i;

export function removableType(name: string): RemovableType | null {
  if (name.toLowerCase() === '.plex-nfo-builder.json') return 'sidecar';
  if (/\.nfo$/i.test(name)) return 'nfo';
  if (/^(?:poster|background|banner|clearlogo|season\d+-poster|season-specials-poster)\.(?:jpe?g|png|webp|gif|bmp|tiff?)$/i.test(name)) return 'artwork';
  // A video or subtitle named *-thumb is still media, never generated artwork.
  if (/-thumb\.(?:jpe?g|png|webp|gif|bmp|tiff?)$/i.test(name)) return 'thumbnail';
  return null;
}
