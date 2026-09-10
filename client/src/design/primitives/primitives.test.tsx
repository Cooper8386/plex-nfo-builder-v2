// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { Dialog, Menu } from './index.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test('menu supports directional navigation, selection, Escape, Tab and outside dismissal', async () => {
  const user = userEvent.setup();
  const select = vi.fn();
  render(<><Menu label="Library actions" items={[{ label: 'First action', onSelect: select }, { label: 'Last action', onSelect: select }]} /><button>After menu</button></>);
  const trigger = screen.getByRole('button', { name: 'Library actions' });
  trigger.focus();
  await user.keyboard('{ArrowUp}');
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Last action' }));
  await user.keyboard('{ArrowDown}');
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'First action' }));
  await user.keyboard('{End}');
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Last action' }));
  await user.keyboard('{Home}{Enter}');
  expect(select).toHaveBeenCalledOnce();
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  await user.keyboard('{ArrowDown}{Escape}');
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  await user.keyboard('{ArrowDown}');
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'After menu' }));
  expect(screen.queryByRole('menu')).toBeNull();
  await user.click(trigger);
  await user.click(screen.getByRole('button', { name: 'After menu' }));
  expect(screen.queryByRole('menu')).toBeNull();
});

test('dialog uses the modal API, requests Escape dismissal and restores prior focus', () => {
  const onClose = vi.fn();
  const view = render(<><button>Open details</button><Dialog open={false} onClose={onClose} title="Details"><p>Library details</p></Dialog></>);
  // jsdom does not implement the native modal API; verify our lifecycle around it.
  const dialog = view.container.querySelector('dialog')!;
  const showModal = vi.fn(() => dialog.setAttribute('open', ''));
  const close = vi.fn(() => dialog.removeAttribute('open'));
  dialog.showModal = showModal;
  dialog.close = close;
  const trigger = screen.getByRole('button', { name: 'Open details' });
  trigger.focus();
  view.rerender(<><button>Open details</button><Dialog open onClose={onClose} title="Details"><p>Library details</p></Dialog></>);
  expect(showModal).toHaveBeenCalledOnce();
  expect(screen.getByRole('dialog', { name: 'Details' })).toBe(dialog);
  screen.getByRole('button', { name: 'Close Details' }).focus();
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  expect(onClose).toHaveBeenCalledOnce();
  view.rerender(<><button>Open details</button><Dialog open={false} onClose={onClose} title="Details"><p>Library details</p></Dialog></>);
  expect(close).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(trigger);
});
