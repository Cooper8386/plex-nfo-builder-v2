import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router';
import type { LibrariesResponse, NfoStatus } from 'shared';
import { Badge, Button, TableWrapper } from '../design/primitives/index.js';
import { QueryState } from '../app/QueryState.js';
import { api } from '../lib/api.js';

export const libraryUrl = (name: string) => `/libraries/${encodeURIComponent(name)}`;
function useLibraryName() {
  const { pathname } = useLocation();
  // Decode once: router params also decode literal "%2F" in valid folder names.
  try { return decodeURIComponent(pathname.slice('/libraries/'.length)); }
  catch { return ''; }
}
const kinds = { tv: 'TV series', movies: 'Movies', mixed: 'Mixed library' };
const statuses: Record<NfoStatus, { label: string; tone: 'neutral' | 'success' | 'warning' }> = {
  none: { label: 'No NFOs', tone: 'neutral' },
  partial: { label: 'Partial', tone: 'warning' },
  complete: { label: 'Complete', tone: 'success' },
  foreign: { label: 'Foreign NFOs', tone: 'warning' },
  mixed: { label: 'Mixed NFOs', tone: 'warning' },
};

function LibraryDirectory({ query }: { query: UseQueryResult<LibrariesResponse, Error> }) {
  return <>
    <header className="page-heading">
      <div><h1>Your libraries</h1><p>Local metadata, one collection at a time.</p></div>
      <Button variant="secondary" onClick={() => { void query.refetch(); }} disabled={query.isFetching}>Refresh libraries</Button>
    </header>
    <QueryState query={query} label="libraries">{({ libraries }) => libraries.length ? <>
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
    </> : <div className="empty-state"><h2>No libraries detected</h2><p>Libraries are folders directly inside your media root. Check the server’s media mount, then restart the server to detect and scan them.</p><p>Refresh this list once the scan has finished.</p></div>}</QueryState>
  </>;
}

function LibraryItems() {
  const library = useLibraryName();
  const query = useQuery({ queryKey: ['items', library], queryFn: ({ signal }) => api.items({ library }, signal) });
  return <>
    <header className="page-heading">
      <div><Link className="back-link" to="/libraries">All libraries</Link><h1>{library}</h1><p>Metadata coverage from the latest library scan.</p></div>
      <Button variant="secondary" onClick={() => { void query.refetch(); }} disabled={query.isFetching}>Refresh titles</Button>
    </header>
    <QueryState query={query} label="titles">{({ items }) => items.length ? <>
      <p className="collection-count">{items.length} {items.length === 1 ? 'title' : 'titles'}</p>
      <TableWrapper label={`${library} titles`}><table>
        <caption className="sr-only">Titles and local NFO coverage in {library}</caption>
        <thead><tr><th scope="col">Title</th><th scope="col">NFO status</th><th scope="col">Media</th><th scope="col">Source</th></tr></thead>
        <tbody>{items.map(item => <tr key={item.folder_path}>
          <th scope="row"><span className="item-title">{item.title || item.folder_path.split(/[\\/]/).pop()}</span><span className="item-subtitle">{item.kind === 'movie' ? 'Movie' : 'TV series'}{item.year ? ` (${item.year})` : ''}</span></th>
          <td><Badge tone={statuses[item.nfo_status].tone}>{statuses[item.nfo_status].label}</Badge></td>
          <td>{item.episode_count_local} {item.episode_count_local === 1 ? 'video' : 'videos'}{item.kind === 'series' && <span className="item-subtitle">{item.season_count_local} {item.season_count_local === 1 ? 'season' : 'seasons'}</span>}</td>
          <td>{item.provider ? item.provider.toUpperCase() : <span className="muted">Unbound</span>}</td>
        </tr>)}</tbody>
      </table></TableWrapper>
      <p className="table-note">“Foreign” identifies NFOs written by another app. “Mixed” means both local app NFOs and foreign NFOs are present.</p>
    </> : <div className="empty-state"><h2>No titles scanned yet</h2><p>Titles appear after the server scans this library. Check that it is enabled and its folders are available, then refresh.</p></div>}</QueryState>
  </>;
}

function LibraryRoute({ query }: { query: UseQueryResult<LibrariesResponse, Error> }) {
  const library = useLibraryName();
  return <QueryState query={query} label="libraries">{({ libraries }) => libraries.some(value => value.name === library)
    ? <LibraryItems /> : <NotFound />}</QueryState>;
}

function NotFound() {
  return <div className="empty-state"><h1>Page not found</h1><p>This address does not match an available library or page.</p><Link to="/libraries">Return to your libraries</Link></div>;
}

export function AppRoutes({ libraries }: { libraries: UseQueryResult<LibrariesResponse, Error> }) {
  return <Routes>
    <Route path="/" element={<Navigate to="/libraries" replace />} />
    <Route path="/libraries" element={<LibraryDirectory query={libraries} />} />
    <Route path="/libraries/:library" element={<LibraryRoute query={libraries} />} />
    <Route path="*" element={<NotFound />} />
  </Routes>;
}
