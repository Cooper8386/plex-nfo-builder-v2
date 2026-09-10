import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from '../design/primitives/index.js';

interface Confirmation { title: string; body: ReactNode; action?: string }
const ConfirmContext = createContext<(value: Confirmation) => Promise<boolean>>(() => Promise.resolve(false));
export const useConfirm = () => useContext(ConfirmContext);
export function ConfirmDialog({ value, onDecision }: { value: Confirmation | null; onDecision: (confirmed: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null), cancel = useRef<HTMLButtonElement>(null), title = useId();
  useLayoutEffect(() => {
    if (!value) return;
    const dialog = ref.current!, previous = document.activeElement;
    dialog.showModal(); cancel.current?.focus();
    return () => { dialog.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [value]);
  return <dialog ref={ref} className="ui-dialog confirm-dialog" aria-labelledby={title} onCancel={event => { event.preventDefault(); onDecision(false); }} onKeyDown={event => {
    if (event.key !== 'Tab') return;
    const buttons = [...ref.current!.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')];
    const first = buttons[0], last = buttons.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}>
    <h2 id={title}>{value?.title}</h2><div className="confirm-body">{value?.body}</div>
    <div className="actions"><Button ref={cancel} onClick={() => onDecision(false)}>Cancel</Button><Button className="danger-button" onClick={() => onDecision(true)}>{value?.action ?? 'Confirm'}</Button></div>
  </dialog>;
}
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<Confirmation | null>(null);
  const pending = useRef<((value: boolean) => void) | null>(null);
  const confirm = useCallback((next: Confirmation) => {
    pending.current?.(false);
    setValue(next);
    return new Promise<boolean>(resolve => { pending.current = resolve; });
  }, []);
  useEffect(() => () => { pending.current?.(false); pending.current = null; }, []);
  return <ConfirmContext value={confirm}>{children}<ConfirmDialog value={value} onDecision={result => {
    pending.current?.(result); pending.current = null; setValue(null);
  }} /></ConfirmContext>;
}
