import { type UseQueryResult } from '@tanstack/react-query';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router';
import type { LibrariesResponse } from 'shared';
import { Badge, Button } from '../design/primitives/index.js';
import { QueryState } from '../app/QueryState.js';
import { api } from '../lib/api.js';
import { Library, FolderBrowser } from '../views/Library.js';
import { Detail } from '../views/Detail.js';
import { Settings } from '../views/Settings.js';
import { Watcher } from '../views/Watcher.js';
import { Jobs } from '../views/Jobs.js';
import { Logs } from '../views/Logs.js';
import { Help } from '../views/Help.js';
import { useAction } from '../views/common.js';

export const libraryUrl = (name: string) => `/libraries/${encodeURIComponent(name)}`;
function useLibraryName() {
  const { pathname } = useLocation();
  // Decode once: router params also decode literal "%2F" in valid folder names.
  try { return decodeURIComponent(pathname.slice('/libraries/'.length)); }
  catch { return ''; }
}
const kinds = { tv: 'TV series', movies: 'Movies', mixed: 'Mixed library' };

function LibraryDirectory({ query }: { query: UseQueryResult<LibrariesResponse, Error> }) {
  const action=useAction();
  return <>
    <header className="page-heading">
      <div><h1>Your libraries</h1><p>Local metadata, one collection at a time.</p></div>
      <div className="actions"><Button disabled={action.busy} onClick={()=>void action.run(()=>api.send('/api/libraries/detect'),'Libraries detected. Scan a library to load its titles.')}>Detect libraries</Button><Button variant="secondary" onClick={() => { void query.refetch(); }} disabled={query.isFetching}>Refresh libraries</Button></div>
    </header>
    {action.feedback}<QueryState query={query} label="libraries">{({ libraries }) => libraries.length ? <>
      <p className="collection-count">{libraries.length} {libraries.length === 1 ? 'library' : 'libraries'} on your media server</p>
      <ul className="library-directory">{libraries.map(library => <li key={library.name}>
        <Link className="library-entry" to={libraryUrl(library.name)}>
          <span className={`library-spine spine-${library.kind}`} aria-hidden="true"><span /><span /><span /></span>
          <div className="library-entry-title"><h2>{library.name}</h2><p>{kinds[library.kind]}</p></div>
          <span className="library-provider">{library.effective_metadata_source.toUpperCase()}</span>
          {!library.enabled && <Badge>Disabled</Badge>}
          <span className="library-entry-open" aria-hidden="true">›</span>
        </Link>
      </li>)}</ul>
    </> : <div className="empty-state"><h2>No libraries detected</h2><p>Libraries are folders directly inside your media root. Check the media mount, then detect libraries.</p></div>}</QueryState><FolderBrowser />
  </>;
}


function LibraryRoute({ query }: { query: UseQueryResult<LibrariesResponse, Error> }) {
  const library = useLibraryName();
  return <QueryState query={query} label="libraries">{({ libraries }) => libraries.some(value => value.name === library)
    ? <Library key={library} library={libraries.find(value=>value.name===library)!} /> : <NotFound />}</QueryState>;
}

function NotFound() {
  return <div className="empty-state"><h1>Page not found</h1><p>This address does not match an available library or page.</p><Link to="/libraries">Return to your libraries</Link></div>;
}

export function AppRoutes({ libraries }: { libraries: UseQueryResult<LibrariesResponse, Error> }) {
  return <Routes>
    <Route path="/" element={<Navigate to="/libraries" replace />} />
    <Route path="/libraries" element={<LibraryDirectory query={libraries} />} />
    <Route path="/libraries/:library" element={<LibraryRoute query={libraries} />} />
    <Route path="/items" element={<Detail />} />
    <Route path="/settings" element={<Settings />} />
    <Route path="/watcher" element={<Watcher />} />
    <Route path="/jobs" element={<Jobs />} />
    <Route path="/logs" element={<Logs />} />
    <Route path="/help" element={<Help />} />
    <Route path="*" element={<NotFound />} />
  </Routes>;
}
