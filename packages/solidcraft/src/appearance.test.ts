import { describe, it, expect } from 'vitest';
import { bodyLooks } from './appearance';

const doc = (bodies: Record<string, unknown>, hidden: string[] = []) => ({ appearances: { bodies }, visibility: { hidden_bodies: hidden } });

describe('SolidCraft body colours', () => {
  const features = [{ id: 'F1', type: 'sketch' }, { id: 'F2', type: 'extrude', op: 'newBody', body: 'Arm' }, { id: 'F5', type: 'moveBody', copy: true, body: 'Arm 2' }, { id: 'F6', type: 'extrude', op: 'newBody', body: 'Hose' }];
  it('keys each look by the feature that made the body: colour, translucency, metallic and roughness', () => {
    const r = bodyLooks(doc({ Arm: { color: [255, 128, 0], opacity: 1, pbr: { metallic: 1, roughness: 0.32, dielectric_ior: 1.5 } }, 'Arm 2': { color: [0, 0, 255], opacity: 0.4 } }), features, ['Arm', 'Arm 2']);
    expect(r.appearance).toEqual({ F2: { color: '#ff8000', metallic: 1, roughness: 0.32 }, F5: { color: '#0000ff', opacity: 0.4 } });
  });
  it('hides the hidden bodies that are still alive, by their feature', () => {
    const r = bodyLooks(doc({ Arm: { color: [1, 2, 3], opacity: 1 }, Hose: { color: [1, 2, 3], opacity: 1 } }, ['Hose', 'Gone']), features, ['Arm', 'Hose']);
    expect(r.view).toEqual({ hiddenBodies: ['F6'] });
    expect(bodyLooks(doc({ Hose: { color: [1, 2, 3] } }, ['Hose']), features, []).view).toBeUndefined();   // consumed by a combine: nothing to hide
  });
  it('a file of one unnamed body colours its first adding feature', () => {
    const one = [{ id: 'F1', type: 'sketch' }, { id: 'F2', type: 'extrude', op: 'add' }];
    expect(bodyLooks(doc({ Body1: { color: [10, 20, 30], opacity: 1 } }), one, ['Body1']).appearance).toEqual({ F2: { color: '#0a141e' } });
  });
  it('clamps values and ignores what it cannot read', () => {
    const r = bodyLooks(doc({ Arm: { color: [300, -5, 'x'], opacity: 1, pbr: { metallic: 'high', roughness: 'rough' } } }), features, ['Arm']);
    expect(r.appearance).toBeUndefined();
    expect(bodyLooks(doc({ Arm: { color: [300, -5, 7], opacity: 0, pbr: { metallic: 3 } } }), features, ['Arm']).appearance).toEqual({ F2: { color: '#ff0007', opacity: 0.05, metallic: 1 } });
    expect(bodyLooks({}, features, [])).toEqual({});
  });
});
