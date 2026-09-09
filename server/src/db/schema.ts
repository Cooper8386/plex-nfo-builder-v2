import type Database from 'better-sqlite3';

const migrations = [
  `CREATE TABLE libraries (
    name TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('tv','movies','mixed')),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)), detected_at INTEGER NOT NULL,
    metadata_source TEXT CHECK(metadata_source IN ('tvdb','tmdb'))
  );
  CREATE TABLE bindings (
    folder_path TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('series','movie')),
    provider TEXT NOT NULL CHECK(provider IN ('tvdb','tmdb','imdb')), external_id TEXT NOT NULL CHECK(length(trim(external_id)) > 0),
    title TEXT, year INTEGER, language TEXT, source_locked INTEGER NOT NULL DEFAULT 0 CHECK(source_locked IN (0,1)),
    secondary_provider TEXT CHECK(secondary_provider IN ('tvdb','tmdb')), secondary_external_id TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    CHECK((secondary_provider IS NULL AND secondary_external_id IS NULL) OR
      (secondary_provider IS NOT NULL AND secondary_external_id IS NOT NULL AND length(trim(secondary_external_id)) > 0 AND secondary_provider != provider))
  );
  CREATE TABLE item_state (
    folder_path TEXT PRIMARY KEY, library TEXT NOT NULL REFERENCES libraries(name) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('series','movie')), title TEXT, year INTEGER, external_id TEXT, provider TEXT,
    nfo_status TEXT NOT NULL DEFAULT 'none' CHECK(nfo_status IN ('none','partial','complete','foreign','mixed')),
    episode_count_local INTEGER NOT NULL DEFAULT 0, episode_count_tvdb INTEGER NOT NULL DEFAULT 0,
    season_count_local INTEGER NOT NULL DEFAULT 0, last_scanned INTEGER, last_built INTEGER,
    poster_path TEXT, sort_title TEXT, orphan_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX item_library ON item_state(library);
  CREATE TABLE artwork_selections (
    folder_path TEXT NOT NULL, slot TEXT NOT NULL, url TEXT NOT NULL, language TEXT, score REAL,
    updated_at INTEGER NOT NULL, PRIMARY KEY(folder_path,slot)
  );
  CREATE TABLE active_artwork (
    folder_path TEXT NOT NULL, slot TEXT NOT NULL, source_path TEXT NOT NULL,
    updated_at INTEGER NOT NULL, PRIMARY KEY(folder_path,slot)
  );
  CREATE TABLE episode_overrides (
    folder_path TEXT NOT NULL, season INTEGER NOT NULL CHECK(season >= 0), episode INTEGER NOT NULL CHECK(episode >= 0),
    tvdb_episode_id TEXT NOT NULL, PRIMARY KEY(folder_path,season,episode)
  );
  CREATE TABLE episode_file_overrides (
    folder_path TEXT NOT NULL, file_path TEXT NOT NULL, season INTEGER CHECK(season >= 0), episode INTEGER CHECK(episode >= 0),
    external_id TEXT, PRIMARY KEY(folder_path,file_path)
  );
  CREATE TABLE nfo_overrides (
    folder_path TEXT NOT NULL, scope TEXT NOT NULL, field TEXT NOT NULL CHECK(field IN ('title','sorttitle','plot','tagline','originaltitle')),
    value TEXT NOT NULL CHECK(length(value) > 0), PRIMARY KEY(folder_path,scope,field)
  );
  CREATE TABLE custom_artwork (
    id TEXT PRIMARY KEY, folder_path TEXT NOT NULL, slot TEXT NOT NULL, source TEXT NOT NULL CHECK(source IN ('upload','url')),
    origin TEXT, file_path TEXT, content_type TEXT, size INTEGER, created_at INTEGER NOT NULL
  );
  CREATE TABLE custom_tags (
    folder_path TEXT NOT NULL, tag TEXT NOT NULL COLLATE NOCASE CHECK(length(trim(tag)) > 0),
    created_at INTEGER NOT NULL, PRIMARY KEY(folder_path,tag)
  );
  CREATE TABLE schedules (
    id TEXT PRIMARY KEY, library TEXT REFERENCES libraries(name) ON DELETE CASCADE, cron TEXT NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('scan_only','match_only','build_only','match_and_build','full')),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)), last_run INTEGER, last_status TEXT,
    last_message TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE watcher_review (
    folder_path TEXT PRIMARY KEY, library TEXT NOT NULL REFERENCES libraries(name) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('series','movie')),
    reason TEXT NOT NULL CHECK(reason IN ('no_match','low_confidence','error','ambiguous')),
    detail TEXT, detected_at INTEGER NOT NULL, last_attempt_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE provider_cache (key TEXT PRIMARY KEY, payload TEXT NOT NULL CHECK(json_valid(payload)), fetched_at INTEGER NOT NULL, ttl INTEGER NOT NULL CHECK(ttl >= 0));`,
  `ALTER TABLE item_state ADD COLUMN date_added INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE item_state ADD COLUMN date_updated INTEGER;
   CREATE TRIGGER preserve_date_added BEFORE UPDATE OF date_added ON item_state
   WHEN NEW.date_added != OLD.date_added BEGIN SELECT RAISE(ABORT, 'date_added is insert-only'); END;`,
];

export function migrate(db: Database.Database) {
  db.transaction(() => {
    const version = db.pragma('user_version', { simple: true }) as number;
    if (version > migrations.length) throw new Error(`Database schema ${version} is newer than this application`);
    for (let i = version; i < migrations.length; i++) {
      db.exec(migrations[i]!);
      db.pragma(`user_version = ${i + 1}`);
    }
  }).immediate();
}
