import { beforeEach, describe, expect, it } from 'vitest';
import { chainSelection, roundPickOf, rememberRoundPick, setTangentChain, tangentChainOn } from './roundChain';

beforeEach(() => { try { localStorage.clear(); } catch { /* */ } });
const ed = (key: string, faces: string[], a: number[], b: number[]) => ({ key, faces, pts: [a, b] });
const edges = [ed('k1', ['T', 'A'], [0, 0, 0], [5, 0, 0]), ed('k2', ['T', 'B'], [5, 0, 0], [9, 0, 0]), ed('k3', ['T', 'C'], [9, 0, 0], [9, 4, 0])];

describe('roundChain', () => {
  it('the preference defaults to on and is remembered', () => {
    expect(tangentChainOn()).toBe(true);
    setTangentChain(false);
    expect(tangentChainOn()).toBe(false);
    setTangentChain(true);
    expect(tangentChainOn()).toBe(true);
  });
  it('chainSelection adds the continuing edges after the selection and reports only the added ones', () => {
    expect(chainSelection(['k1'], edges)).toEqual({ keys: ['k1', 'k2'], extras: ['k2'] });
    expect(chainSelection(['k1', 'v:0,0,0'], edges).keys).toEqual(['k1', 'v:0,0,0', 'k2']);
  });
  it('a selection with no known edge is unchanged', () => {
    expect(chainSelection(['F1', 'F2'], edges)).toEqual({ keys: ['F1', 'F2'], extras: [] });
  });
  it('remembers which edge list was picked and which was added, both ways round', () => {
    const s = [{ faces: ['a', 'b'], at: [1, 2, 3] }];
    const a = [...s, { faces: ['a', 'c'], at: [4, 5, 6] }];
    rememberRoundPick(s, a);
    expect(roundPickOf(a)).toEqual({ seeds: s, all: a });
    expect(roundPickOf(s)).toEqual({ seeds: s, all: a });
    expect(roundPickOf([{ faces: ['z', 'y'], at: [0, 0, 0] }])).toBeNull();
    expect(roundPickOf(undefined)).toBeNull();
  });
  it('a chain that added nothing is not remembered', () => {
    const s = [{ faces: ['q', 'r'], at: [7, 7, 7] }];
    rememberRoundPick(s, s);
    expect(roundPickOf(s)).toBeNull();
  });
});
