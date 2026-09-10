import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError, api } from '../lib/api.js';
import { getToken, setToken, unauthorizedEvent, useAuthRevision } from '../lib/auth.js';
import { Button, Input } from '../design/primitives/index.js';
import { queryClient } from './query-client.js';

export function AuthGate({ children }: { children: ReactNode }) {
  const revision = useAuthRevision();
  return <SessionGate key={revision}>{children}</SessionGate>;
}

function SessionGate({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState(getToken);
  const [expired, setExpired] = useState(false);
  const health = useQuery({ queryKey: ['health'], queryFn: ({ signal }) => api.health(signal), refetchOnWindowFocus: false });
  useEffect(() => {
    const unauthorized = () => {
      setExpired(true);
      queryClient.removeQueries({ predicate: query => query.queryKey[0] !== 'health' });
    };
    window.addEventListener(unauthorizedEvent, unauthorized);
    return () => window.removeEventListener(unauthorizedEvent, unauthorized);
  }, []);

  if (health.isSuccess && !expired) return children;
  const status = health.error instanceof ApiError ? health.error.status : null;
  const missingConfig = status === 503;
  const unauthorized = expired || status === 401;
  function connect(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setToken(draft.trim()); }
  return <main className="auth-page"><section className="auth-card" aria-labelledby="auth-title">
    <p className="eyebrow">Plex NFO Builder</p><h1 id="auth-title">{missingConfig ? 'Server setup required' : 'Connect to your library'}</h1>
    {health.isPending && !expired ? <p role="status">Checking your connection…</p> : missingConfig ? <div className="form-error" role="alert">
      <p>The server has no API token configured. Set API_TOKEN on the server, then retry.</p><Button onClick={() => { void health.refetch(); }}>Retry connection</Button>
    </div> : unauthorized ? <form className="auth-form" onSubmit={connect}>
      <p>Use the API token configured on your server. It is saved in this browser.</p>
      <p className="form-error" role="alert">{getToken() ? 'The API token was not accepted. Enter a valid token to reconnect.' : 'An API token is required to connect.'}</p>
      <Input label="API token" type="password" autoComplete="current-password" value={draft} onChange={event => setDraft(event.target.value)} required autoFocus />
      <Button type="submit" variant="primary">Connect</Button>
    </form> : <div className="form-error" role="alert"><p>{health.error?.message ?? 'Unable to connect to the server.'}</p><Button onClick={() => { void health.refetch(); }} disabled={health.isFetching}>{health.isFetching ? 'Retrying…' : 'Retry connection'}</Button></div>}
  </section></main>;
}
