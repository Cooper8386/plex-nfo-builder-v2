import { useEffect, useId, useRef, useState, type ComponentPropsWithRef, type KeyboardEvent, type ReactNode } from 'react';

export function Button({ variant = 'secondary', className = '', type = 'button', ...props }: ComponentPropsWithRef<'button'> & { variant?: 'primary' | 'secondary' | 'quiet' }) {
  return <button {...props} type={type} className={`ui-button ui-button--${variant} ${className}`} />;
}

export function Input({ label, id, className = '', ...props }: ComponentPropsWithRef<'input'> & { label: string }) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return <label className="ui-field" htmlFor={inputId}><span>{label}</span><input {...props} id={inputId} className={`ui-input ${className}`} /></label>;
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'danger' }) {
  return <span className={`ui-badge ui-badge--${tone}`}>{children}</span>;
}

export function Select({ label, children, ...props }: ComponentPropsWithRef<'select'> & { label: string }) {
  return <label className="ui-field"><span>{label}</span><select {...props} className="ui-input">{children}</select></label>;
}

export function TableWrapper({ children, label }: { children: ReactNode; label: string }) {
  return <div className="ui-table-wrapper" role="region" aria-label={label} tabIndex={0}>{children}</div>;
}

export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const dialog = ref.current!;
    const previousFocus = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [open]);
  return <dialog ref={ref} className="ui-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="ui-dialog__heading"><h2 id={titleId}>{title}</h2><Button variant="quiet" onClick={onClose} aria-label={`Close ${title}`}>Close</Button></div>
    {children}
  </dialog>;
}

export function Menu({ label, items }: { label: string; items: Array<{ label: string; onSelect: () => void }> }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const initialFocus = useRef(0);
  const menuId = useId();
  const triggerId = useId();
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[initialFocus.current]?.focus();
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);
  function close() { setOpen(false); trigger.current?.focus(); }
  function handleKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    // Return to the trigger before the browser follows its normal tab order.
    if (event.key === 'Tab') { close(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...menu.current!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }
  return <div ref={root} className="ui-menu" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button ref={trigger} id={triggerId} type="button" className="ui-button ui-button--secondary" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} disabled={!items.length}
      onClick={() => { initialFocus.current = 0; setOpen(!open); }}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); initialFocus.current = event.key === 'ArrowUp' ? items.length - 1 : 0; setOpen(true);
        }
      }}>{label}<span aria-hidden="true">⌄</span></button>
    {open && <div ref={menu} id={menuId} role="menu" aria-labelledby={triggerId} className="ui-menu__items" onKeyDown={handleKeys}>
      {items.map((item, index) => <button key={index} type="button" role="menuitem" tabIndex={-1} onClick={() => { close(); item.onSelect(); }}>{item.label}</button>)}
    </div>}
  </div>;
}
