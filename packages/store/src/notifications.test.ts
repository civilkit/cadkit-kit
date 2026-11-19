import { describe, it, expect } from 'vitest';
import { createNotifications, noticeDuration, HISTORY_MAX, LIVE_MAX } from './notifications';

describe('noticeDuration', () => {
  it('is about 4 s plus 60 ms a character for info and success, capped at 20 s', () => {
    expect(noticeDuration('info', '')).toBe(4000);
    expect(noticeDuration('success', 'x'.repeat(50))).toBe(7000);
    expect(noticeDuration('info', 'x'.repeat(5000))).toBe(20000);
  });
  it('gives an action at least 8 s', () => {
    expect(noticeDuration('info', 'Deleted F5', true)).toBe(8000);
    expect(noticeDuration('info', 'Deleted F5')).toBeLessThan(8000);
  });
  it('keeps warnings at least 20 s and errors at least 60 s, longer for long text', () => {
    expect(noticeDuration('warning', 'short')).toBe(20000);
    expect(noticeDuration('warn', 'short')).toBe(20000);   // the old spelling
    expect(noticeDuration('error', 'short')).toBe(60000);
    expect(noticeDuration('error', 'x'.repeat(2000))).toBe(120000);
    expect(noticeDuration('error', 'x'.repeat(1500))).toBe(94000);
  });
});

describe('createNotifications', () => {
  it('maps warn to warning and defaults to info', () => {
    const a = createNotifications();
    a.notify('a'); a.notify('b', 'warn');
    expect(a.notices.value.map((n) => n.level)).toEqual(['info', 'warning']);
  });
  it('merges an identical live message into one toast with a count and a new rev', () => {
    const a = createNotifications();
    const id = a.notify('Saved'); const again = a.notify('Saved'); a.notify('Saved');
    expect(again).toBe(id);
    expect(a.notices.value).toHaveLength(1);
    expect(a.notices.value[0]).toMatchObject({ count: 3, rev: 2 });
    a.notify('Saved', 'error');
    expect(a.notices.value).toHaveLength(2);   // another level is another message
  });
  it('a message can carry its own lifetime, kept when identical ones merge in', () => {
    const a = createNotifications();
    a.notify('Hint', 'warn', undefined, { ttl: 6000 }); a.notify('Hint', 'warn', undefined, { ttl: 6000 });
    expect(a.notices.value).toHaveLength(1);
    expect(a.notices.value[0]).toMatchObject({ ttl: 6000, count: 2 });
    a.notify('Plain');
    expect(a.notices.value[1].ttl).toBeUndefined();
  });
  it('never merges a message that has an action', () => {
    const a = createNotifications(); const act = { label: 'Undo', run() {} };
    a.notify('Deleted F5', 'info', act); a.notify('Deleted F5', 'info', act);
    expect(a.notices.value).toHaveLength(2);
  });
  it('a dismissed message comes back as a new toast', () => {
    const a = createNotifications();
    const id = a.notify('Saved'); a.dismiss(id);
    expect(a.notices.value).toHaveLength(0);
    a.notify('Saved');
    expect(a.notices.value).toHaveLength(1); expect(a.notices.value[0].count).toBe(1);
  });
  it('dismiss removes one by id, dismissNewest the last, and both leave the history alone', () => {
    const a = createNotifications();
    const one = a.notify('one'); a.notify('two'); a.notify('three');
    a.dismiss(one); expect(a.notices.value.map((n) => n.text)).toEqual(['two', 'three']);
    expect(a.dismissNewest()).toBe(true); expect(a.notices.value.map((n) => n.text)).toEqual(['two']);
    a.dismiss(999); expect(a.notices.value).toHaveLength(1);
    expect(a.history.value).toHaveLength(3);
    a.dismissNewest(); expect(a.dismissNewest()).toBe(false);
  });
  it('keeps at most LIVE_MAX toasts, the oldest going to the history only', () => {
    const a = createNotifications();
    for (let i = 0; i < LIVE_MAX + 3; i++) a.notify('m' + i);
    expect(a.notices.value).toHaveLength(LIVE_MAX);
    expect(a.notices.value.at(-1)!.text).toBe('m' + (LIVE_MAX + 2));
    expect(a.history.value).toHaveLength(LIVE_MAX + 3);
  });
  it('caps the history at HISTORY_MAX, dropping the oldest', () => {
    const a = createNotifications();
    for (let i = 0; i < HISTORY_MAX + 20; i++) a.notify('m' + i);
    expect(a.history.value).toHaveLength(HISTORY_MAX);
    expect(a.history.value[0].text).toBe('m20');
  });
  it('folds identical consecutive messages in the history into one entry with a count', () => {
    const a = createNotifications();
    a.notify('x'); a.notify('x'); a.notify('y'); a.notify('x');
    expect(a.history.value.map((n) => [n.text, n.count])).toEqual([['x', 2], ['y', 1], ['x', 1]]);
  });
  it('counts unread messages and unread errors until they are marked read or cleared', () => {
    const a = createNotifications();
    a.notify('i'); a.notify('boom', 'error'); a.notify('boom', 'error');
    expect(a.unread.value).toBe(2); expect(a.unreadErrors.value).toBe(1);
    a.markRead(); expect(a.unread.value).toBe(0); expect(a.unreadErrors.value).toBe(0);
    a.notify('boom', 'error'); expect(a.unreadErrors.value).toBe(1);   // the folded entry is unread again
    a.clearHistory(); expect(a.history.value).toEqual([]); expect(a.unread.value).toBe(0);
  });
  it('stamps the time from the clock it was given', () => {
    let t = 5000; const a = createNotifications(() => t);
    a.notify('x'); t = 9000; a.notify('x');
    expect(a.notices.value[0].at).toBe(9000);
  });
});
