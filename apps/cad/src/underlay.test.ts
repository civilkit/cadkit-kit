import { describe, expect, it } from 'vitest';
import { calibrated, heightOf, mimeOfName, newUnderlay, parseField, pixelAt, pruneUnderlays, shapeOf, underlayFor, underlaysOf, withUnderlay, withoutUnderlay } from './underlay';

const base = () => newUnderlay('F3', 'side.png', 'image/png', 'QUJD', 800, 400);

describe('underlay records', () => {
  it('a new picture is centred, its longest side 100 mm, half see-through', () => {
    const u = base();
    expect(u).toMatchObject({ w: 100, x: 0, y: 0, rot: 0, opacity: 0.5, visible: true, locked: false });
    expect(heightOf(u)).toBe(50);
    const tall = newUnderlay('F3', 't.png', 'image/png', 'QUJD', 300, 600);
    expect([tall.w, heightOf(tall)]).toEqual([50, 100]);
  });
  it('reads only what is usable from a document, and clamps what it keeps', () => {
    const doc = { underlays: [
      { ...base(), opacity: 7, rot: 'x' },
      { ...base(), id: 'u2', sketch: 'F4', data: '' },          // no picture
      { ...base(), id: 'u3', sketch: 'F5', mime: 'text/html' },  // not an image
      { ...base(), id: 'u4', sketch: 'F6', pxW: 0 },             // no size
      null, 5,
    ] };
    const list = underlaysOf(doc);
    expect(list.map((u) => u.id)).toEqual(['u1']);
    expect(list[0]).toMatchObject({ opacity: 1, rot: 0 });
    expect(underlaysOf({})).toEqual([]);
    expect(underlaysOf(null)).toEqual([]);
  });
  it('one picture per sketch: adding to a sketch replaces its picture; removing leaves the others', () => {
    let list = withUnderlay([], base());
    list = withUnderlay(list, { ...base(), id: 'u2', sketch: 'F4' });
    list = withUnderlay(list, { ...base(), id: 'u3' });
    expect(list.map((u) => u.id).sort()).toEqual(['u2', 'u3']);
    expect(underlayFor(list, 'F3')!.id).toBe('u3');
    expect(withoutUnderlay(list, 'u2').map((u) => u.id)).toEqual(['u3']);
  });
  it('a cancelled sketch leaves nothing behind, the open one stays', () => {
    const list = [base(), { ...base(), id: 'u2', sketch: 'F9' }];
    expect(pruneUnderlays(list, new Set(['F3'])).map((u) => u.id)).toEqual(['u1']);
    expect(pruneUnderlays(list, new Set(), 'F9').map((u) => u.id)).toEqual(['u2']);
  });
  it('mime types by file name', () => {
    expect(mimeOfName('Side.PNG')).toBe('image/png');
    expect(mimeOfName('a.jpeg')).toBe('image/jpeg');
    expect(mimeOfName('a.svg')).toBeNull();
    expect(mimeOfName('noext')).toBeNull();
  });
  it('numbers typed into the panel: decimal comma and spaces are fine, text is not', () => {
    expect(parseField(' 12,5 ')).toBe(12.5);
    expect(parseField('-3')).toBe(-3);
    expect(parseField('')).toBeNull();
    expect(parseField('abc')).toBeNull();
  });
});

describe('calibrate', () => {
  it('scales about the first point so it stays put, and the two points end up the typed distance apart', () => {
    const u = { ...base(), x: 20, y: 10 };            // 100 wide, centre (20,10)
    const a = { x: 0, y: 0 }, b = { x: 40, y: 0 };    // 40 mm apart on screen; really 80 mm
    const c = calibrated(u, a, b, 80)!;
    expect(c.w).toBeCloseTo(200, 9);                  // twice as big
    expect([c.x, c.y]).toEqual([40, 20]);             // centre moves away from A by the same factor
    // the pixel under A did not change, and the pixel under B is now 80 mm from it
    expect(pixelAt(c, a).px).toBeCloseTo(pixelAt(u, a).px, 6);
    expect(pixelAt(c, a).py).toBeCloseTo(pixelAt(u, a).py, 6);
    const pa = pixelAt(c, a), pb = pixelAt(c, { x: 80, y: 0 });
    expect(Math.hypot(pb.px - pa.px, pb.py - pa.py) / (c.pxW / c.w)).toBeCloseTo(80, 6);
  });
  it('refuses points on top of each other and a distance that is not above 0', () => {
    const u = base();
    expect(calibrated(u, { x: 1, y: 1 }, { x: 1, y: 1 }, 10)).toBeNull();
    expect(calibrated(u, { x: 0, y: 0 }, { x: 5, y: 0 }, 0)).toBeNull();
    expect(calibrated(u, { x: 0, y: 0 }, { x: 5, y: 0 }, NaN)).toBeNull();
    expect(calibrated(u, { x: 0, y: 0 }, { x: 5, y: 0 }, -2)).toBeNull();
  });
  it('pixelAt follows the rotation and the offset', () => {
    const u = { ...base(), x: 10, y: 0, rot: 90 };   // 800 x 400 px over 100 x 50 mm, centre (10,0), turned a quarter
    const c = pixelAt(u, { x: 10, y: 0 });
    expect([c.px, c.py]).toEqual([400, 200]);
    // a quarter turn counter-clockwise: the picture's right edge now points up the sketch
    const up = pixelAt(u, { x: 10, y: 20 });
    expect(up.px).toBeCloseTo(400 + 20 * 8, 6);
    expect(up.py).toBeCloseTo(200, 6);
  });
});

describe('shapeOf', () => {
  const frame = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
  it('is the data URL and the placement; hidden or frameless gives nothing', () => {
    const s = shapeOf(base(), frame)!;
    expect(s.url).toBe('data:image/png;base64,QUJD');
    expect([s.w, s.pxW, s.pxH, s.opacity]).toEqual([100, 800, 400, 0.5]);
    expect(shapeOf({ ...base(), visible: false }, frame)).toBeNull();
    expect(shapeOf(base(), null)).toBeNull();
    expect(shapeOf(null, frame)).toBeNull();
  });
});
