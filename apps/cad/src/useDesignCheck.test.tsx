import './i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/preact';
import { createStore } from '@kit/store';
import { useDesignCheck, type ViewportLike } from './useDesignCheck';
import type { Controller } from './controller';

afterEach(cleanup);

const profile = { id: 'fdm-print', name: 'FDM 3D printing', description: '', rules: [{ id: 'minWall', title: 'Minimum wall', description: '', severity: 'error', params: [{ name: 'min', type: 'number', default: 1.2, value: 1.2, unit: 'mm', description: '' }] }] };
const issue = { rule: 'minWall', severity: 'error', message: 'thin', faces: ['F2.C1', 'F4.C1'], edges: [], value: 0.5, limit: 1.2, unit: 'mm' };
const report = { profile: { id: 'fdm-print', name: 'FDM 3D printing' }, ok: false, issues: [issue], summary: { errors: 1, warnings: 0, infos: 0, total: 1, rules: [], truncated: [], skippedFaces: [], samples: 1 } };

function setup() {
  const fake = {
    revision: 1, policy: null, onCheck: null,
    profiles: async () => ({ profiles: [profile], rules: [] }),
    checkProfile: vi.fn(async () => ({ report, revision: fake.revision })),
  };
  const vp = { setIssueFaces: vi.fn(), setIssueHover: vi.fn(), frameNames: vi.fn() } satisfies ViewportLike;
  const store = createStore();
  let out!: ReturnType<typeof useDesignCheck>;
  const open = vi.fn();
  function Probe() { out = useDesignCheck(fake as unknown as Controller, store, () => vp, open); return null; }
  render(<Probe />);
  return { fake, vp, store, open, get: () => out };
}
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe('useDesignCheck', () => {
  it('loads the catalogue without running a check; no chip before a run', async () => {
    const h = setup(); await tick();
    expect(h.get().props.profiles!.length).toBe(1);
    expect(h.fake.checkProfile).not.toHaveBeenCalled();
    expect(h.get().chip).toBeNull();
  });

  it('run: sends the inline rules, shows the chip, tints the faces; clicking an issue selects faces and frames them', async () => {
    const h = setup(); await tick();
    await act(async () => { await h.get().props.onRun(); });
    expect((h.fake.checkProfile.mock.calls[0] as unknown[])[0]).toMatchObject({ id: 'fdm-print', rules: [{ id: 'minWall', severity: 'warn', params: { min: 1.2 } }] });
    expect(h.get().chip!.label + h.get().chip!.value).toBe('FDM 3D printing:1 error');
    expect(h.vp.setIssueFaces).toHaveBeenLastCalledWith({ 'F2.C1': 'error', 'F4.C1': 'error' });
    act(() => h.get().props.onSelect(issue as never));
    expect(h.store.selection.value).toEqual(['F2.C1', 'F4.C1']);
    expect(h.store.mode.value).toBe('face');
    expect(h.vp.frameNames).toHaveBeenCalledWith(['F2.C1', 'F4.C1']);
    act(() => h.get().props.onHover(issue as never));
    expect(h.vp.setIssueHover).toHaveBeenLastCalledWith(['F2.C1', 'F4.C1']);
    h.get().chip!.onClick!();
    expect(h.open).toHaveBeenCalled();
  });

  it('an edge issue selects in edge mode; a changed document makes the result stale and clears the tint', async () => {
    const h = setup(); await tick();
    await act(async () => { await h.get().props.onRun(); });
    act(() => h.get().props.onSelect({ ...issue, edges: ['A|B#1'] } as never));
    expect(h.store.mode.value).toBe('edge');
    expect(h.store.selection.value).toEqual(['A|B#1']);
    h.fake.revision = 2;
    await act(async () => { h.get().props.onAfterEdit(true); });   // any re-render
    expect(h.get().props.stale).toBe(true);
    expect(h.vp.setIssueFaces).toHaveBeenLastCalledWith({});
    expect(h.get().chip!.dim).toBe(true);
  });
});
