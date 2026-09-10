import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { DangerPreview, DangerRequest, DangerResponse, RecordRequest, RecordResponse, SeasonPosterProgress, NfoStatus } from 'shared';
import { api } from '../lib/api.js';
import { Button, Badge } from '../design/primitives/index.js';
import { useConfirm } from '../components/ConfirmDialog.js';

export const itemUrl = (path: string, tab = 'overview') => `/items?${new URLSearchParams({ path, tab })}`;
export const date = (value: number | null) => value ? new Date(value).toLocaleString() : 'Never';
export const seasonName = (season: number) => season === 0 ? 'Specials' : `Season ${season}`;
export function Status({ status }: { status: NfoStatus }) {
  return <Badge tone={status === 'complete' ? 'success' : status === 'none' ? 'neutral' : 'warning'}>{({ none: 'No NFOs', partial: 'Partial', complete: 'Complete', mixed: 'Mixed NFOs', foreign: 'Foreign NFOs' })[status]}</Badge>;
}
export function PosterProgress({ progress }: { progress: SeasonPosterProgress }) {
  return <div className="poster-progress"><strong>{({ not_started: 'Not started', in_progress: 'In progress', selected: 'Selected', not_applicable: 'Not applicable' })[progress.state]}</strong>
    {progress.state !== 'not_applicable' && <><span> {progress.selected_seasons.length}/{progress.required_seasons.length} seasons selected</span>
      {progress.missing_seasons.length > 0 && <p>Missing: {progress.missing_seasons.map(seasonName).join(', ')}</p>}
      {progress.unresolved_files.length > 0 && <p>Map seasons for: {progress.unresolved_files.join(', ')}</p>}</>}
  </div>;
}
export function useAction() {
  const client = useQueryClient(), active = useRef(false), trigger = useRef<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const retry = useRef<(() => Promise<unknown>) | null>(null);
  useEffect(() => {
    if (busy) return;
    // Wait for the dialog to close and the triggering button to become enabled.
    const timer = setTimeout(() => { if ((document.activeElement === document.body || document.activeElement?.closest('dialog:not([open])')) && trigger.current?.isConnected) trigger.current.focus(); }, 0);
    return () => clearTimeout(timer);
  }, [busy]);
  async function run(operation: () => Promise<unknown>, success = 'Saved.') {
    if (active.current) return;
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    active.current = true; setBusy(true); setError(''); setMessage(''); retry.current = () => run(operation, success);
    try { if (await operation() === false) return; await client.invalidateQueries(); setMessage(success); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'The action failed. Please retry.'); }
    finally { active.current = false; setBusy(false); }
  }
  const feedback = <>{error && <div role="alert" className="query-error"><p>{error}</p><Button disabled={busy} onClick={() => { void retry.current?.(); }}>Retry action</Button></div>}{message && <p role="status">{message}</p>}</>;
  return { busy, run, feedback };
}
export function PreviewList({ targets, files = [] }: { targets: string[]; files?: string[] }) {
  return <><p>{targets.length} targets{files.length ? ` · ${files.length} files` : ''}</p><ul className="preview-list">{[...new Set([...targets, ...files])].map(target => <li key={target}>{target}</li>)}</ul></>;
}
export function DangerAction({ label, endpoint, request, record, description }: { label: string; description: ReactNode; endpoint?: string; request?: DangerRequest; record?: RecordRequest }) {
  const confirm = useConfirm(), action = useAction();
  return <div className="danger-action"><div><strong>{label}</strong><p>{description}</p></div><Button className="danger-button" disabled={action.busy} onClick={() => void action.run(async () => {
    if (record) {
      const preview = await api.send<RecordResponse>('/api/previews', { ...record, dry_run: true });
      if (!('preview_id' in preview)) throw new Error('Expected a preview.');
      if (!await confirm({ title: label, body: <>{description}<PreviewList targets={preview.targets} files={preview.files} /></>, action: label })) return false;
      const result = await api.send<RecordResponse>('/api/previews', { ...record, dry_run: false, preview_id: preview.preview_id, confirm: true });
      if ('ok' in result && result.skipped) throw new Error(`${result.removed} removed; ${result.skipped} changed targets preserved. Preview again to review them.`);
    } else {
      const preview = await api.send<DangerResponse>(endpoint!, { ...request, dry_run: true }) as DangerPreview;
      if (!preview.preview_id) throw new Error('Expected a preview.');
      if (!await confirm({ title: label, body: <>{description}<PreviewList targets={preview.folders} files={preview.files} />{preview.skipped.map(item => <p key={item.path}>{item.path}: {item.reason}</p>)}</>, action: label })) return false;
      const result = await api.send<DangerResponse>(endpoint!, { ...request, dry_run: false, preview_id: preview.preview_id, confirm: true });
      if ('ok' in result && result.skipped.length) throw new Error(`${result.removed.length} removed; ${result.skipped.length} skipped. Preview again to review remaining targets.`);
    }
  }, 'Request finished.')} >{action.busy ? 'Working…' : 'Preview'}</Button>{action.feedback}</div>;
}
