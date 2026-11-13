import { describe, expect, it } from 'vitest';
import { repairHint } from './hints';

const line = { id: 'F1', type: 'sketch', plane: { kind: 'std', id: 'front' }, points: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 10, y: 5 }], entities: [{ id: 'e1', type: 'line', p1: 'a', p2: 'b' }] };
const closed = { id: 'F1', type: 'sketch', points: [], entities: [{ id: 'e1', type: 'circle', c: 'a', r: 5 }] };
const doc = (sk: unknown, type = 'extrude') => ({ features: [sk as Record<string, unknown>, { id: 'F2', type, sketch: 'F1' }] });

describe('noClosedProfile', () => {
  it('on an extrude or revolve of one open line points to rib and thin', () => {
    for (const type of ['extrude', 'revolve']) {
      const h = repairHint('F2', 'noClosedProfile', {}, doc(line, type));
      expect(h, type).toContain('.rib(');
      expect(h, type).toContain('thin');
    }
  });
  it('keeps the general hint when the sketch is not one open line', () => {
    const h = repairHint('F2', 'noClosedProfile', {}, doc({ ...closed, entities: [{ id: 'e1', type: 'line', p1: 'a', p2: 'b' }, { id: 'e2', type: 'circle', c: 'a', r: 2 }] }));
    expect(h).not.toContain('.rib(');
    expect(repairHint('F2', 'noClosedProfile', {})).not.toContain('.rib(');
  });
});
