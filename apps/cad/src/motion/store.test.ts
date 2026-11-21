import { describe, expect, it } from 'vitest';
import { createMotionStore } from './store';
import { fakeDeps } from './testkit';
import '../i18n';

const flush = () => new Promise((r) => setTimeout(r, 0));
async function ready() {
  const store = createMotionStore();
  const f = fakeDeps();
  store.attach(f.deps);
  const release = store.use();
  await flush();
  return { store, ...f, release };
}

describe('motion store: drivers and sliders', () => {
  it('asks for the drivers only while a view is on screen, and again when the document changes', async () => {
    const store = createMotionStore();
    const { deps, calls } = fakeDeps();
    store.attach(deps);
    await flush();
    expect(calls.solves).toHaveLength(0);
    expect(store.drivers.value).toBeNull();
    const release = store.use();
    await flush();
    expect(store.drivers.value).toEqual([{ mate: 'F3', kind: 'distance', unit: 'mm', value: 0 }]);
    expect(calls.solves[0]).toEqual({ poses: [], opts: { contact: false } });
    store.attach({ ...deps, docKey: 'k2' });
    await flush();
    expect(calls.solves).toHaveLength(2);
    release();
    store.attach({ ...deps, docKey: 'k3' });
    await flush();
    expect(calls.solves).toHaveLength(2); // nothing on screen: not asked
  });

  it('a slider value shows the pose; one past the stop reports what it hits; reset clears it', async () => {
    const { store, calls } = await ready();
    store.setValue('F3', 5);
    await flush();
    expect(calls.solves.at(-1)!.poses).toEqual([{ F3: 5 }]);
    expect(store.pose.value!.get('F2')!.t[0]).toBe(5);
    expect(store.contact.value).toBeNull();
    store.setValue('F3', 12);
    await flush();
    expect(store.contact.value).toMatchObject({ a: 'F1', b: 'F2', kind: 'contact' });
    store.reset();
    expect(store.pose.value).toBeNull();
    expect(store.values.value).toEqual({});
    expect(store.contact.value).toBeNull();
  });

  it('passes the clearance on, finds limits both ways, keeps them as the range and copies them to a limit', async () => {
    const { store, calls } = await ready();
    store.setClearance(0.5);
    store.setValue('F3', 3);
    await flush();
    expect((calls.solves.at(-1)!.opts as { clearance: number }).clearance).toBe(0.5);
    await store.findLimits('F3');
    expect(calls.sweeps).toEqual([{ driver: 'F3', from: 0, to: -100, clearance: 0.5 }, { driver: 'F3', from: 0, to: 100, clearance: 0.5 }]);
    store.useAsRange('F3');
    expect(store.motion.value.drivers).toEqual([{ mate: 'F3', min: -8, max: 8, value: 3 }]);
    expect((calls.saved.at(-1) as { limitsFound: unknown[] }).limitsFound).toHaveLength(1);
    expect(await store.copyToLimits('F3')).toBeNull();
    expect(calls.limits).toEqual([['F3', -8, 8]]);
  });
});

describe('motion store: studies', () => {
  it('make a study, key two moments, solve it once for its frames and say what it touches', async () => {
    const { store, calls } = await ready();
    store.newStudy();
    expect(store.study()!.id).toBe('s1');
    store.addKey('F3'); // slider at 0, time 0
    store.setValue('F3', 12);
    await flush();
    store.time.value = 4;
    store.addKey('F3');
    expect(store.study()!.tracks[0].keys).toEqual([{ t: 0, v: 0, ease: 'inOut' }, { t: 4, v: 12, ease: 'inOut' }]);
    // the keys are saved in the document's motion record and the next redraw hands the same record back
    expect((calls.saved.at(-1) as { studies: unknown[] }).studies).toHaveLength(1);
    const solved = await store.build();
    const frames = calls.solves.filter((s) => s.poses.length === 121).at(-1)!.poses;
    expect(frames[0]).toEqual({ F3: 0 });
    expect(frames[120]).toEqual({ F3: 12 });
    expect(solved!.deltas).toHaveLength(121);
    expect(store.issue()).toMatchObject({ kind: 'contact', a: 'F1', b: 'F2' });
    // (eased 0 to 12 over 4 s passes 8 at t = 2.4 s: the first frame after is 2.467)
    expect(store.issue()!.time).toBeGreaterThan(2.4);
    expect(store.issue()!.time).toBeLessThan(2.5);
    // the same frames are not asked for again
    const n = calls.solves.length;
    await store.build();
    expect(calls.solves).toHaveLength(n);
    // editing the study drops them
    store.setDuration(2);
    expect(store.solved.value).toBeNull();
  });

  it('seeking shows the frame of that time; deleting the study and a document change drop what was solved', async () => {
    const { store, deps } = await ready();
    store.newStudy();
    store.addKey('F3');
    store.setValue('F3', 6);
    await flush();
    store.time.value = 2;
    store.addKey('F3');
    await store.seek(2);
    expect(store.time.value).toBe(2);
    expect(store.pose.value!.get('F2')!.t[0]).toBeCloseTo(6, 9);
    store.attach({ ...deps, docKey: 'changed' });
    expect(store.solved.value).toBeNull();
    store.deleteStudy();
    expect(store.study()).toBeNull();
    expect(store.motion.value.studies).toEqual([]);
  });

  it('takes the motion record the document hands back (opened, undone) as its own', async () => {
    const { store, deps } = await ready();
    store.attach({ ...deps, motion: { version: 1, drivers: [], studies: [{ id: 'sx', name: 'Loaded', duration: 3, loop: 'loop', clearance: 0, tracks: [{ driver: 'F3', keys: [{ t: 0, v: 1 }, { t: 3, v: 2 }] }] }] } });
    expect(store.studies().map((s) => s.name)).toEqual(['Loaded']);
    expect(store.study()!.loop).toBe('loop');
  });
});
