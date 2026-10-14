import { t } from './i18n';
/** Dimension values and constraint symbols drawn over the sketch. Positions are screen pixels already projected by
 *  the viewport. A dimension can be double-clicked to edit its value; hovering any of them highlights what it constrains. */
export interface AnnotationItem { id: string; text: string; kind: 'dimension' | 'mark'; x: number; y: number; driven?: boolean }

export function SketchAnnotations(p: { items: AnnotationItem[]; hot: string | null; onEdit(id: string): void; onHover(id: string | null): void; onToggleDriven?(id: string, driven: boolean): void }) {
  return (
    <div class="sketch-annots">
      {p.items.map((a) => (
        <span
          key={a.id}
          class={`annot ${a.kind}${a.driven ? ' driven' : ''}${p.hot === a.id ? ' hot' : ''}`}
          title={a.kind === 'dimension' ? (a.driven ? t('app.sketch.driving.tip') : t('app.sketch.driven.tip')) : undefined}
          onContextMenu={(e) => { if (a.kind === 'dimension' && p.onToggleDriven) { e.preventDefault(); e.stopPropagation(); p.onToggleDriven(a.id, !!a.driven); } }}
          style={{ left: a.x + 'px', top: a.y + 'px' }}
          onPointerEnter={() => p.onHover(a.id)}
          onPointerLeave={() => p.onHover(null)}
          onDblClick={(e) => { e.stopPropagation(); if (a.kind !== 'dimension') return; if (a.driven) p.onToggleDriven?.(a.id, true); else p.onEdit(a.id); }}
        >
          {a.text}
        </span>
      ))}
    </div>
  );
}
