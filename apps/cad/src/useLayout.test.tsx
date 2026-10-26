import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/preact';
import { createStore } from '@kit/store';
import { drawerMax, leftMax, rightMax, layoutHandles, layoutStyle, resetLayout, type Limits } from './useLayout';

afterEach(cleanup);
const L = (o: Partial<Limits> = {}): Limits => ({ w: 1440, h: 900, leftOpen: true, rightOpen: false, left: 280, right: 280, ...o });

describe('layout limits', () => {
  it('panels stop at 60% of the window, the drawer at 70% of the height', () => {
    expect(leftMax(L())).toBe(864);
    expect(drawerMax(L())).toBe(630);
  });
  it('the viewport keeps 320px when both panels are open', () => {
    expect(leftMax(L({ rightOpen: true, right: 700 }))).toBe(1440 - 700 - 320);
    expect(rightMax(L({ left: 800 }))).toBe(1440 - 800 - 320);
  });
  it('never drops below the 200px minimum, even in a tiny window', () => {
    expect(leftMax(L({ w: 500 }))).toBe(200);
  });
});

function Host({ store }: { store: ReturnType<typeof createStore> }) {
  const ws = store.workspace.value;
  const lay = layoutHandles(store, ws);
  return <div id="app" style={layoutStyle(ws)}>{lay.docked}</div>;
}

describe('layout handles', () => {
  it('keyboard resize writes the store; collapse and reset round-trip', () => {
    const store = createStore({}, { leftPanel: 'docked', rightPanel: 'docked', drawerOpen: true });
    render(<Host store={store} />);
    const [left, right, drawer] = screen.getAllByRole('separator');
    fireEvent.keyDown(left, { key: 'ArrowRight', shiftKey: true });
    expect(store.workspace.value.leftWidth).toBe(344);
    fireEvent.keyDown(right, { key: 'ArrowLeft' });
    expect(store.workspace.value.rightWidth).toBe(296);
    fireEvent.keyDown(drawer, { key: 'ArrowUp' });
    expect(store.workspace.value.drawerHeight).toBe(226);
    fireEvent.keyDown(drawer, { key: 'End' });
    expect(store.workspace.value.drawerHeight).toBe(Math.round(window.innerHeight * 0.7));
    resetLayout(store);
    expect(store.workspace.value.leftWidth).toBe(280);
    expect(store.workspace.value.drawerHeight).toBe(210);
  });
  it('the style carries the stored sizes as variables', () => {
    const s = layoutStyle(createStore({}, { leftWidth: 333, floatHeight: 410 }).workspace.value);
    expect(s['--lw-user']).toBe('333px');
    expect(s['--fh']).toBe('410px');
  });
});
