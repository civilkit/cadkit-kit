import type { EditOp, EditRecord } from '@ck/session';
import type { HistoryEntry } from '@kit/ui';
import { t } from './i18n';

export function describeOp(op: EditOp): string {
  switch (op.op) {
    case 'add': {
      const type = String(op.feature.type ?? t('history.op.feature'));
      return op.feature.id ? t('history.op.add', { type, id: String(op.feature.id) }) : t('history.op.addAnon', { type });
    }
    case 'set': return t('history.op.set', { id: op.id, path: op.path, value: typeof op.value === 'object' ? JSON.stringify(op.value) : String(op.value) });
    case 'remove': return t(op.cascade ? 'history.op.removeCascade' : 'history.op.remove', { id: op.id });
    case 'move': return t('history.op.move', { id: op.id, to: op.to });
    case 'replace': return t('history.op.replace', { id: op.id });
  }
}

const hhmm = (ms: number) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/** A rejected edit is not in the session history; the shell keeps it and says how many applied edits preceded it. */
export interface Rejection { at: number; time: number; reason: string; ops: EditOp[]; hint: string }

/** Edit records plus rejected attempts, oldest first. Applied entries come first by index; a rejection sits after `at` applied edits. */
export function toEntries(records: EditRecord[], rejections: Rejection[] = []): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  const fail = (r: Rejection, i: number): HistoryEntry => ({
    id: `rej-${i}-${r.time}`, author: 'you', time: hhmm(r.time), title: t('history.rejected', { hint: r.hint }), failed: true,
    reason: r.reason || undefined, chips: [t('history.unchanged')], ops: r.ops.map(describeOp).join('; '),
  });
  const pending = [...rejections].map((r, i) => ({ r, i }));
  const flush = (n: number) => { for (const x of pending.filter((p) => p.r.at === n)) out.push(fail(x.r, x.i)); };
  flush(0);
  records.forEach((rec, idx) => {
    const first = rec.ops[0] ? describeOp(rec.ops[0]) : rec.reason ? t(rec.reason, undefined, rec.reason) : t('history.empty');
    out.push({
      id: rec.id, author: rec.author === 'agent' ? 'agent' : 'you', time: hhmm(rec.time),
      title: rec.ops.length > 1 ? t('history.more', { first, count: rec.ops.length - 1 }) : first,
      reason: rec.reason, chips: [t('history.opCount', { count: rec.ops.length })], ops: rec.ops.map(describeOp).join('; '),
    });
    flush(idx + 1);
  });
  return out;
}
