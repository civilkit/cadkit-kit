import { useEffect, useState } from 'preact/hooks';
import scMap from './solidcraft/map.json';
import scAccents from './solidcraft/accents.json';

/** The optional second icon set: SolidCraft's two-tone icons (https://github.com/tangency-labs/solidcraft, MIT OR Apache-2.0; see
 *  ./solidcraft/ATTRIBUTION.md). A preview. `map.json` says which of our icon names have a SolidCraft master; every other name keeps our own icon.
 *  The masters are 64-grid SVGs with fixed hex colours; they are inlined with each hex replaced by a CSS variable (`--sc-*`, defined per theme in
 *  tokens.css), so they follow the light and dark themes. The blue "active" ramp is swapped for the accent of the icon's workspace (sketch green,
 *  constraint red, ...) with `data-sc` on the svg, as SolidCraft's palette does. */
export const ICON_SETS = ['default', 'solidcraft'] as const;
export type IconSet = (typeof ICON_SETS)[number];
export const DEFAULT_ICON_SET: IconSet = 'default';
export const asIconSet = (v: unknown): IconSet => ((ICON_SETS as readonly unknown[]).includes(v) ? (v as IconSet) : DEFAULT_ICON_SET);

/** Our icon name -> SolidCraft master ("model/line", optionally "model/move@sketch" to force the accent). */
export const SOLIDCRAFT_MAP: Readonly<Record<string, string>> = scMap;

const SVGS = import.meta.glob('./solidcraft/svg/**/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
/** Master name ("model/line") -> raw SVG text. */
export const SOLIDCRAFT_SVGS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(SVGS).map(([path, text]) => [path.replace('./solidcraft/svg/', '').replace(/\.svg$/, ''), text]),
);

/** Drawings of our own in the SolidCraft style, for commands the vendored masters do not cover (map value "own/<name>"). Kept apart from svg/ so
 *  the vendoring tool, which rewrites svg/, never touches them. */
const OWN = import.meta.glob('./solidcraft/own/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
export const OWN_SVGS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(OWN).map(([path, text]) => [path.replace('./solidcraft/', '').replace(/\.svg$/, ''), text]),
);

// the nine fixed colours of the masters -> theme variables (palette.toml of SolidCraft names the roles)
const ROLE: Record<string, string> = {
  '#34465b': '--sc-ink', '#6f879c': '--sc-guide', '#ffffff': '--sc-gap', '#e2e8ef': '--sc-p1', '#b8c3cf': '--sc-p2', '#8e9faf': '--sc-p3',
  '#b9ddf8': '--sc-a1', '#328bd3': '--sc-a2', '#236ead': '--sc-a3',
};
const recolour = (svg: string): string => svg.replace(/#[0-9a-fA-F]{6}\b/g, (h) => (ROLE[h.toLowerCase()] ? `var(${ROLE[h.toLowerCase()]})` : h));
const inner = (svg: string): string => recolour(svg.replace(/<!--[\s\S]*?-->/g, '').replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*$/, '').replace(/<title>[\s\S]*?<\/title>/, '')).trim();

export interface SolidcraftArt { inner: string; accent: string }
const cache = new Map<string, SolidcraftArt | null>();
/** The SolidCraft drawing for one of our icon names, or null when it has none (the caller draws ours). */
export function solidcraftArt(name: string): SolidcraftArt | null {
  if (cache.has(name)) return cache.get(name)!;
  let art: SolidcraftArt | null = null;
  const ref = Object.prototype.hasOwnProperty.call(SOLIDCRAFT_MAP, name) ? SOLIDCRAFT_MAP[name] : undefined;
  if (ref) {
    const [file, accent] = ref.split('@');
    const svg = SOLIDCRAFT_SVGS[file] ?? OWN_SVGS[file];
    if (svg) art = { inner: inner(svg), accent: accent ?? (scAccents as Record<string, string>)[file] ?? 'solid' };
  }
  cache.set(name, art);
  return art;
}

// the active set: module state with subscribers, so every mounted Icon redraws when the setting changes
let current: IconSet = DEFAULT_ICON_SET;
const listeners = new Set<(s: IconSet) => void>();
export const getIconSet = (): IconSet => current;
export function setIconSet(s: IconSet): void {
  if (s === current) return;
  current = s;
  for (const l of [...listeners]) l(s);
}
/** The active icon set, re-rendering the component when it changes. */
export function useIconSet(): IconSet {
  const [s, set] = useState<IconSet>(current);
  useEffect(() => { listeners.add(set); set(current); return () => { listeners.delete(set); }; }, []);
  return s;
}
