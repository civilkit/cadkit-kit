import { afterEach, describe, expect, it } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/preact';
import { Sketch3dPanel, type Sketch3dHost } from './Sketch3dPanel';
import { emptyDraft, type P3 } from './model';
import '../i18n';

afterEach(() => cleanup());

// the "mesh" is the plane z = 40 for |x|, |y| < 100; the camera looks straight down
function mount(withMesh = true) {
  let placement: { move(x: number, y: number): void; tap(x: number, y: number): void } | null = null;
  const host = {
    rayAt: (x: number, y: number) => ({ o: [x, y, 500] as P3, d: [0, 0, -1] as P3 }),
    worldPerPixel: () => 1, setPlacement(h) { placement = h; }, setHandles() {}, dragging: () => false, upAxis: () => 'z' as const, candidates: () => [], planes: () => [],
    ...(withMesh ? { mesh: () => ({
      hit: (ray: { o: P3; d: P3 }) => (Math.abs(ray.o[0]) < 100 && Math.abs(ray.o[1]) < 100 ? { pos: [ray.o[0], ray.o[1], 40] as P3, normal: [0, 0, 1] as P3 } : null),
      project: (p: P3, dir?: P3) => (dir ? null : ([p[0], p[1], 40] as P3)),
    }) } : {}),
  } as Sketch3dHost;
  const r = render(<Sketch3dPanel host={host} initial={emptyDraft()} featureId="F1" onApply={() => {}} onCancel={() => {}} />);
  const tap = (x: number, y: number) => act(() => placement!.tap(x, y));
  const z = (id: string) => (r.container.querySelector(`[data-point="${id}"] [data-axis="z"]`) as HTMLInputElement).value;
  return { r, tap, z };
}

describe('3D Sketch on a reference mesh', () => {
  it('a click on the mesh lands on its surface, not on the ground plane; a click off it falls back to the plane', () => {
    const m = mount();
    m.tap(10, 20); m.tap(500, 20);
    expect(m.z('p1')).toBe('40');
    expect(m.z('p2')).toBe('0');
  });
  it('the checkbox turns the surface off', () => {
    const m = mount();
    fireEvent.click(m.r.container.querySelector('[data-path="onMesh"] input')!);
    m.tap(10, 20);
    expect(m.z('p1')).toBe('0');
  });
  it('Fit curves lays a spline on the surface; along the normal with nothing hit says so', () => {
    const m = mount();
    m.tap(0, 0); m.tap(20, 30); m.tap(60, 0);
    fireEvent.click(m.r.getByTestId('sk3d-fit'));
    expect(m.r.getByTestId('sk3d-fit-note').textContent).toMatch(/1 curves fitted/);
    expect(m.r.container.querySelectorAll('[data-point]').length).toBeGreaterThan(20);
    fireEvent.change(m.r.container.querySelector('[data-path="fit"] select')!, { target: { value: 'normal' } });
    fireEvent.click(m.r.getByTestId('sk3d-fit'));
    expect(m.r.getByTestId('sk3d-fit-note').textContent).toMatch(/Nothing to fit/);
  });
  it('without a mesh the mesh controls are not there', () => {
    const m = mount(false);
    expect(m.r.container.querySelector('[data-path="onMesh"]')).toBeNull();
    expect(m.r.container.querySelector('[data-testid="sk3d-fit"]')).toBeNull();
  });
});
