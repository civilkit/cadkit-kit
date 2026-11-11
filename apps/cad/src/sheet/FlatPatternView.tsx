import { useEffect } from 'preact/hooks';
import type { JSX } from 'preact';
import { t } from '../i18n';
import type { FlatPattern, SheetEntry } from './model';

const fmt = (n: number): string => String(+n.toFixed(3));

/** The extent of everything the drawing shows (outline loops and bend zones): [xmin, ymin, xmax, ymax]. */
export function drawingBounds(fp: FlatPattern): [number, number, number, number] {
  const xs: number[] = [], ys: number[] = [];
  for (const loop of fp.outline) for (const [x, y] of loop) { xs.push(x); ys.push(y); }
  for (const z of fp.bendZones) { xs.push(z[0], z[1]); ys.push(z[2], z[3]); }
  if (!xs.length) return [0, 0, 1, 1];
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** The flat pattern as a drawing: the outline and holes, the bend zones, the bend lines (up and down in two colours, numbered with the angle), and the sizes of the blank.
 *  Flat coordinates run y up; the drawing flips y. */
export function FlatPatternDrawing(p: { flat: FlatPattern }): JSX.Element {
  const fp = p.flat;
  const [x0, y0, x1, y1] = drawingBounds(fp);
  const w = Math.max(x1 - x0, 1e-6), h = Math.max(y1 - y0, 1e-6);
  const span = Math.max(w, h);
  const fs = span * 0.035;                       // text size in drawing units
  const m = span * 0.14;                          // margin around the blank for the sizes
  const X = (x: number) => x - x0, Y = (y: number) => y1 - y;
  const d = (loop: number[][]) => loop.map(([x, y], i) => `${i ? 'L' : 'M'}${fmt(X(x))} ${fmt(Y(y))}`).join('') + 'Z';
  const view = `${fmt(-m)} ${fmt(-m * 0.6)} ${fmt(w + 2 * m)} ${fmt(h + 1.5 * m)}`;
  const ow = fp.flatSize[0], oh = fp.flatSize[1];
  const dimY = h + m * 0.45, dimX = w + m * 0.45;
  const tick = fs * 0.5;
  return (
    <svg class="sheet-flat-svg" viewBox={view} role="img" aria-label={t('sheet.flat.aria')} data-testid="sheet-flat-svg" preserveAspectRatio="xMidYMid meet">
      {fp.bendZones.map((z, i) => <rect key={'z' + i} class="sheet-zone" x={fmt(X(z[0]))} y={fmt(Y(z[3]))} width={fmt(z[1] - z[0])} height={fmt(z[3] - z[2])} />)}
      <path class="sheet-outline" fill-rule="evenodd" d={fp.outline.map(d).join('')} stroke-width={fs * 0.12} />
      {fp.bends.map((b) => {
        const sx = X(b.start[0]), sy = Y(b.start[1]), ex = X(b.end[0]), ey = Y(b.end[1]);
        const mx = (sx + ex) / 2, my = (sy + ey) / 2;
        const horizontal = Math.abs(ex - sx) >= Math.abs(ey - sy);
        return (
          <g key={b.bend} class={'sheet-bend ' + b.direction} data-bend={b.bend}>
            <line x1={fmt(sx)} y1={fmt(sy)} x2={fmt(ex)} y2={fmt(ey)} stroke-width={fs * 0.14} stroke-dasharray={`${fs * 0.9} ${fs * 0.5}`} />
            <text x={fmt(horizontal ? mx : mx + fs * 0.5)} y={fmt(horizontal ? my - fs * 0.45 : my)} font-size={fs} text-anchor={horizontal ? 'middle' : 'start'} dominant-baseline={horizontal ? 'auto' : 'middle'}>{`B${b.bend} ${fmt(b.angleDeg)}°`}</text>
          </g>
        );
      })}
      <g class="sheet-dim" stroke-width={fs * 0.08}>
        <line x1="0" y1={fmt(dimY)} x2={fmt(w)} y2={fmt(dimY)} /><line x1="0" y1={fmt(dimY - tick)} x2="0" y2={fmt(dimY + tick)} /><line x1={fmt(w)} y1={fmt(dimY - tick)} x2={fmt(w)} y2={fmt(dimY + tick)} />
        <text x={fmt(w / 2)} y={fmt(dimY + fs * 1.15)} font-size={fs} text-anchor="middle" data-dim="width">{fmt(ow)}</text>
        <line x1={fmt(dimX)} y1="0" x2={fmt(dimX)} y2={fmt(h)} /><line x1={fmt(dimX - tick)} y1="0" x2={fmt(dimX + tick)} y2="0" /><line x1={fmt(dimX - tick)} y1={fmt(h)} x2={fmt(dimX + tick)} y2={fmt(h)} />
        <text x={fmt(dimX + fs * 0.5)} y={fmt(h / 2)} font-size={fs} dominant-baseline="middle" data-dim="length">{fmt(oh)}</text>
      </g>
    </svg>
  );
}

/** The flat pattern panel: size, rule, the drawing and the bend table, with the exports one click away. */
export function FlatPatternView(p: { entry: SheetEntry | null; onClose(): void; onDxf(): void; onBends(format: 'csv' | 'json'): void }): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') p.onClose(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  const fp = p.entry?.flatPattern ?? null;
  const holes = fp ? Math.max(0, fp.outline.length - 1) : 0;
  return (
    <div class="sheet-flat" role="dialog" aria-label={t('sheet.flat.title')} data-testid="sheet-flat">
      <div class="sheet-flat-head">
        <b>{t('sheet.flat.title')}</b>
        <button type="button" class="rb-btn" data-act="dxf" disabled={!fp} onClick={p.onDxf}>{t('cmd.sheet-dxf')}</button>
        <button type="button" class="rb-btn" data-act="csv" disabled={!fp} onClick={() => p.onBends('csv')}>{t('sheet.flat.csv')}</button>
        <button type="button" class="rb-btn" data-act="json" disabled={!fp} onClick={() => p.onBends('json')}>{t('sheet.flat.json')}</button>
        <button type="button" class="rb-btn" data-act="close" aria-label={t('sheet.flat.close')} onClick={p.onClose}>{t('sheet.flat.close')}</button>
      </div>
      {!fp ? <div class="sheet-flat-empty">{t('sheet.flat.empty')}</div> : (
        <>
          <div class="sheet-flat-facts" data-testid="sheet-flat-facts">
            <span>{t('sheet.flat.size', { w: fmt(fp.flatSize[0]), h: fmt(fp.flatSize[1]), t: fmt(fp.flatSize[2]) })}</span>
            <span>{t('sheet.flat.rule', { rule: fp.rule, k: fmt(fp.kFactor) })}</span>
            {holes ? <span>{t('sheet.flat.holes', { n: holes })}</span> : null}
            {fp.unfolded ? <span class="sheet-flat-warn">{t('sheet.flat.unfolded')}</span> : null}
          </div>
          <FlatPatternDrawing flat={fp} />
          <div class="sheet-flat-bends" data-testid="sheet-flat-bends">
            <b>{t('sheet.flat.bends')}</b>
            {fp.bends.length === 0 ? <div class="sheet-flat-empty">{t('sheet.flat.noBends')}</div> : (
              <ul>
                {fp.bends.map((b) => (
                  <li key={b.bend} data-bend={b.bend}>
                    <span class="sheet-bend-id">{t('sheet.flat.bend', { n: b.bend })}</span>{' '}
                    {t('sheet.flat.bendRow', { dir: b.direction === 'up' ? t('sheet.flat.up') : t('sheet.flat.down'), angle: fmt(b.angleDeg), r: fmt(b.radius), ba: fmt(b.allowance), len: fmt(b.length) })}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
