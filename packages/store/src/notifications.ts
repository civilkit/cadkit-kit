// The one notification service: every transient message the app shows (info, success, warning, error) goes through `notify`. The live list drives the toast stack; the history
// (the last HISTORY_MAX) lets a missed alert be read again. Pure data and signals: timers and hover-pausing live in the toast component, which dismisses by id.
import { computed, signal, type ReadonlySignal, type Signal } from '@preact/signals-core';

export type NoticeLevel = 'info' | 'success' | 'warning' | 'error';
/** What callers may pass: `warn` is the old spelling of `warning`. */
export type NoticeLevelInput = NoticeLevel | 'warn';

export interface Notice {
  id: number;
  text: string;
  level: NoticeLevel;
  /** when it was last raised (ms since the epoch) */
  at: number;
  /** how many identical messages were merged into this one */
  count: number;
  /** bumps each time an identical message merges in, so the toast restarts its timer */
  rev: number;
  /** a button on the toast, e.g. Undo or Show feature */
  action?: { label: string; run(): void };
  /** how long the toast stays, in ms, when it is not the level's default (a hint that is stale a few seconds later) */
  ttl?: number;
}

export interface NotifyOptions { ttl?: number }

export const HISTORY_MAX = 50;
/** The most toasts alive at once; older ones go to the history only. */
export const LIVE_MAX = 5;

export const normaliseLevel = (l: NoticeLevelInput | undefined): NoticeLevel => (l === 'warn' ? 'warning' : l ?? 'info');

/** How long a toast stays when nobody touches it, in ms: about 4 s plus 60 ms a character for info and success (an action gives at least 8 s so it can be reached);
 *  warnings stay at least 20 s and errors at least 60 s, long enough that they are dismissed rather than missed. */
export function noticeDuration(level: NoticeLevelInput, text: string, hasAction = false): number {
  const base = 4000 + 60 * text.length;
  switch (normaliseLevel(level)) {
    case 'error': return Math.min(120000, Math.max(60000, base));
    case 'warning': return Math.min(60000, Math.max(20000, base));
    default: return Math.min(20000, hasAction ? Math.max(8000, base) : base);
  }
}

export interface Notifications {
  /** the toasts alive now, oldest first */
  notices: Signal<Notice[]>;
  /** the last HISTORY_MAX messages, oldest first (identical consecutive messages merged with a count) */
  history: Signal<Notice[]>;
  /** messages raised since the history was last read */
  unread: ReadonlySignal<number>;
  unreadErrors: ReadonlySignal<number>;
  notify(text: string, level?: NoticeLevelInput, action?: Notice['action'], opts?: NotifyOptions): number;
  dismiss(id: number): void;
  /** dismisses the newest live toast; false when there is none */
  dismissNewest(): boolean;
  markRead(): void;
  clearHistory(): void;
}

export function createNotifications(now: () => number = Date.now): Notifications {
  let seq = 1;
  const notices = signal<Notice[]>([]);
  const history = signal<Notice[]>([]);
  const readUpTo = signal(0);
  const unreadList = computed(() => history.value.filter((n) => n.id > readUpTo.value && n.level !== 'info' && n.level !== 'success'));   // the Alerts counter is for warnings and errors, not for "Saved"
  const unread = computed(() => unreadList.value.length);
  const unreadErrors = computed(() => unreadList.value.filter((n) => n.level === 'error').length);

  const notify = (text: string, levelIn?: NoticeLevelInput, action?: Notice['action'], opts?: NotifyOptions): number => {
    const ttl = opts?.ttl;
    const level = normaliseLevel(levelIn), at = now(), id = seq++;
    // history: an identical message right after itself folds into one entry
    const h = history.value, last = h.at(-1);
    history.value = last && last.text === text && last.level === level && !action && !last.action
      ? [...h.slice(0, -1), { ...last, id, at, count: last.count + 1 }]
      : [...h, { id, text, level, at, count: 1, rev: 0, ...(action ? { action } : {}), ...(ttl ? { ttl } : {}) }].slice(-HISTORY_MAX);
    // live: the same text and level merges into the toast already showing (an action toast never merges)
    const live = notices.value;
    const i = action ? -1 : live.findIndex((n) => n.text === text && n.level === level && !n.action);
    if (i >= 0) {
      const next = live.slice(); next[i] = { ...live[i], at, count: live[i].count + 1, rev: live[i].rev + 1 };
      notices.value = next;
      return live[i].id;
    }
    notices.value = [...live, { id, text, level, at, count: 1, rev: 0, ...(action ? { action } : {}), ...(ttl ? { ttl } : {}) }].slice(-LIVE_MAX);
    return id;
  };
  return {
    notices, history, unread, unreadErrors, notify,
    dismiss(id) { if (notices.value.some((n) => n.id === id)) notices.value = notices.value.filter((n) => n.id !== id); },
    dismissNewest() { const n = notices.value.at(-1); if (!n) return false; notices.value = notices.value.slice(0, -1); return true; },
    markRead() { readUpTo.value = seq - 1; },
    clearHistory() { history.value = []; },
  };
}
