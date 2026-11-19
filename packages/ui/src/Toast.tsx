import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { noticeDuration, type Notice, type NoticeLevel } from '@kit/store';
import { t } from './i18n';
import { copyText } from './clipboard';

/** Past this many characters a message is collapsed to three lines with a Show more button (the measured overflow decides too, where the browser can measure). */
export const TOAST_LONG = 150;

const ICON: Record<NoticeLevel, string> = { info: 'i', success: '✓', warning: '!', error: '✕' };

function ToastItem(p: { n: Notice; onDismiss(id: number): void }): JSX.Element {
  const { n } = p;
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const [paused, setPaused] = useState(false);
  const text = useRef<HTMLSpanElement>(null);
  // The timer: it runs only while nothing hovers or focuses the toast, resumes with what is left, and restarts when an identical message merges in (rev).
  const left = useRef((n.ttl ?? noticeDuration(n.level, n.text, !!n.action)));
  useEffect(() => { left.current = (n.ttl ?? noticeDuration(n.level, n.text, !!n.action)); }, [n.rev, n.level, n.text, !!n.action]);
  useEffect(() => {
    if (paused) return;
    const t0 = Date.now();
    const h = setTimeout(() => p.onDismiss(n.id), Math.max(0, left.current));
    return () => { clearTimeout(h); left.current -= Date.now() - t0; };
  }, [paused, n.rev, n.id]);
  useLayoutEffect(() => { const el = text.current; if (el && !open) setOverflow(el.scrollHeight > el.clientHeight + 1); }, [n.text, open]);
  const long = n.text.length > TOAST_LONG || overflow;
  const act = n.action;
  return (
    <div class={'toast ' + n.level + (open ? ' open' : '')} role={n.level === 'error' ? 'alert' : 'status'} data-level={n.level}
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocusCapture={() => setPaused(true)} onBlurCapture={() => setPaused(false)}>
      <span class="toast-icon" aria-hidden="true">{ICON[n.level]}</span>
      <div class="toast-body">
        <span class={'toast-text' + (long && !open ? ' clamp' : '')} ref={text}>{n.text}</span>
        {n.count > 1 ? <span class="toast-count" aria-label={t('ui.alert.times', { count: n.count })}>{'×'}{n.count}</span> : null}
        {long || act || n.level === 'error' ? (
          <div class="toast-actions">
            {act ? <button type="button" class="toast-act" onClick={() => { act.run(); p.onDismiss(n.id); }}>{act.label}</button> : null}
            {long ? <button type="button" class="toast-more" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? t('ui.alert.less') : t('ui.alert.more')}</button> : null}
            {n.level === 'error' ? <button type="button" class="toast-copy" onClick={async () => { if (await copyText(n.text)) { setCopied(true); setTimeout(() => setCopied(false), 1500); } }}>{copied ? t('ui.alert.copied') : t('ui.alert.copy')}</button> : null}
          </div>
        ) : null}
      </div>
      <button type="button" class="toast-close" aria-label={t('ui.alert.close')} title={t('ui.alert.close')} onClick={() => p.onDismiss(n.id)}>{'×'}</button>
    </div>
  );
}

/** The toast stack: one column in a fixed corner of the window (never over the model centre), newest at the bottom. Messages wrap, long ones collapse to three lines
 *  (Show more opens them in place; an error also has Copy), each has a close button, Esc closes the newest, hovering or focusing a toast holds its timer, and an
 *  identical message merges into the toast showing with a count. Errors and warnings are announced assertively (role=alert) and stay until closed or a long timeout. */
export function Toast(p: { notices: Notice[]; onDismiss(id: number): void }): JSX.Element | null {
  const newest = p.notices.at(-1)?.id;
  // Esc closes the newest toast, unless something else already took the key or the user is typing
  useEffect(() => {
    if (newest === undefined) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      p.onDismiss(newest);
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [newest, p.onDismiss]);
  if (!p.notices.length) return null;
  return <div class="toast-stack" data-testid="toast-stack">{p.notices.map((n) => <ToastItem key={n.id} n={n} onDismiss={p.onDismiss} />)}</div>;
}
