import type { EditOp, EditRecord } from '@ck/session';
import type { HistoryEntry } from '@kit/ui';

export function describeOp(op: EditOp): string {
  switch (op.op) {
    case 'add': return `Add ${String(op.feature.type ?? 'feature')}${op.feature.id ? ' ' + String(op.feature.id) : ''}`;
    case 'set': return `Set ${op.id}.${op.path} = ${typeof op.value === 'object' ? JSON.stringify(op.value) : String(op.value)}`;
    case 'remove': return `Remove ${op.id}${op.cascade ? ' (with dependents)' : ''}`;
    case 'move': return `Move ${op.id} to position ${op.to}`;
    case 'replace': return `Replace ${op.id}`;
  }
}

const hhmm = (ms: number) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/** A rejected edit is not in the session history; the shell keeps it and says how many applied edits preceded it. */
export interface Rejection { at: number; time: number; reason: string; ops: EditOp[]; hint: string }

/** Edit records plus rejected attempts, oldest first. Applied entries come first by index; a rejection sits after `at` applied edits. */
export function toEntries(records: EditRecord[], rejections: Rejection[] = []): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  const fail = (r: Rejection, i: number): HistoryEntry => ({
    id: `rej-${i}-${r.time}`, author: 'you', time: hhmm(r.time), title: `Rejected: ${r.hint}`, failed: true,
    reason: r.reason || undefined, chips: ['document unchanged'], ops: r.ops.map(describeOp).join('; '),
  });
  const pending = [...rejections].map((r, i) => ({ r, i }));
  const flush = (n: number) => { for (const x of pending.filter((p) => p.r.at === n)) out.push(fail(x.r, x.i)); };
  flush(0);
  records.forEach((rec, idx) => {
    const first = rec.ops[0] ? describeOp(rec.ops[0]) : 'Empty edit';
    out.push({
      id: rec.id, author: rec.author === 'agent' ? 'agent' : 'you', time: hhmm(rec.time),
      title: rec.ops.length > 1 ? `${first} (+${rec.ops.length - 1} more)` : first,
      reason: rec.reason, chips: [`${rec.ops.length} op${rec.ops.length === 1 ? '' : 's'}`], ops: rec.ops.map(describeOp).join('; '),
    });
    flush(idx + 1);
  });
  return out;
}
