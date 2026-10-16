// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import '../i18n';
import { CatalogGhost, PlacementRow } from './CatalogPanel';
import { catalogItem } from './shapes';
import { ghost, placeStatus, placementSetting } from './state';
import { DEFAULT_SETTING } from './placement';
import { planeRowAt } from './useCatalog';

afterEach(() => { cleanup(); placementSetting.value = DEFAULT_SETTING; ghost.value = null; placeStatus.value = { state: 'idle' }; document.body.innerHTML = ''; });

describe('placement row', () => {
  it('names the ground plane of the up axis and writes the choices to the setting', () => {
    render(<PlacementRow upAxis="y" />);
    expect(screen.getByRole('option', { name: 'Ground (Top)' })).toBeTruthy();
    const [on, dir, rot] = screen.getAllByRole('combobox') as HTMLSelectElement[];
    fireEvent.change(on, { target: { value: 'right' } });
    fireEvent.change(dir, { target: { value: 'down' } });
    fireEvent.change(rot, { target: { value: '3' } });
    fireEvent.click(screen.getByLabelText('Mirror'));
    expect(placementSetting.value).toEqual({ plane: 'right', flip: true, rot: 3, mirror: true });
  });
  it('Z up: the ground is the Front plane', () => {
    render(<PlacementRow upAxis="z" />);
    expect(screen.getByRole('option', { name: 'Ground (Front)' })).toBeTruthy();
  });
});

describe('drop hint', () => {
  it('names the plane under the pointer and lists the keys', () => {
    ghost.value = { x: 10, y: 10, itemId: 'add-block' };
    placeStatus.value = { state: 'ready', face: null, snap: null, size: 30, point: [0, 0, 0], plane: { kind: 'std', id: 'top' }, ground: true };
    render(<CatalogGhost hasSolid={false} />);
    expect(screen.getByText('First body on the Top plane')).toBeTruthy();
    expect(screen.getByText('R rotate F flip Esc cancel')).toBeTruthy();
    cleanup();
    render(<CatalogGhost hasSolid />);
    expect(screen.getByText('On the Top plane')).toBeTruthy();
    expect(catalogItem('add-block')).toBeTruthy();
  });
});

describe('plane rows of the history tree', () => {
  it('a row of Front / Top / Right, or of a plane feature, is a drop target', () => {
    document.body.innerHTML = '<div class="row ref" data-ref="top"><span id="a">Top</span></div><div class="row" data-id="P1"><span id="b">P</span></div><div class="row" data-id="F2"><span id="c">E</span></div>';
    const at = (id: string) => { (document as unknown as { elementFromPoint: () => Element | null }).elementFromPoint = () => document.getElementById(id); };
    at('a'); expect(planeRowAt(1, 1, () => false)).toEqual({ kind: 'std', id: 'top' });
    at('b'); expect(planeRowAt(1, 1, (id) => id === 'P1')).toEqual({ kind: 'feature', id: 'P1' });
    at('c'); expect(planeRowAt(1, 1, (id) => id === 'P1')).toBeNull();
  });
});
