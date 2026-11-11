import { describe, expect, it } from 'vitest';
import type { SketchDraft } from '@kit/sketch';
import { MAX_SVG_BYTES, MAX_SVG_ENTITIES, mergeIntoDraft, svgToSketch, type SvgImportOk } from './index';

/** A 100 x 50 mm drawing: 1 user unit = 1 mm, so coordinates read as millimetres and Y is flipped about y = 50. */
const svg = (body: string, attrs = 'width="100mm" height="50mm" viewBox="0 0 100 50"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;
const ok = (t: string, o?: Parameters<typeof svgToSketch>[1]): SvgImportOk => { const r = svgToSketch(t, o); if (!r.ok) throw new Error(JSON.stringify(r.error)); return r; };
const err = (t: string) => { const r = svgToSketch(t); if (r.ok) throw new Error('expected a refusal'); return r.error; };
const pt = (r: SvgImportOk, id: unknown) => r.points.find((p) => p.id === id)!;
const at = (r: SvgImportOk, id: unknown): [number, number] => { const p = pt(r, id); return [Math.round(p.x * 1e6) / 1e6, Math.round(p.y * 1e6) / 1e6]; };
const ends = (r: SvgImportOk, e: Record<string, unknown>) => [at(r, e.p1), at(r, e.p2)];
const sweep = (r: SvgImportOk, e: Record<string, unknown>) => {
  const c = pt(r, e.c), a = pt(r, e.p1), b = pt(r, e.p2);
  const d = (Math.atan2(b.y - c.y, b.x - c.x) - Math.atan2(a.y - c.y, a.x - c.x)) * 180 / Math.PI;
  return ((d % 360) + 360) % 360;
};
const types = (r: SvgImportOk) => r.entities.map((e) => e.type);

describe('svgToSketch elements', () => {
  it('reads a line, flipping Y so the drawing stands upright', () => {
    const r = ok(svg('<line x1="10" y1="40" x2="30" y2="10"/>'));
    expect(r.scale).toBeCloseTo(1, 12);
    expect(ends(r, r.entities[0])).toEqual([[10, 10], [30, 40]]);
  });
  it('reads a rect as four lines that close', () => {
    const r = ok(svg('<rect x="10" y="10" width="30" height="20"/>'));
    expect(types(r)).toEqual(['line', 'line', 'line', 'line']);
    expect(r.points).toHaveLength(4);
    const xs = r.points.map((p) => p.x), ys = r.points.map((p) => p.y);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([10, 40, 20, 40]);
  });
  it('a rounded rect is four lines and four quarter arcs, rx alone sets ry, radii are clamped to half the side', () => {
    const r = ok(svg('<rect x="0" y="0" width="40" height="20" rx="5"/>'));
    expect(types(r).sort()).toEqual(['arc', 'arc', 'arc', 'arc', 'line', 'line', 'line', 'line']);
    for (const a of r.entities.filter((e) => e.type === 'arc')) expect(sweep(r, a)).toBeCloseTo(90, 6);
    expect(r.points).toHaveLength(8 + 4);        // eight tangent points and four centres
    const big = ok(svg('<rect x="0" y="0" width="40" height="20" rx="10" ry="50"/>'));
    expect(big.entities.filter((e) => e.type === 'arc')).toHaveLength(4);
    const ys = big.points.map((p) => p.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(20, 9);
  });
  it('reads a circle and an ellipse (rx alone gives a circle)', () => {
    const r = ok(svg('<circle cx="20" cy="10" r="5"/><ellipse cx="60" cy="25" rx="12" ry="6"/><ellipse cx="80" cy="25" rx="3"/>'));
    expect(r.entities[0]).toMatchObject({ type: 'circle', r: 5 });
    expect(at(r, r.entities[0].c)).toEqual([20, 40]);
    const e = r.entities[1];
    expect(e.type).toBe('ellipse');
    expect(e.r).toBeCloseTo(6, 9);
    expect(at(r, e.p)).toEqual([72, 25]);       // major end point
    expect(r.entities[2]).toMatchObject({ type: 'circle', r: 3 });
  });
  it('reads polyline (open) and polygon (closed) points', () => {
    const r = ok(svg('<polyline points="0,0 10,0 10,10"/><polygon points="20 0 30 0 30 10 20 10"/>'));
    expect(types(r)).toEqual(['line', 'line', 'line', 'line', 'line', 'line']);
    expect(r.entities).toHaveLength(2 + 4);
  });
  it('drops zero-size shapes and counts them', () => {
    const r = ok(svg('<rect width="0" height="5"/><circle r="0"/><line x1="1" y1="1" x2="1" y2="1"/><circle r="3"/>'));
    expect(r.entities).toHaveLength(1);
    expect(r.degenerate).toBe(3);
  });
  it('skips an exact duplicate (a stroke layer over a fill layer)', () => {
    const r = ok(svg('<circle r="4" cx="5" cy="5"/><circle r="4" cx="5" cy="5"/><line x1="0" y1="0" x2="5" y2="0"/><line x1="5" y1="0" x2="0" y2="0"/>'));
    expect(r.entities).toHaveLength(2);
    expect(r.duplicate).toBe(2);
  });
});

describe('svgToSketch paths', () => {
  it('absolute and relative lines, H and V, implicit repeats, Z closes into one profile', () => {
    const r = ok(svg('<path d="M10 10 h20 v10 l-20 0 z"/>'));
    expect(r.entities).toHaveLength(4);
    expect(r.points).toHaveLength(4);
    const abs = ok(svg('<path d="M10,10 H30 V20 L10 20 10 10"/>'));
    expect(abs.entities).toHaveLength(4);
    const imp = ok(svg('<path d="m10 10 20 0 0 10 -20 0 z"/>'));
    expect(imp.entities).toHaveLength(4);
    expect(new Set(imp.points.map((p) => `${p.x},${p.y}`))).toEqual(new Set(['10,40', '30,40', '30,30', '10,30']));
  });
  it('a command after Z starts at the subpath start', () => {
    const r = ok(svg('<path d="M10 10 L20 10 L20 20 Z l-5 -5"/>'));
    expect(r.entities).toHaveLength(4);
    expect(at(r, r.entities[3].p2)).toEqual([5, 45]);
  });
  it('two subpaths make two profiles (a hole)', () => {
    const r = ok(svg('<path d="M0 0H40V40H0Z M10 10V30H30V10Z"/>'));
    expect(r.entities).toHaveLength(8);
    expect(r.points).toHaveLength(8);
  });
  it('cubic and quadratic Beziers are exact spline entities; S and T reflect the previous control point', () => {
    const r = ok(svg('<path d="M0 0 C10 20 20 20 30 0 S50 -20 60 0"/>'));
    expect(r.entities).toHaveLength(2);
    expect(r.entities[0]).toMatchObject({ type: 'cvspline', degree: 3 });
    const second = (r.entities[1].pts as string[]).map((id) => at(r, id));
    expect(second).toEqual([[30, 50], [40, 70], [50, 70], [60, 50]]);       // first control = reflection of (20, 20) about (30, 0), flipped
    const q = ok(svg('<path d="M0 0 Q10 20 20 0 T40 0"/>'));
    expect(q.entities.map((e) => [e.type, e.degree])).toEqual([['cvspline', 2], ['cvspline', 2]]);
    expect((q.entities[1].pts as string[]).map((id) => at(q, id))).toEqual([[20, 50], [30, 70], [40, 50]]);
  });
  it('a Bezier whose control points lie on the chord is a line', () => {
    const r = ok(svg('<path d="M0 0 C5 0 10 0 20 0 Q15 0 10 0"/>'));
    expect(types(r)).toEqual(['line', 'line']);
  });
  it('a Bezier that closes on itself is split so its ends differ', () => {
    const r = ok(svg('<path d="M10 10 C30 10 30 30 10 10 Z"/>'));
    expect(types(r)).toEqual(['cvspline', 'cvspline']);
    const a = r.entities[0].pts as string[], b = r.entities[1].pts as string[];
    expect(a.at(-1)).toBe(b[0]);
    expect(a[0]).toBe(b.at(-1));
  });
  it('a circular arc is a sketch arc running counter-clockwise from p1 to p2', () => {
    const r = ok(svg('<path d="M30 25 A10 10 0 0 0 20 15"/>'));          // quarter, counter-clockwise on screen
    expect(r.entities[0].type).toBe('arc');
    expect(at(r, r.entities[0].c)).toEqual([20, 25]);
    expect(ends(r, r.entities[0])).toEqual([[30, 25], [20, 35]]);
    expect(sweep(r, r.entities[0])).toBeCloseTo(90, 6);
    const cw = ok(svg('<path d="M30 25 A10 10 0 0 1 20 15"/>'));          // same chord, the other side
    expect(sweep(cw, cw.entities[0])).toBeCloseTo(90, 6);
    expect(at(cw, cw.entities[0].c)).toEqual([30, 35]);
  });
  it('large-arc and sweep flags pick the right one of the four arcs, and packed flags parse', () => {
    const big = ok(svg('<path d="M30 25 A10 10 0 1 0 20 15"/>'));
    expect(sweep(big, big.entities[0])).toBeCloseTo(270, 6);
    const packed = ok(svg('<path d="M30 25a10 10 0 1020 0"/>'));       // flags "1" "0" packed against the next number
    expect(packed.entities[0].type).toBe('arc');
    expect(sweep(packed, packed.entities[0])).toBeCloseTo(180, 6);
  });
  it('radii too small are scaled up to a half circle', () => {
    const r = ok(svg('<path d="M10 25 A1 1 0 0 1 30 25"/>'));
    expect(sweep(r, r.entities[0])).toBeCloseTo(180, 6);
    expect(at(r, r.entities[0].c)).toEqual([20, 25]);
  });
  it('an elliptical arc becomes a chain of cubic splines of at most a quarter turn, joined end to end', () => {
    const r = ok(svg('<path d="M40 25 A20 10 0 0 0 0 25"/>'));
    expect(types(r)).toEqual(['cvspline', 'cvspline']);
    const a = r.entities[0].pts as string[], b = r.entities[1].pts as string[];
    expect(a.at(-1)).toBe(b[0]);
    expect(at(r, a[0])).toEqual([40, 25]);
    // the mid point (20, 15) is on the curve: Bezier at t = 1 of the first piece
    expect(at(r, a.at(-1)!)[0]).toBeCloseTo(20, 6);
  });
  it('a rotated circular arc and zero radii (a line)', () => {
    const r = ok(svg('<path d="M0 0 A0 5 0 0 1 10 0 A5 5 45 0 1 20 0"/>'));
    expect(types(r)).toEqual(['line', 'arc']);
  });
  it('stops at a malformed command like a renderer and reports it', () => {
    const r = ok(svg('<path d="M0 0 L10 0 L10 10 L oops L20 20"/>'));
    expect(r.entities).toHaveLength(2);
    expect(r.unsupported['path data error']).toBe(1);
    expect(ok(svg('<path d="L10 10"/><circle r="2"/>')).unsupported['path data error']).toBe(1);
  });
  it('exponents and signs parse: 1e1 and -.5-.5', () => {
    const r = ok(svg('<path d="M0 0 L1e1 0 l-.5-.5"/>'));
    expect(ends(r, r.entities[1])).toEqual([[10, 50], [9.5, 50.5]]);
  });
});

describe('svgToSketch transforms', () => {
  it('translate, scale, rotate about a point, matrix, skew, and nested groups multiply in order', () => {
    const r = ok(svg('<g transform="translate(10 5)"><g transform="scale(2)"><line x1="1" y1="0" x2="1" y2="5"/></g></g>'));
    expect(ends(r, r.entities[0])).toEqual([[12, 45], [12, 35]]);
    const rot = ok(svg('<line x1="10" y1="0" x2="20" y2="0" transform="rotate(90 0 0)"/>'));
    expect(ends(rot, rot.entities[0])).toEqual([[0, 40], [0, 30]]);
    const m = ok(svg('<line x1="1" y1="1" x2="2" y2="1" transform="matrix(1 0 0 1 3 4)"/>'));
    expect(ends(m, m.entities[0])).toEqual([[4, 45], [5, 45]]);
    const sk = ok(svg('<line x1="0" y1="10" x2="0" y2="20" transform="skewX(45)"/>'));
    expect(ends(sk, sk.entities[0])[1][0]).toBeCloseTo(20, 9);
    const sy = ok(svg('<line x1="10" y1="0" x2="20" y2="0" transform="skewY(45)"/>'));
    expect(ends(sy, sy.entities[0])[1][1]).toBeCloseTo(50 - 20, 9);
    const order = ok(svg('<line x1="1" y1="0" x2="2" y2="0" transform="translate(10 0) scale(2)"/>'));
    expect(ends(order, order.entities[0])).toEqual([[12, 50], [14, 50]]);
  });
  it('a uniform scale and a mirror keep circles and arcs; a mirror flips the arc direction', () => {
    const r = ok(svg('<g transform="scale(-1 1) translate(-50 0)"><path d="M30 25 A10 10 0 0 0 20 15"/><circle cx="5" cy="5" r="2"/></g>'));
    expect(types(r)).toEqual(['arc', 'circle']);
    expect(sweep(r, r.entities[0])).toBeCloseTo(90, 6);
    expect(at(r, r.entities[0].c)).toEqual([30, 25]);
    const s = ok(svg('<circle r="2" transform="scale(3)"/>'));
    expect(s.entities[0]).toMatchObject({ type: 'circle', r: 6 });
  });
  it('a non-uniform scale or a rotation turns circles into ellipses with the right axes', () => {
    const r = ok(svg('<circle cx="10" cy="10" r="2" transform="scale(3 1)"/>'));
    expect(r.entities[0].type).toBe('ellipse');
    expect(r.entities[0].r).toBeCloseTo(2, 9);
    expect(at(r, r.entities[0].p)).toEqual([36, 40]);
    const rot = ok(svg('<ellipse cx="30" cy="25" rx="10" ry="4" transform="rotate(30 30 25)"/>'));
    const c = pt(rot, rot.entities[0].c), p = pt(rot, rot.entities[0].p);
    expect(Math.hypot(p.x - c.x, p.y - c.y)).toBeCloseTo(10, 9);
    expect(Math.atan2(p.y - c.y, p.x - c.x) * 180 / Math.PI).toBeCloseTo(-30, 6); 
    expect(rot.entities[0].r).toBeCloseTo(4, 9);
  });
  it('a circular arc under a non-uniform scale becomes splines', () => {
    const r = ok(svg('<path d="M30 25 A10 10 0 0 0 20 15" transform="scale(2 1)"/>'));
    expect(types(r)).toEqual(['cvspline']);
  });
  it('an element with a bad transform is skipped and counted, its siblings are read', () => {
    const r = ok(svg('<line x1="0" y1="0" x2="5" y2="0" transform="wobble(3)"/><line x1="0" y1="1" x2="5" y2="1"/>'));
    expect(r.entities).toHaveLength(1);
    expect(r.unsupported.transform).toBe(1);
  });
  it('internal <use> places the referenced shape, external ones are skipped', () => {
    const r = ok(svg('<defs><circle id="c" r="2"/></defs><use href="#c" x="10" y="10"/><use xlink:href="#c" x="30" y="10" transform="scale(2)"/><use href="http://example.com/x.svg#a"/><use href="#nope"/>'));
    expect(r.entities).toHaveLength(2);
    expect(at(r, r.entities[0].c)).toEqual([10, 40]);
    expect(r.entities[1].r).toBe(4);
    expect(r.unsupported).toEqual({ 'use (external)': 1, 'use (missing target)': 1 });
  });
});

describe('svgToSketch size and units', () => {
  const line = '<line x1="0" y1="0" x2="10" y2="0"/>';
  it('viewBox with mm, cm, in, pt sizes sets the scale', () => {
    expect(ok(svg(line, 'width="100mm" height="50mm" viewBox="0 0 100 50"')).scale).toBeCloseTo(1, 12);
    expect(ok(svg(line, 'width="10cm" height="5cm" viewBox="0 0 100 50"')).scale).toBeCloseTo(1, 12);
    expect(ok(svg(line, 'width="2in" height="1in" viewBox="0 0 2 1"')).scale).toBeCloseTo(25.4, 12);
    expect(ok(svg(line, 'width="72pt" height="36pt" viewBox="0 0 72 36"')).scale).toBeCloseTo(25.4 / 72, 12);
    expect(ok(svg(line, 'width="100mm" height="50mm" viewBox="0 0 100 50"')).units).toBe('physical');
    // 210 mm wide, user unit = 0.1 mm
    const r = ok(svg(line, 'width="210mm" height="297mm" viewBox="0 0 2100 2970"'));
    expect(r.scale).toBeCloseTo(0.1, 12);
    expect(ends(r, r.entities[0])[1][0]).toBeCloseTo(1, 9);
  });
  it('a viewBox with one size derives the other; viewBox origin shifts the drawing', () => {
    expect(ok(svg(line, 'width="50mm" viewBox="0 0 100 20"')).scale).toBeCloseTo(0.5, 12);
    const r = ok(svg('<line x1="100" y1="200" x2="110" y2="200"/>', 'width="10mm" height="10mm" viewBox="100 195 10 10"'));
    expect(ends(r, r.entities[0])).toEqual([[0, 5], [10, 5]]);
  });
  it('preserveAspectRatio meet centres the viewBox, slice and none are honoured', () => {
    const l = '<line x1="0" y1="0" x2="10" y2="0"/>';
    const meet = ok(svg(l, 'width="100mm" height="50mm" viewBox="0 0 10 10"'));
    expect(meet.scale).toBeCloseTo(5, 9);
    expect(ends(meet, meet.entities[0])[0][0]).toBeCloseTo(25, 9);        // (100 - 50) / 2
    const none = ok(svg(l, 'width="100mm" height="50mm" viewBox="0 0 10 10" preserveAspectRatio="none"'));
    expect(ends(none, none.entities[0])).toEqual([[0, 50], [100, 50]]);
  });
  it('no physical size: one user unit is one CSS pixel (96 dpi) and the result says so', () => {
    const r = ok(`<svg xmlns="http://www.w3.org/2000/svg"><line x1="0" y1="0" x2="96" y2="0"/></svg>`);
    expect(r.units).toBe('px');
    expect(r.scale).toBeCloseTo(25.4 / 96, 12);
    expect(ends(r, r.entities[0])[1][0]).toBeCloseTo(25.4, 9);
    expect(ok(svg(line, 'width="100" height="50" viewBox="0 0 100 50"')).units).toBe('px');
    expect(ok(svg(line, 'viewBox="0 0 100 50"')).scale).toBeCloseTo(25.4 / 96, 12);
  });
  it('without a viewBox the height still flips the drawing upright; with none it flips about 0', () => {
    const r = ok('<svg xmlns="http://www.w3.org/2000/svg" width="96px" height="96px"><line x1="0" y1="0" x2="0" y2="96"/></svg>');
    expect(ends(r, r.entities[0]).map((p) => p[1])).toEqual([25.4, 0]);
    const n = ok('<svg xmlns="http://www.w3.org/2000/svg"><line x1="0" y1="0" x2="0" y2="96"/></svg>');
    expect(n.points.map((p) => p.y).sort((a, b) => a - b)).toEqual([-25.4, 0]);
  });
  it('mmPerUnit overrides the file', () => {
    const r = ok(svg(line, 'width="100mm" height="50mm" viewBox="0 0 100 50"'), { mmPerUnit: 2 });
    expect(r.scale).toBe(2);
    expect(ends(r, r.entities[0])[1][0]).toBe(20);
  });
});

describe('svgToSketch what it leaves out', () => {
  it('lists text, images, scripts and unknown elements; ignores defs, gradients, metadata and hidden elements quietly', () => {
    const r = ok(svg(`<title>t</title><metadata><rdf:RDF/></metadata><defs><linearGradient id="g"><stop offset="0"/></linearGradient><clipPath id="k"><rect width="5" height="5"/></clipPath></defs>
      <text x="1" y="1">hello</text><text>two</text><image href="data:image/png;base64,AAAA"/><script>alert(1)</script><foreignObject><div/></foreignObject>
      <sodipodi:namedview/><circle r="3" display="none"/><circle r="4" style="fill:red; display : none"/><circle r="5" fill="url(#g)" stroke="red"/>`));
    expect(r.entities).toEqual([expect.objectContaining({ type: 'circle', r: 5 })]);
    expect(r.unsupported).toEqual({ text: 2, image: 1, script: 1, foreignobject: 1 });
  });
  it('geometry that uses a clip path, mask or filter is imported whole and counted', () => {
    const r = ok(svg('<circle r="5" clip-path="url(#k)"/><g mask="url(#m)"><circle r="6" cx="20"/></g><circle r="7" cx="40" filter="none"/>'));
    expect(r.entities).toHaveLength(3);
    expect(r.clipped).toBe(2);
  });
  it('a file with nothing drawable is refused and names what it skipped', () => {
    const e = err(svg('<text>only text</text><image href="a.png"/>'));
    expect(e).toEqual({ code: 'nothing', unsupported: { text: 1, image: 1 } });
  });
  it('merges into a draft like a DXF import, renumbering past the draft ids', () => {
    const r = ok(svg('<rect x="0" y="0" width="10" height="10"/>'));
    const draft = { id: 'S1', points: [{ id: 'p1', x: 0, y: 0 }], entities: [{ id: 'e1', type: 'line', p1: 'p1', p2: 'p1' }], constraints: [] } as unknown as SketchDraft;
    const m = mergeIntoDraft(draft, r);
    expect(m.points).toHaveLength(1 + 4);
    expect(m.entities).toHaveLength(1 + 4);
    expect(new Set(m.points.map((p) => p.id)).size).toBe(5);
    for (const e of m.entities.slice(1)) expect(m.points.some((p) => p.id === e.p1)).toBe(true);
  });
});

describe('svgToSketch hostile input', () => {
  it('refuses what is not an SVG', () => {
    expect(err('hello')).toMatchObject({ code: 'notSvg' });
    expect(err('')).toMatchObject({ code: 'notSvg' });
    expect(err('<html><body/></html>')).toMatchObject({ code: 'notSvg' });
    expect(err('<svg><g></svg>')).toMatchObject({ code: 'notSvg' });
    expect(err('<svg width=100></svg>')).toMatchObject({ code: 'notSvg' });
    expect(err('<svg>\0</svg>')).toMatchObject({ code: 'notSvg' });
    expect(err('\u001f\u008b\b\0\0\0\0\0')).toMatchObject({ code: 'notSvg' });
  });
  it('refuses entity declarations (billion laughs, external entities) and never expands them', () => {
    const bomb = '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;">]><svg xmlns="http://www.w3.org/2000/svg"><text>&b;</text><circle r="3"/></svg>';
    expect(err(bomb)).toMatchObject({ code: 'unsafe' });
    expect(err('<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg><text>&xxe;</text></svg>')).toMatchObject({ code: 'unsafe' });
    expect(err('<!doctype svg [<!entity x "y">]><svg/>')).toMatchObject({ code: 'unsafe' });
  });
  it('a plain DOCTYPE, comments, CDATA, a BOM and processing instructions are fine', () => {
    const t = '﻿<?xml version="1.0" encoding="UTF-8"?><!-- c --><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg xmlns="http://www.w3.org/2000/svg"><style><![CDATA[ .a{fill:red} ]]></style><circle r="3" class="a"/></svg><!-- trailing -->';
    expect(ok(t).entities).toHaveLength(1);
  });
  it('predefined and numeric entities in attributes are decoded, unknown ones are left alone', () => {
    const r = ok(svg('<path d="M&#48; 0 L&#x31;0 0"/>'));
    expect(r.entities).toHaveLength(1);
    expect(ok(svg('<circle r="3" id="a&unknown;"/>')).entities).toHaveLength(1);
  });
  it('script and event handler attributes are never run, only counted as an element', () => {
    const r = ok(svg('<circle r="3" onload="throw 1" onclick="alert(1)"/><script type="text/javascript">globalThis.pwned = 1</script>'));
    expect((globalThis as { pwned?: number }).pwned).toBeUndefined();
    expect(r.unsupported.script).toBe(1);
  });
  it('refuses a huge file, too many elements, and too deep nesting', () => {
    expect(err(`<svg>${' '.repeat(MAX_SVG_BYTES)}</svg>`)).toMatchObject({ code: 'tooLarge' });
    expect(err(`<svg>${'<g/>'.repeat(200_001)}</svg>`)).toMatchObject({ code: 'tooMany' });
    expect(err(`<svg>${'<g>'.repeat(200)}${'</g>'.repeat(200)}</svg>`)).toMatchObject({ code: 'notSvg' });
  });
  it('refuses more entities than the cap', () => {
    const d = Array.from({ length: MAX_SVG_ENTITIES + 5 }, (_, i) => `M${i} 0 L${i} 1`).join(' ');
    expect(err(svg(`<path d="${d}"/>`, 'viewBox="0 0 100 50"'))).toMatchObject({ code: 'tooMany', max: MAX_SVG_ENTITIES });
  });
  it('refuses coordinates beyond the range, including overflow to infinity', () => {
    expect(err(svg('<line x1="0" y1="0" x2="1e12" y2="0"/>'))).toEqual({ code: 'range', max: 1e6 });
    expect(err(svg('<line x1="0" y1="0" x2="1" y2="0" transform="scale(1e8)"/>'))).toEqual({ code: 'range', max: 1e6 });
    expect(err(svg('<line x1="0" y1="0" x2="1" y2="0" transform="scale(1e308) scale(1e308)"/>'))).toEqual({ code: 'nothing', unsupported: { transform: 1 } });
    expect(err(svg('<path d="M0 0 L1e999 0"/>'))).toMatchObject({ code: 'nothing' });      // not a finite number: path error, nothing read
  });
  it('a <use> chain that doubles at every level is cut off instead of expanding forever', () => {
    let body = '<circle id="u0" r="1"/>';
    for (let i = 1; i <= 40; i++) body += `<g id="u${i}"><use href="#u${i - 1}"/><use href="#u${i - 1}" x="1"/></g>`;
    body += '<use href="#u40"/>';
    const e = err(svg(body));
    expect(e.code).toBe('tooMany');
  });
  it('a <use> that refers to itself or its parent does not loop', () => {
    const r = ok(svg('<g id="a"><circle r="3"/><use href="#a"/></g>'));
    expect(r.entities).toHaveLength(1);
  });
});
