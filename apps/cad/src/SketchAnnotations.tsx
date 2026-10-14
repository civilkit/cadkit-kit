/** Dimension values and constraint symbols drawn over the sketch. Positions are screen pixels already projected by
 *  the viewport. A dimension can be double-clicked to edit its value; hovering any of them highlights what it constrains. */
export interface AnnotationItem { id: string; text: string; kind: 'dimension' | 'mark'; x: number; y: number; /** linked to a variable by an expression */ driven?: boolean }

export function SketchAnnotations(p: { items: AnnotationItem[]; hot: string | null; onEdit(id: string): void; onHover(id: string | null): void }) {
  return (
    <div class="sketch-annots">
      {p.items.map((a) => (
        <span
          key={a.id}
          class={`annot ${a.kind}${a.driven ? ' driven' : ''}${p.hot === a.id ? ' hot' : ''}`}
          style={{ left: a.x + 'px', top: a.y + 'px' }}
          onPointerEnter={() => p.onHover(a.id)}
          onPointerLeave={() => p.onHover(null)}
          onDblClick={(e) => { e.stopPropagation(); if (a.kind === 'dimension') p.onEdit(a.id); }}
        >
          {a.driven ? <i class="annot-fx">fx</i> : null}{a.text}
        </span>
      ))}
    </div>
  );
}
