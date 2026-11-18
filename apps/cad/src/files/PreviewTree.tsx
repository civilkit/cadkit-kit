// The assembly tree of a mesh-only STEP preview: products with their bodies, an eye per row, a filter. View only.
import type { JSX } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { Icon } from '@kit/ui';
import { t } from '../i18n';
import { nodeOwner, type PreviewNode } from './stepPreviewMesh';

/** The node and every node under it. */
export function subtreeIds(nodes: PreviewNode[], id: number): number[] {
  const kids = new Map<number, number[]>();
  for (const n of nodes) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n.id]);
  const out: number[] = [], stack = [id];
  while (stack.length) { const x = stack.pop()!; out.push(x); stack.push(...(kids.get(x) ?? [])); }
  return out;
}

/** The rows to show: all of them, or with a filter the matches, the rows above them and the bodies under a matching product. */
export function visibleRows(nodes: PreviewNode[], collapsed: ReadonlySet<number>, filter: string): Array<{ node: PreviewNode; depth: number; open: boolean; hasKids: boolean }> {
  const kids = new Map<number, PreviewNode[]>();
  for (const n of nodes) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n]);
  const q = filter.trim().toLowerCase();
  const match = new Map<number, boolean>();
  const hit = (n: PreviewNode): boolean => {
    let m = !q || n.name.toLowerCase().includes(q);
    for (const c of kids.get(n.id) ?? []) if (hit(c)) m = true;
    match.set(n.id, m);
    return m;
  };
  (kids.get(0) ?? []).forEach(hit);
  const rows: Array<{ node: PreviewNode; depth: number; open: boolean; hasKids: boolean }> = [];
  const walk = (n: PreviewNode, depth: number, underMatch: boolean) => {
    const own = !q || n.name.toLowerCase().includes(q);
    if (!match.get(n.id) && !underMatch) return;
    const c = kids.get(n.id) ?? [];
    const open = q ? true : !collapsed.has(n.id);
    rows.push({ node: n, depth, open, hasKids: c.length > 0 });
    if (open) c.forEach((k) => walk(k, depth + 1, underMatch || (!!q && own)));
  };
  (kids.get(0) ?? []).forEach((n) => walk(n, 0, false));
  return rows;
}

/** Products that hold bodies start closed (hundreds of bodies); wrappers of products start open. */
export function defaultCollapsed(nodes: PreviewNode[]): Set<number> {
  const hasBody = new Set(nodes.filter((n) => n.kind === 'body').map((n) => n.parent));
  return new Set(nodes.filter((n) => hasBody.has(n.id)).map((n) => n.id));
}

export function PreviewTree(p: {
  nodes: PreviewNode[];
  hiddenIds: string[];
  /** Hide (true) or show every id in the list. */
  onSetHidden(ids: string[], hide: boolean): void;
  onShowAll(): void;
  onHover?(id: string | null): void;
}): JSX.Element {
  const [collapsed, setCollapsed] = useState<Set<number>>(() => defaultCollapsed(p.nodes));
  const [filter, setFilter] = useState('');
  const hidden = useMemo(() => new Set(p.hiddenIds), [p.hiddenIds]);
  const rows = useMemo(() => visibleRows(p.nodes, collapsed, filter), [p.nodes, collapsed, filter]);
  const anyHidden = p.nodes.some((n) => hidden.has(nodeOwner(n.id)));
  const toggleOpen = (id: number) => setCollapsed((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleHide = (id: number) => p.onSetHidden(subtreeIds(p.nodes, id).map(nodeOwner), !hidden.has(nodeOwner(id)));
  return (
    <div class="ptree">
      <div class="ptree-head">
        <b>{t('files.ptree.title')}</b>
        {anyHidden ? <button class="ptree-all" onClick={p.onShowAll}>{t('files.ptree.showAll')}</button> : null}
      </div>
      <input class="ptree-filter" type="search" placeholder={t('files.ptree.filter')} value={filter} onInput={(e) => setFilter((e.target as HTMLInputElement).value)} />
      <div class="ptree-rows">
        {rows.map(({ node, depth, open, hasKids }) => {
          const off = hidden.has(nodeOwner(node.id));
          return (
            <div key={node.id} class={'row ptree-row' + (off ? ' off' : '') + (node.kind === 'body' ? ' body' : '')} style={{ paddingLeft: 8 + depth * 14 }}
              onMouseEnter={() => p.onHover?.(nodeOwner(node.id))} onMouseLeave={() => p.onHover?.(null)}>
              {hasKids
                ? <button class="ptree-chev" aria-label={open ? 'Collapse' : 'Expand'} onClick={() => toggleOpen(node.id)}><Icon name="chevron" size={12} class={open ? 'open' : ''} /></button>
                : <span class="ptree-chev" />}
              <button class="ptree-eye" title={off ? t('files.ptree.show') : t('files.ptree.hide')} aria-pressed={off} onClick={() => toggleHide(node.id)}><Icon name={off ? 'eye-off' : 'eye'} size={15} /></button>
              <span class="ptree-name" title={node.name}>{node.name}</span>
              <span class="ptree-tris" title={t('files.ptree.tris', { n: node.triangles.toLocaleString() })}>{node.triangles.toLocaleString()}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
