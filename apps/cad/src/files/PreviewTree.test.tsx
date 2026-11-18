import { describe, expect, it } from 'vitest';
import { defaultCollapsed, subtreeIds, visibleRows } from './PreviewTree';
import type { PreviewNode } from './stepPreviewMesh';

const nodes: PreviewNode[] = [
  { id: 1, name: 'Asm', parent: 0, kind: 'product', triangles: 30 },
  { id: 2, name: 'Board', parent: 1, kind: 'product', triangles: 20 },
  { id: 3, name: 'Body 1', parent: 2, kind: 'body', triangles: 12 },
  { id: 4, name: 'Resistor', parent: 2, kind: 'body', triangles: 8 },
  { id: 5, name: 'Holder', parent: 1, kind: 'product', triangles: 10 },
  { id: 6, name: 'Body 1', parent: 5, kind: 'body', triangles: 10 },
];

describe('PreviewTree helpers', () => {
  it('subtreeIds lists a node and everything under it', () => {
    expect(subtreeIds(nodes, 2).sort()).toEqual([2, 3, 4]);
    expect(subtreeIds(nodes, 6)).toEqual([6]);
    expect(subtreeIds(nodes, 1).sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it('products that hold bodies start collapsed, wrappers open', () => {
    expect([...defaultCollapsed(nodes)].sort()).toEqual([2, 5]);
  });
  it('visibleRows follows the collapsed set', () => {
    const rows = visibleRows(nodes, defaultCollapsed(nodes), '');
    expect(rows.map((r) => [r.node.id, r.depth])).toEqual([[1, 0], [2, 1], [5, 1]]);
    const open = visibleRows(nodes, new Set(), '');
    expect(open.map((r) => r.node.id)).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it('a filter keeps matches and the rows above them, opening what it needs', () => {
    const rows = visibleRows(nodes, defaultCollapsed(nodes), 'resis');
    expect(rows.map((r) => r.node.id)).toEqual([1, 2, 4]);
    // a matching product shows its bodies too
    expect(visibleRows(nodes, defaultCollapsed(nodes), 'holder').map((r) => r.node.id)).toEqual([1, 5, 6]);
  });
});
