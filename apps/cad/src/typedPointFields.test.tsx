import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import { useRef, useState } from 'preact/hooks';
import { pointTool, type SketchDraft } from '@kit/sketch';
import { SketchFields, seedFirstFieldNow } from './SketchFields';
import './i18n';

afterEach(cleanup);
const draft: SketchDraft = { id: 's1', name: 'S', plane: 'XY', points: [{ id: 'O', x: 0, y: 0, fixed: true }], entities: [], constraints: [], temp: [] } as never;

/** The Point tool's typed X / Y fields wired like the app does: field events go to the tool, its output feeds the fields. */
function Harness(p: { onDraft(d: SketchDraft): void }) {
  const st = useRef<unknown>(pointTool.start());
  const dr = useRef(draft);
  const [out, setOut] = useState(() => { const o = pointTool.step(st.current as never, { type: 'move', at: { x: 7, y: 9 } } as never, dr.current, {} as never, {} as never); st.current = o.state; return o; });
  const run = (ev: unknown) => {
    const o = pointTool.step(st.current as never, ev as never, dr.current, {} as never, {} as never);
    st.current = o.state; if (o.draft !== dr.current) { dr.current = o.draft; p.onDraft(o.draft); }
    setOut(o);
  };
  (globalThis as { __run?: (ev: unknown) => void }).__run = run;
  return <SketchFields fields={out.fields} x={0} y={0} onField={(id, value, commit) => run({ type: 'field', id, value, commit })} onEnter={() => run({ type: 'key', key: 'Enter' })} />;
}
const inputs = () => Array.from(document.querySelectorAll<HTMLInputElement>('.sketch-fields input'));
/** Type one character the way a browser does: into whatever has the focus, replacing the selection. */
const typeChar = (ch: string) => {
  const el = document.activeElement as HTMLInputElement;
  fireEvent.keyDown(el, { key: ch });
  const s = el.selectionStart ?? el.value.length, e = el.selectionEnd ?? el.value.length;
  fireEvent.input(el, { target: { value: el.value.slice(0, s) + ch + el.value.slice(e) } });
  el.setSelectionRange(s + 1, s + 1);
};

describe('typed point: X, Tab, Y, Enter', () => {
  const start = (): SketchDraft[] => {
    const seen: SketchDraft[] = [];
    render(<Harness onDraft={(d) => seen.push(d)} />);
    (globalThis as { __run?: (ev: unknown) => void }).__run!({ type: 'key', key: 'Tab' });
    return seen;
  };
  it('keys typed straight after Tab land in the Y box', async () => {
    const seen = start();
    await act(async () => {});
    inputs()[0].focus();
    typeChar('3'); typeChar('0');
    fireEvent.keyDown(inputs()[0], { key: 'Tab' });
    expect(document.activeElement).toBe(inputs()[1]);
    typeChar('2'); typeChar('0');
    await act(async () => {});
    expect(inputs()[1].value).toBe('20');
    fireEvent.keyDown(inputs()[1], { key: 'Enter' });
    expect(seen.length).toBe(1);
  });
  it('Enter in the X box places the point with the current Y value', async () => {
    const seen = start();
    await act(async () => {});
    inputs()[0].focus();
    typeChar('3'); typeChar('0');
    fireEvent.keyDown(inputs()[0], { key: 'Enter' });
    await act(async () => {});
    expect(seen.length).toBe(1);
    const p = seen[0].points.find((q) => q.id !== 'O')!;
    expect([p.x, p.y]).toEqual([30, 9]);
  });
});

describe('seeding the first box synchronously', () => {
  it('the first key typed with no box focused fills X and focuses it at once; Tab and the Y keys that follow need no render in between', async () => {
    const seen: SketchDraft[] = [];
    render(<Harness onDraft={(d) => seen.push(d)} />);
    (globalThis as { __run?: (ev: unknown) => void }).__run!({ type: 'key', key: 'Tab' });
    await act(async () => {});
    expect(seedFirstFieldNow('3')).toBe(true);
    expect(document.activeElement).toBe(inputs()[0]);
    expect(inputs()[0].value).toBe('3');
    typeChar('0');
    fireEvent.keyDown(inputs()[0], { key: 'Tab' });
    typeChar('2'); typeChar('0');
    fireEvent.keyDown(inputs()[1], { key: 'Enter' });
    await act(async () => {});
    const p = seen[0].points.find((q) => q.id !== 'O')!;
    expect([p.x, p.y]).toEqual([30, 20]);
  });
  it('with no box on screen it reports false (the caller falls back to the seed state)', () => { expect(seedFirstFieldNow('1')).toBe(false); });
});
