import { describe, it, expect, beforeEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { setLocale, t, PSEUDO, resetMissing, missing } from '@kit/i18n';
import { en as appEn } from './locales/en';
import { en as uiEn } from '../../../packages/ui/src/locales/en';
import { buildCommands, type Actions } from './commands';
import './i18n';

const root = process.cwd();                       // tests run from the kit root
const dirs = [path.join(root, 'apps/cad/src'), path.join(root, 'packages/ui/src')];
const sources = dirs.flatMap((d) => readdirSync(d).filter((f) => /\.(tsx?|ts)$/.test(f) && !/\.test\./.test(f) && !/locales/.test(f))
  .map((f) => ({ f, text: readFileSync(path.join(d, f), 'utf8') })));
const all = { ...uiEn, ...appEn } as Record<string, unknown>;

beforeEach(() => { setLocale('en'); resetMissing(); });

describe('i18n catalogues', () => {
  it('every literal key passed to t() exists in the English catalogue', () => {
    const bad: string[] = [];
    for (const { f, text } of sources) {
      for (const m of text.matchAll(/\bt\('([A-Za-z0-9_.-]+)'\s*[,)]/g)) if (!(m[1] in all)) bad.push(`${f}: ${m[1]}`);
    }
    expect(bad).toEqual([]);
  });
  it('dynamic key families used by the UI are complete', () => {
    const need = [
      ...['Outliner', 'Features', 'Assets', 'Editor'].map((x) => `app.leftTab.${x}`),
      ...['All', 'You', 'Agent', 'Failed'].map((x) => `ui.history.filter.${x}`),
      ...['edges', 'sketches', 'curves', 'planes', 'axes', 'relations'].map((x) => `layer.${x}`),
      ...['off', 'compact', 'full'].map((x) => `settings.ribbon.${x}`),
      ...['docked', 'floating', 'hidden'].map((x) => `settings.leftPanel.${x}`),
      ...['off', 'docked', 'floating'].map((x) => `settings.rightPanel.${x}`),
      ...['leftTabs', 'toolRail', 'selectionBar', 'drawerOpen', 'ribbon', 'leftPanel', 'rightPanel'].map((x) => `settings.${x}`),
      ...['Home', 'View', 'Select'].map((x) => `tab.${x}`),
      ...['File', 'Edit', 'Workspace', 'Views', 'Show', 'Pick'].map((x) => `group.${x}`),
    ];
    expect(need.filter((k) => !(k in all))).toEqual([]);
  });
  it('every command label is translated, and the pseudo-locale marks all of them', () => {
    const a: Actions = {
      open() {}, save() {}, samples() {}, undo() {}, redo() {}, palette() {}, toggleDrawer() {}, settings() {}, hasDocument: () => true, newPart() {}, newSketch() {},
      setView() {}, fit() {}, setMode() {}, mode: () => 'face', toggleLayer() {}, layer: () => false,
    };
    const labels = buildCommands(a).map((c) => c.label);
    expect(labels.every((l) => !l.includes('.') || l.includes(' '))).toBe(true);   // no raw keys such as cmd.open
    setLocale(PSEUDO);
    const pseudo = buildCommands(a).map((c) => c.label);
    expect(pseudo.every((l) => l.startsWith('[!! '))).toBe(true);
  });
  it('every feature type the kernel model knows has a display name', () => {
    const types = ['sketch', 'sketch3d', 'extrude', 'revolve', 'sweep', 'loft', 'fillet', 'chamfer', 'draft', 'shell', 'hole', 'helix', 'rib', 'lip', 'lpattern', 'cpattern', 'curvepattern', 'fillpattern', 'spattern', 'mirror', 'trimSurface', 'surfacePlanar', 'surfaceRevolve', 'surfaceExtrude', 'surfaceOffset', 'knit', 'fill', 'insertPart', 'mate', 'plane', 'deleteBody', 'deleteFace', 'thicken', 'cutWithSurface', 'pipeCut', 'freeform', 'editCurve', 'projectCurve', 'extend', 'dome', 'splitLine', 'moveFace', 'moveBody', 'scale', 'axis'];
    expect(types.filter((x) => !(`feature.${x}` in all))).toEqual([]);
  });
  it('reports nothing missing when running in English', () => {
    t('ui.close'); t('app.noPart');
    expect(missing()).toEqual([]);
  });
});
