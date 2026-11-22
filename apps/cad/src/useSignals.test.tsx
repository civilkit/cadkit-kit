import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/preact';
import { signal } from '@preact/signals-core';
import { useSignals } from './useSignals';

afterEach(cleanup);

describe('useSignals', () => {
  it('mounting costs one render, not two', () => {
    const s = signal(1);
    let renders = 0;
    function C() { renders++; useSignals(() => { s.value; }); return <p>{s.peek()}</p>; }
    render(<C />);
    expect(renders).toBe(1);
  });

  it('re-renders on a change of a listed signal, and not on one that is not listed', async () => {
    const listed = signal(1), other = signal(1);
    let renders = 0;
    function C() { renders++; useSignals(() => { listed.value; }); return <p>{listed.peek()}</p>; }
    const r = render(<C />);
    await act(() => { listed.value = 2; });
    expect(renders).toBe(2);
    expect(r.container.textContent).toBe('2');
    await act(() => { other.value = 2; });
    expect(renders).toBe(2);
  });
});
