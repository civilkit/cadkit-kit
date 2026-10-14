// Commands for display styles, lighting, background and hiding (see look.ts). Pure: the handlers come in as `LookActions`.
import type { Command } from '@kit/ui';
import { DISPLAY_STYLES, LIGHT_PRESETS, BACKGROUND_MODES, type DisplayStyle, type LightPreset, type BackgroundMode } from '@kit/viewport';
import { t } from './i18n';

export interface LookActions {
  style(): DisplayStyle;
  setStyle(s: DisplayStyle): void;
  light(): LightPreset;
  setLight(l: LightPreset): void;
  background(): BackgroundMode;
  setBackground(b: BackgroundMode): void;
  /** Hide the body of the selected faces, or the selected sketch / plane / curve. */
  hideSelection(): void;
  canHide(): boolean;
  showAll(): void;
  anyHidden(): boolean;
}

/** Alt+1..5 pick the style (the plain digits are the standard views). */
export const STYLE_KEYS: Record<DisplayStyle, string> = { shaded: 'Alt+1', shadedEdges: 'Alt+2', wireframe: 'Alt+3', hiddenLines: 'Alt+4', ghost: 'Alt+5' };

export function lookCommands(a: LookActions): Command[] {
  const cmds: Command[] = [];
  for (const s of DISPLAY_STYLES) cmds.push({ id: `style-${s}`, label: t('style.' + s), tab: 'View', group: 'Style', keys: STYLE_KEYS[s], pressed: () => a.style() === s, run: () => a.setStyle(s) });
  cmds.push({ id: 'hide-selection', label: t('cmd.hide-selection'), tab: 'View', group: 'Show', keys: 'H', enabled: a.canHide, run: a.hideSelection });
  cmds.push({ id: 'show-all', label: t('cmd.show-all'), tab: 'View', group: 'Show', keys: 'Alt+H', enabled: a.anyHidden, run: a.showAll });
  for (const l of LIGHT_PRESETS) cmds.push({ id: `light-${l}`, label: t('light.' + l), tab: 'View', group: 'Lighting', pressed: () => a.light() === l, run: () => a.setLight(l) });
  for (const b of BACKGROUND_MODES) cmds.push({ id: `bg-${b}`, label: t('bg.' + b), tab: 'View', group: 'Background', pressed: () => a.background() === b, run: () => a.setBackground(b) });
  return cmds;
}
