import type { Cast } from '../providers/normalized.js';

const castTypes = new Set(['actor', 'actress', 'guest star', 'special guest', 'self', 'host', 'voice actor', 'voice actress']);

export function filterCast(cast: Cast[]): Cast[] {
  const seen = new Set<string>();
  return [...cast].sort((a, b) => a.order - b.order).filter(person => {
    const name = person.name.trim();
    if (!name || !castTypes.has(person.character_type.trim().toLowerCase())) return false;
    const key = person.id ? `id:${person.id}` : `name:${name.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
