import { expect, test } from 'vitest';
import { filterCast } from './cast.js';
import { tvdbCast } from '../providers/tvdb.js';
import { tmdbCast } from '../providers/tmdb.js';

test('cast filters TVDB crew by character type, deduplicates people and retains billing order', () => {
  const normalized = tvdbCast([
    { peopleId: 2, personName: 'Second', name: 'Hero', peopleType: 'Actor', sort: 2 },
    { peopleId: 3, personName: 'Director', name: 'Director', peopleType: 'Director', sort: 0 },
    { peopleId: 4, personName: 'Writer', name: 'Writer', peopleType: 'Writer', sort: 1 },
    { peopleId: 1, personName: 'First', name: 'Lead', peopleType: 'Actor', sort: 1 },
    { peopleId: 2, personName: 'Second', name: 'Other role', peopleType: 'Actor', sort: 5 },
    { peopleId: 5, personName: '', peopleType: 'Actor', sort: 3 },
  ]);
  expect(filterCast(normalized).map(person => [person.name, person.character])).toEqual([
    ['First', 'Lead'], ['Second', 'Hero'],
  ]);
  expect(normalized).toHaveLength(6);
});

test('cast applies the same deduplication and ordering to TMDB movie and series credits.cast', () => {
  const response = { credits: {
    cast: [
      { id: 2, name: 'Second', character: 'Friend', order: 2 },
      { id: 1, name: 'First', character: 'Lead', order: 0, profile_path: '/portrait.jpg' },
      { id: 1, name: 'First', character: 'Lead', order: 4 },
    ],
    crew: [{ id: 3, name: 'Director', job: 'Director' }],
  } };
  const normalized = tmdbCast(response.credits.cast);
  expect(filterCast(normalized).map(person => person.name)).toEqual(['First', 'Second']);
  expect(filterCast(normalized)[0]?.image).toBe('https://image.tmdb.org/t/p/original/portrait.jpg');
});

test('cast preserves tied billing order, handles missing ids, and excludes unknown types', () => {
  const people = tvdbCast([
    { personName: ' Guest ', name: 'Self', peopleType: 'Guest Star', sort: 0 },
    { personName: 'guest', name: 'Self', peopleType: 'Guest Star', sort: 1 },
    { personName: 'Voice', name: 'Character', peopleType: ' Voice Actor ', sort: 0 },
    { personName: 'Unknown', name: 'Character', peopleType: '', sort: 0 },
  ]);
  expect(filterCast(people).map(person => person.name)).toEqual([' Guest ', 'Voice']);
});
