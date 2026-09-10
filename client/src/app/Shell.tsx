import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NavLink, useLocation } from 'react-router';
import { Badge, Button, Dialog, Menu } from '../design/primitives/index.js';
import { api } from '../lib/api.js';
import { clearToken } from '../lib/auth.js';
import { AppRoutes, libraryUrl } from '../router/index.js';
import { QueryState } from './QueryState.js';
import { ConfirmProvider, useConfirm } from '../components/ConfirmDialog.js';
import { SettingsDraftProvider, useSettingsDraft } from '../views/Settings.js';

type Theme = 'system' | 'light' | 'dark';
function savedTheme(): Theme {
  try { const value = localStorage.getItem('plex-nfo-theme'); return value === 'light' || value === 'dark' ? value : 'system'; }
  catch { return 'system'; }
}

export function Shell() {
  return <SettingsDraftProvider><ConfirmProvider><ShellContent /></ConfirmProvider></SettingsDraftProvider>;
}
function ShellContent() {
  const {draft,setDraft}=useSettingsDraft(),confirm=useConfirm();
  const libraries = useQuery({ queryKey: ['libraries'], queryFn: ({ signal }) => api.libraries(signal) });
  const health = useQuery({ queryKey: ['health'], queryFn: ({ signal }) => api.health(signal) });
  const [theme, setTheme] = useState<Theme>(savedTheme);
  const [navOpen, setNavOpen] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const navToggle = useRef<HTMLButtonElement>(null);
  const main = useRef<HTMLElement>(null);
  const location = useLocation();
  useEffect(() => {
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('plex-nfo-theme', theme); } catch { /* Theme still works when storage is unavailable. */ }
  }, [theme]);
  useEffect(() => {
    main.current?.focus({preventScroll:true});
    if(!location.pathname.startsWith('/libraries/'))window.scrollTo(0,0);
    document.title = `${location.pathname.split('/')[1] || 'Libraries'} | Plex NFO Builder`;
  }, [location.pathname]);

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="library-rail" onKeyDown={event => {
      if (event.key === 'Escape' && navOpen) { setNavOpen(false); navToggle.current?.focus(); }
    }}>
      <div className="rail-heading"><NavLink to="/libraries" className="brand" onClick={() => setNavOpen(false)}>
        <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span>Plex NFO<span className="brand-subtitle">Builder</span></span>
      </NavLink><Button className="nav-toggle" ref={navToggle} variant="secondary" aria-expanded={navOpen} aria-controls="library-navigation" onClick={() => setNavOpen(value => !value)}>Libraries</Button></div>
      <nav id="library-navigation" aria-label="Libraries" className={`rail-navigation ${navOpen ? 'is-open' : ''}`}>
        <NavLink to="/libraries" end className="rail-overview" onClick={() => setNavOpen(false)}>All libraries</NavLink>
        <QueryState query={libraries} label="sidebar libraries">{({ libraries: rows }) => rows.length ? <ul>{rows.map(library => <li key={library.name}>
          <NavLink to={libraryUrl(library.name)} onClick={() => setNavOpen(false)}><span className={`rail-marker spine-${library.kind}`} aria-hidden="true" /><span>{library.name}</span>{!library.enabled && <span className="rail-disabled">Disabled</span>}</NavLink>
        </li>)}</ul> : <p className="rail-empty">No libraries detected yet.</p>}</QueryState>
        <div className="app-navigation">{['jobs','watcher','logs','settings','help'].map(page=><NavLink key={page} to={`/${page}`} onClick={()=>setNavOpen(false)}>{page[0]!.toUpperCase()+page.slice(1)}{page==='settings'&&Object.keys(draft).length>0&&<span className="rail-disabled">Unsaved</span>}</NavLink>)}</div>
      </nav>
      <p className="rail-footer">Made for your<br />local collection.</p>
    </aside>
    <div className="app-body">
      <header className="app-toolbar"><span className="toolbar-description">Your media, locally kept.</span><div className="toolbar-actions">
        {health.data&&<Badge>v{health.data.version}</Badge>}
        <Menu label={`Theme: ${theme}`} items={(['system', 'light', 'dark'] as const).map(value => ({ label: `${value[0]!.toUpperCase()}${value.slice(1)}${value === theme ? ' (selected)' : ''}`, onSelect: () => setTheme(value) }))} />
        <Button variant="quiet" onClick={() => setConnectionOpen(true)}>Connection</Button>
      </div></header>
      <main id="main-content" tabIndex={-1} ref={main}><AppRoutes libraries={libraries} /></main>
      <footer className="app-footer">Plex NFO Builder <span>Metadata lives with your media.</span></footer>
    </div>
    <Dialog open={connectionOpen} onClose={() => setConnectionOpen(false)} title="Server connection">
      <QueryState query={health} label="server connection">{value => <>
        <Badge tone="success">Connected</Badge><dl className="connection-details">
          <dt>Version</dt><dd>{value.version}</dd><dt>Media root</dt><dd>{value.media_root}</dd><dt>Default metadata source</dt><dd>{value.metadata_source.toUpperCase()}</dd>
          <dt>TVDB</dt><dd>{value.tvdb_configured ? 'Configured' : 'Not configured'}</dd><dt>TMDB</dt><dd>{value.tmdb_configured ? 'Configured' : 'Not configured'}</dd><dt>Fanart.tv</dt><dd>{value.fanart_configured ? 'Configured' : 'Not configured'}</dd>
        </dl><Button variant="secondary" onClick={()=>{void (async()=>{if(Object.keys(draft).length&&!await confirm({title:'Discard drafts and disconnect?',body:<p>Unsaved settings drafts will be discarded when you disconnect this browser.</p>,action:'Discard and disconnect'}))return;setDraft({});clearToken();})();}}>Disconnect this browser</Button>
      </>}</QueryState>
    </Dialog>
  </div>;
}
