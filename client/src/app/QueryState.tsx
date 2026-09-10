import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { Button } from '../design/primitives/index.js';

export function QueryState<T>({ query, label, children }: { query: UseQueryResult<T, Error>; label: string; children: (data: T) => ReactNode }) {
  if (query.isError) return <div className="query-state query-error" role="alert">
    <h2>Could not load {label}</h2><p>{query.error.message}</p>
    <Button onClick={() => { void query.refetch(); }} disabled={query.isFetching}>{query.isFetching ? 'Retrying…' : 'Retry'}</Button>
  </div>;
  if (query.isPending) return <p className="query-state" role="status">Loading {label}…</p>;
  return children(query.data);
}
