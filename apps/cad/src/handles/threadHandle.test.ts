import { describe, expect, it } from 'vitest';
import type { EditOp } from '@ck/session';
import { planHandles, type PlanCtx } from './plan';
import { lengthValue, threadLengthSession, type ThreadHandleCtx } from './threadHandle';
import { HandleRunner } from './runner';
import '../i18n';

const entry = { id: 'F6', start: [0, 39, 0], dir: [0, -1, 0], length: 30, pitch: 1.5, major: 10 };
const ctx = (over: Partial<ThreadHandleCtx> = {}): ThreadHandleCtx => ({
  id: 'F6', entry, maxLength: 39,
  ops: (length) => [{ op: 'set', id: 'F6', path: 'length', value: length } as EditOp],
  ...over,
});

describe('lengthValue', () => {
  it('holds the dragged length between one pitch and the face; the face length means full', () => {
    expect(lengthValue(12.3456, 39, 1.5)).toBe(12.346);
    expect(lengthValue(0.2, 39, 1.5)).toBe(1.5);
    expect(lengthValue(39, 39, 1.5)).toBe('full');
    expect(lengthValue(80, 39, 1.5)).toBe('full');
    expect(lengthValue(80, null, 1.5)).toBe(80);
  });
});

describe('threadLengthSession', () => {
  it('a dot on the axis at start + dir * length, base = the length, one unit per mm', () => {
    const s = threadLengthSession(ctx())!;
    expect(s.kind).toBe('thread-length');
    expect(s.target).toBe('F6');
    expect(s.specs).toHaveLength(1);
    expect(s.specs[0]).toMatchObject({ id: 'length', kind: 'dot', origin: [0, 9, 0], axis: [0, -1, 0], base: 30, scale: 1, unit: 'mm' });
  });
  it('the preview sets length through the ops of the editor, clamped; past the face it is "full"', () => {
    const s = threadLengthSession(ctx())!;
    expect(s.preview('length', 18, [0, 0, 0])).toEqual([{ op: 'set', id: 'F6', path: 'length', value: 18 }]);
    expect(s.preview('length', 200, [0, 0, 0])).toEqual([{ op: 'set', id: 'F6', path: 'length', value: 'full' }]);
    expect(s.preview('length', -5, [0, 0, 0])).toEqual([{ op: 'set', id: 'F6', path: 'length', value: 1.5 }]);
  });
  it('release edits no document: it hands the value to the editor as a draft patch', () => {
    const s = threadLengthSession(ctx())!;
    expect(s.commit('length', 18, [0, 0, 0])).toEqual({ ops: [], create: false, draft: { length: 18 } });
    expect(s.commit('length', 99, [0, 0, 0])!.draft).toEqual({ length: 'full' });
  });
  it('the readout says the length', () => {
    expect(threadLengthSession(ctx())!.format!('length', 18.456)).toBe('Thread length 18.46 mm');
  });
  it('ctrl snaps to whole mm through the framework (no step override), and a bad entry gives no handle', () => {
    expect(threadLengthSession(ctx())!.step).toBeUndefined();
    expect(threadLengthSession(ctx({ entry: { ...entry, length: 0 } }))).toBeNull();
    expect(threadLengthSession(ctx({ entry: { ...entry, dir: [0, 0, 0] } }))).toBeNull();
    expect(threadLengthSession(ctx({ entry: { ...entry, start: [0, 0] } }))).toBeNull();
  });
});

describe('planHandles with the Thread editor open', () => {
  const base: PlanCtx = { doc: null, selection: [], mode: 'face', edges: [], mesh: null, box: null, editingId: 'F6', sketching: false, enabled: true, thread: ctx() };
  it('is the only handle while an editor is open, and only for the thread being edited', () => {
    expect(planHandles(base)!.kind).toBe('thread-length');
    expect(planHandles({ ...base, editingId: 'F2' })).toBeNull();
    expect(planHandles({ ...base, enabled: false })).toBeNull();
    expect(planHandles({ ...base, sketching: true })).toBeNull();
    expect(planHandles({ ...base, thread: null })).toBeNull();
  });
});

describe('the runner with a draft commit', () => {
  it('previews while dragging, hands the draft on release and keeps the preview (no cancel)', async () => {
    const log: string[] = [];
    const drafts: Array<Record<string, unknown>> = [];
    const runner = new HandleRunner({
      preview: async (ops) => { log.push('preview ' + JSON.stringify((ops[0] as unknown as { value: unknown }).value)); return { ok: true }; },
      cancelPreview: async () => { log.push('cancel'); },
      commit: async (c) => { if (c.draft) drafts.push(c.draft); },
    });
    const s = threadLengthSession(ctx())!;
    const sink = runner.sink(s);
    sink.onStart!('length');
    sink.onDrag('length', 20, [0, 0, 0]);
    await new Promise((r) => setTimeout(r, 5));
    sink.onDrag('length', 25, [0, 0, 0]);
    await new Promise((r) => setTimeout(r, 5));
    await runner.commit(s.commit('length', 25, [0, 0, 0]));
    expect(log).toEqual(['preview 20', 'preview 25']);
    expect(drafts).toEqual([{ length: 25 }]);
  });
});
