import { t } from './i18n';
import type { ScreenDim } from './dimGraphics';
import { GLYPH_PATHS } from './annotChips';
/** Dimension values (a monospace value on a dark rounded chip, pale-violet lines) and constraint glyphs (a small rounded square with an icon) drawn over the sketch. Positions are screen pixels already projected by
 *  the viewport. A dimension can be double-clicked to edit its value; hovering any of them highlights what it constrains. */
export interface AnnotationItem { id: string; text: string; kind: 'dimension' | 'mark'; /** the constraint type (radius, distance ...) */ type?: string; x: number; y: number; /** a reference (measured, not driving) dimension */ driven?: boolean; /** the solver blames this constraint */ blame?: 'conflict' | 'redundant'; /** linked to a variable by an expression */ fx?: boolean; /** the entities and points the constraint refers to (which chips show for what is hovered) */ refs?: string[]; /** an H / V lock on a side of a closed rectangle (shown on hover only) */ axisLock?: boolean; /** the dimension's drawing in pixels: extension lines, dimension line, arrowheads (the label sits on it) */ dim?: ScreenDim }

export function SketchAnnotations(p: { items: AnnotationItem[]; hot: string | null; /** touch layout (phone, tablet): every chip has a 44 px tap target */ touch?: boolean; /** the selected constraint (Delete removes it) */ selected?: string | null; /** a click on a chip */ onSelect?(id: string): void; /** a sketch tool is active: glyph chips let the pointer through */ inert?: boolean; onEdit(id: string): void; onHover(id: string | null): void; onToggleDriven?(id: string, driven: boolean): void; /** right-click on a dimension (replaces the plain driving toggle) */ onMenu?(a: AnnotationItem, x: number, y: number): void }) {
  return (
    <div class={`sketch-annots${p.touch ? ' touch' : ''}`}>
      <svg class="annot-lines" aria-hidden="true">
        {p.items.filter((a) => a.dim).map((a) => {
          const d = a.dim!;
          return (
            <g key={a.id} class={`dimg${a.driven ? ' driven' : ''}${a.blame === 'conflict' ? ' bad' : ''}${p.hot === a.id ? ' hot' : ''}`} data-dim={a.id}>
              {d.lines.map((l, i) => <line key={i} x1={l[0]} y1={l[1]} x2={l[2]} y2={l[3]} />)}
              {d.arc.length ? <polyline points={d.arc.map((q) => q.join(',')).join(' ')} fill="none" /> : null}
              {d.arrows.map((r, i) => <polygon key={'a' + i} class="arrow" points={arrowPoints(r)} />)}
            </g>
          );
        })}
      </svg>
      {p.items.map((a) => (
        <span
          key={a.id}
          class={`annot ${a.kind}${a.driven ? ' driven' : ''}${a.blame ? ' ' + a.blame : ''}${p.hot === a.id ? ' hot' : ''}${p.selected === a.id ? ' sel' : ''}${a.kind === 'mark' && p.inert ? ' inert' : ''}`}
          data-id={a.id}
          data-type={a.type}
          title={a.kind === 'dimension' ? (a.driven ? t('app.sketch.driving.tip') : t('app.sketch.dim.editTip')) : t('app.sketch.constraint.' + (a.type ?? ''), undefined, a.type ?? a.text)}
          aria-label={a.kind === 'mark' ? t('app.sketch.constraint.' + (a.type ?? ''), undefined, a.type ?? a.text) : undefined}
          onContextMenu={(e) => { if (a.kind === 'dimension' && p.onMenu) { e.preventDefault(); e.stopPropagation(); p.onMenu(a, e.clientX, e.clientY); } else if (a.kind === 'dimension' && p.onToggleDriven) { e.preventDefault(); e.stopPropagation(); p.onToggleDriven(a.id, !!a.driven); } }}
          style={{ left: a.x + 'px', top: a.y + 'px', ...(a.dim && a.dim.text.slopeDeg ? { transform: `translate(-50%, -50%) rotate(${a.dim.text.slopeDeg}deg)` } : {}) }}
          onPointerEnter={() => p.onHover(a.id)}
          onPointerLeave={() => p.onHover(null)}
          onClick={(e) => { e.stopPropagation(); p.onSelect?.(a.id); }}
          onDblClick={(e) => { e.stopPropagation(); if (a.kind !== 'dimension') return; if (a.driven) p.onToggleDriven?.(a.id, true); else p.onEdit(a.id); }}
        >
          {a.kind === 'mark' && a.type && GLYPH_PATHS[a.type]
            ? <svg class="glyph" viewBox="0 0 16 16" aria-hidden="true"><path d={GLYPH_PATHS[a.type]} /></svg>
            : <>{a.fx ? <i class="annot-fx">fx</i> : null}{a.text}</>}
        </span>
      ))}
    </div>
  );
}

/** A filled arrowhead (about 9 px long, 3.5 px half-width) at a tip, pointing along the direction. */
export function arrowPoints(r: [number, number, number, number]): string {
  const [x, y, dx, dy] = r, L = 9, W = 3.5;
  const bx = x - dx * L, by = y - dy * L;
  return `${x},${y} ${bx - dy * W},${by + dx * W} ${bx + dy * W},${by - dx * W}`;
}
