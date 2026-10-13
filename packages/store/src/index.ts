import { signal, type Signal } from '@preact/signals-core';

export type SelectionMode = 'face' | 'edge' | 'vertex';
export interface Notice { id: number; text: string; level: 'info' | 'warn' | 'error'; }
export interface FeatureStatus { id: string; ok: boolean; code?: string; hint?: string; }

export function createStore() {
  let noticeSeq = 1;
  const selection = signal<string[]>([]);
  const mode = signal<SelectionMode>('face');
  const hover = signal<string | null>(null);
  const tool = signal<string | null>(null);
  const busy = signal(false);
  const notices = signal<Notice[]>([]);
  const featureStatus = signal<FeatureStatus[]>([]);

  const notify = (text: string, level: Notice['level'] = 'info') => {
    notices.value = [...notices.value, { id: noticeSeq++, text, level }].slice(-20);
  };
  return {
    selection, mode, hover, tool, busy, notices, featureStatus, notify,
    select(names: string[], additive = false) {
      selection.value = additive ? [...new Set([...selection.value, ...names])] : [...names];
    },
    toggle(name: string) {
      selection.value = selection.value.includes(name)
        ? selection.value.filter((n) => n !== name)
        : [...selection.value, name];
    },
    dropMissing(existing: Set<string>): string[] {
      const dropped = selection.value.filter((n) => !existing.has(n));
      if (dropped.length) {
        selection.value = selection.value.filter((n) => existing.has(n));
        notify(`Selection lost: ${dropped.join(', ')} no longer exists`, 'warn');
      }
      return dropped;
    },
  };
}
export type Store = ReturnType<typeof createStore>;