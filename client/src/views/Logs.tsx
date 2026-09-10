import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LogResponse } from 'shared';
import { api } from '../lib/api.js';
import { Button } from '../design/primitives/index.js';
import { QueryState } from '../app/QueryState.js';
export function Logs() {
  const [live, setLive] = useState(true), query = useQuery({ queryKey: ['logs'], queryFn: ({ signal }) => api.get<LogResponse>('/api/logs/app', { tail: '400' }, signal), refetchInterval: live ? 3000 : false });
  return <><header className="page-heading"><div><h1>Logs</h1><p>Last 400 application log lines.</p></div><div className="actions"><Button aria-pressed={live} onClick={() => setLive(!live)}>{live ? 'Pause live updates' : 'Resume live updates'}</Button><Button disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh log</Button></div></header><QueryState query={query} label="application log">{data => <pre className="log-output">{data.lines.length ? data.lines.join('\n') : 'No application log lines are available. Per-job output is available in Jobs.'}</pre>}</QueryState></>;
}
