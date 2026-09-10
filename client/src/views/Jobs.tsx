import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import type { JobsResponse } from 'shared';
import { api } from '../lib/api.js';
import { Badge, Button, TableWrapper } from '../design/primitives/index.js';
import { QueryState } from '../app/QueryState.js';
import { date, itemUrl } from './common.js';
export function Jobs() {
  const [params, setParams] = useSearchParams(), id = params.get('job');
  const query = useQuery({ queryKey: ['jobs'], queryFn: ({ signal }) => api.get<JobsResponse>('/api/jobs', {}, signal), refetchInterval: 2000 });
  const log = useQuery({ queryKey: ['job-log', id], queryFn: ({ signal }) => api.text(`/api/jobs/${encodeURIComponent(id!)}/log`, signal), enabled: !!id, refetchInterval: 3000 });
  return <><header className="page-heading"><div><h1>Jobs</h1><p>Latest 200 durable jobs. Build outcomes appear here.</p></div><Button onClick={() => void query.refetch()} disabled={query.isFetching}>Refresh jobs</Button></header><QueryState query={query} label="jobs">{data => data.jobs.length ? <TableWrapper label="Jobs"><table><thead><tr><th>Target</th><th>State</th><th>Progress</th><th>Started</th><th>Log</th></tr></thead><tbody>{data.jobs.map(job => <tr key={job.id}><th scope="row">{job.kind === 'schedule' ? job.folder : <Link to={itemUrl(job.folder)}>{job.folder.split(/[\\/]/).pop()}</Link>}<span className="item-subtitle">{job.kind}</span></th><td><Badge tone={job.status === 'completed' ? 'success' : job.status === 'failed' ? 'danger' : 'neutral'}>{job.status}</Badge></td><td>{job.progress}/{job.total}</td><td>{date(job.started_at)}<span className="item-subtitle">Finished: {date(job.finished_at)}</span></td><td><Button onClick={() => setParams({ job: job.id })}>View log</Button><p>{job.messages}</p></td></tr>)}</tbody></table></TableWrapper> : <div className="empty-state"><h2>No jobs yet</h2><p>Build a matched item or run a schedule to queue work.</p></div>}</QueryState>{id && <section className="panel"><div className="actions"><h2>Job log</h2><Button onClick={() => setParams({})}>Close log</Button></div><QueryState query={log} label="job log">{data => <pre className="log-output">{data || 'No log output yet.'}</pre>}</QueryState></section>}</>;
}
