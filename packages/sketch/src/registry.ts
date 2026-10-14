/** Every sketch tool the editor offers, in toolbar order, with its group and shortcut. The app builds its tool
 *  strip, its command palette entries and its keys from this list, so a new tool appears everywhere at once. */
import {
  bridgeTool, centerlineTool, centerRectangleTool, centreArcTool, chamferTool, circleTool, constructionTool, coincidentTool, collinearTool,
  concentricTool, cvsplineTool, dimensionTool, ellipseTool, equalTool, filletTool, fixTool, horizontalTool, lineTool,
  midpointTool, mirrorTool, offsetTool, parallelTool, perpendicularTool, pointTool, polygonTool, projectTool, rectangleTool, slotTool, splineTool,
  symmetricTool, tangentArcTool, tangentTool, threePointArcTool, trimTool, verticalTool,
} from './tools/index';
import type { Tool } from './tools/types';

export type ToolGroup = 'draw' | 'dimension' | 'constrain' | 'edit';

export interface ToolEntry {
  id: string;
  group: ToolGroup;
  /** Shortcut key (lower case), if any. */
  key?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tool: Tool<any>;
}

const e = (group: ToolGroup, tool: { id: string }, key?: string): ToolEntry => ({ id: tool.id, group, ...(key ? { key } : {}), tool: tool as ToolEntry['tool'] });

let cache: ToolEntry[] | null = null;

/** Built on first use: the tool modules import the draft model that re-exports this file, so reading them while
 *  the package is still loading would see undefined tools. */
export function sketchTools(): ToolEntry[] {
  return (cache ??= build());
}

const build = (): ToolEntry[] => [
  e('draw', lineTool, 'l'), e('draw', rectangleTool, 'r'), e('draw', centerRectangleTool), e('draw', circleTool, 'c'),
  e('draw', centreArcTool), e('draw', threePointArcTool, 'a'), e('draw', tangentArcTool), e('draw', ellipseTool),
  e('draw', polygonTool), e('draw', slotTool), e('draw', pointTool), e('draw', centerlineTool), e('draw', splineTool),
  e('draw', cvsplineTool), e('draw', bridgeTool),
  e('dimension', dimensionTool, 'd'),
  e('constrain', horizontalTool, 'h'), e('constrain', verticalTool, 'v'), e('constrain', coincidentTool),
  e('constrain', equalTool), e('constrain', parallelTool), e('constrain', perpendicularTool), e('constrain', collinearTool),
  e('constrain', midpointTool), e('constrain', tangentTool), e('constrain', symmetricTool), e('constrain', fixTool),
  e('constrain', concentricTool),
  e('edit', filletTool), e('edit', chamferTool), e('edit', trimTool, 't'), e('edit', mirrorTool), e('edit', offsetTool, 'o'), e('edit', constructionTool, 'x'), e('edit', projectTool, 'p'),
];

export const toolById = (id: string): ToolEntry | undefined => sketchTools().find((t) => t.id === id);
