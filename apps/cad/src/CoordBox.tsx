import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { evalExpr, useScope } from '@kit/ui';
import { parseTypedPoint, placeCoordBox, type TypedPoint } from '@kit/sketch';
import { t } from './i18n';

/** The box a first point is typed into: `x,y` (or `@x,y`), each a number, a variable or an expression. Enter places it, Escape closes it.
 *  It opens with the key that started it (a digit, a minus, `@`) already in it, or empty for `g`. */
export function CoordBox(p: { initial: string; x: number; y: number; onSubmit(pt: TypedPoint): void; onCancel(): void }) {
  const scope = useScope();
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [bad, setBad] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: p.x + 16, top: p.y + 16 });
  // Synchronously (before the next key event can arrive): focus the input with the text that opened the box. Keys that arrive before it
  // has focus come in as a longer `initial`, which replaces the text (the user cannot have typed into the input yet).
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    if (el.value !== p.initial) el.value = p.initial;
    if (document.activeElement !== el) el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [p.initial]);
  // fully inside the area it is positioned in: flipped left / up near the right / bottom edge
  useLayoutEffect(() => {
    const b = box.current;
    if (!b) return;
    const r = b.getBoundingClientRect();
    const host = b.offsetParent as HTMLElement | null;
    const vw = host?.clientWidth || window.innerWidth, vh = host?.clientHeight || window.innerHeight;
    const w = r.width || 220, h = r.height || 40;
    const next = placeCoordBox(p.x, p.y, w, h, vw, vh);
    setPos((o) => (o.left === next.left && o.top === next.top ? o : next));
  }, [p.x, p.y, bad]);
  const evaluate = (s: string): number | null => { const r = evalExpr(s, scope.values); return r.ok ? r.value : null; };
  return (
    <div ref={box} class="sketch-fields coord-box" style={{ left: pos.left + 'px', top: pos.top + 'px' }} onPointerDown={(e) => e.stopPropagation()}>
      <label title={t('app.sketch.coord.tip')}>
        <span>{t('app.sketch.coord.label')}</span>
        <input
          ref={input}
          type="text"
          class="coord-input"
          defaultValue={p.initial}
          aria-label={t('app.sketch.coord.label')}
          aria-invalid={bad ? 'true' : 'false'}
          autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck={false}
          placeholder="x, y"
          onInput={() => setBad(false)}
          onKeyDown={(e) => {
            // text typed here belongs to the box: no single-key shortcut may see it
            if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) e.stopPropagation();
            if (e.key === 'Enter') {
              e.preventDefault(); e.stopPropagation();
              const pt = parseTypedPoint((e.target as HTMLInputElement).value, evaluate);
              if (pt) p.onSubmit(pt); else setBad(true);
            } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); p.onCancel(); }
          }}
        />
      </label>
      {bad ? <span class="coord-bad">{t('app.sketch.coord.bad')}</span> : null}
    </div>
  );
}
