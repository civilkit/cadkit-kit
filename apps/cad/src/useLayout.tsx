import type { JSX } from 'preact';
import { Splitter, CornerGrip } from '@kit/ui';
import { t } from './i18n';
import { DEFAULT_SIZES, type Store, type Workspace } from '@kit/store';

/** Panel size limits (px). The 3D viewport always keeps VIEWPORT_MIN of width. */
export const PANEL_MIN = 200, DRAWER_MIN = 80, VIEWPORT_MIN = 320, PANEL_FRAC = 0.6, DRAWER_FRAC = 0.7;

export interface Limits { w: number; h: number; leftOpen: boolean; rightOpen: boolean; left: number; right: number }
export const leftMax = (l: Limits) => Math.max(PANEL_MIN, Math.min(l.w * PANEL_FRAC, l.w - (l.rightOpen ? l.right : 0) - VIEWPORT_MIN));
export const rightMax = (l: Limits) => Math.max(PANEL_MIN, Math.min(l.w * PANEL_FRAC, l.w - (l.leftOpen ? l.left : 0) - VIEWPORT_MIN));
export const drawerMax = (l: Limits) => Math.max(DRAWER_MIN, l.h * DRAWER_FRAC);

const app = () => document.getElementById('app');
const px = (v: number) => `${Math.round(v)}px`;

/** The CSS variables that carry the stored sizes; the stylesheet clamps them to the window. */
export function layoutStyle(ws: Workspace): Record<string, string> {
  return { '--lw-user': px(ws.leftWidth), '--rw-user': px(ws.rightWidth), '--dh-user': px(ws.drawerHeight), '--fw': px(ws.floatWidth), ...(ws.floatHeight ? { '--fh': px(ws.floatHeight) } : {}) };
}

/** Splitters for the docked left and right panels, the drawer and the floating panel. During a drag only CSS variables on #app change
 *  (no re-render); the store is written once on release, which is also what localStorage persists. */
export function layoutHandles(store: Store, ws: Workspace): { docked: JSX.Element[]; floating: JSX.Element | null } {
  const limits = (): Limits => {
    const w = store.workspace.value;
    return { w: window.innerWidth, h: window.innerHeight, leftOpen: w.leftPanel === 'docked' && !w.leftCollapsed, rightOpen: w.rightPanel === 'docked', left: w.leftWidth, right: w.rightWidth };
  };
  const set = (vars: Record<string, string | null>) => { const a = app(); if (a) for (const k in vars) vars[k] === null ? a.style.removeProperty(k) : a.style.setProperty(k, vars[k]!); };
  const live = (inline: string, user: string) => (v: number) => (v === 0 ? set({ [inline]: '0px' }) : set({ [inline]: px(v), [user]: px(v) }));
  const done = (inline: string) => set({ [inline]: null });

  const leftOpen = ws.leftPanel === 'docked' && !ws.leftCollapsed;
  const rightOpen = ws.rightPanel === 'docked';
  const docked: JSX.Element[] = [];

  if (ws.leftPanel !== 'floating') docked.push(
    <Splitter key="l" class="sp-left" orientation="vertical" label={t('app.resize.left')} value={leftOpen ? ws.leftWidth : 0} min={PANEL_MIN} max={() => leftMax(limits())} def={DEFAULT_SIZES.leftWidth} grow={1} collapsible
      onLive={live('--lw', '--lw-user')}
      onEnd={() => done('--lw')} onCommit={(v) => { store.setWorkspace(v === 0 ? { leftCollapsed: true } : { leftWidth: v, leftCollapsed: false, leftPanel: 'docked' }); }} />);
  if (ws.rightPanel !== 'floating') docked.push(
    <Splitter key="r" class="sp-right" orientation="vertical" label={t('app.resize.right')} value={rightOpen ? ws.rightWidth : 0} min={PANEL_MIN} max={() => rightMax(limits())} def={DEFAULT_SIZES.rightWidth} grow={-1} collapsible
      onLive={live('--rw', '--rw-user')}
      onEnd={() => done('--rw')} onCommit={(v) => { store.setWorkspace(v === 0 ? { rightPanel: 'off' } : { rightWidth: v, rightPanel: 'docked' }); }} />);
  docked.push(
    <Splitter key="d" class="sp-drawer" orientation="horizontal" label={t('app.resize.drawer')} value={ws.drawerOpen ? ws.drawerHeight : 0} min={DRAWER_MIN} max={() => drawerMax(limits())} def={DEFAULT_SIZES.drawerHeight} grow={-1} collapsible
      onLive={live('--dh', '--dh-user')}
      onEnd={() => done('--dh')} onCommit={(v) => { store.setWorkspace(v === 0 ? { drawerOpen: false } : { drawerHeight: v, drawerOpen: true }); }} />);

  let floating: JSX.Element | null = null;
  if (ws.leftPanel === 'floating') {
    const panel = () => document.querySelector<HTMLElement>('.tree-wrap.floating');
    const maxWH = (): [number, number] => { const vp = document.getElementById('vp'); const w = window.innerWidth, h = vp ? vp.clientHeight - 24 : window.innerHeight; return [Math.max(PANEL_MIN, Math.min(w * PANEL_FRAC, w - 24)), Math.max(120, h)]; };
    floating = (<>
      <Splitter key="fe" class="sp-float-edge" orientation="vertical" label={t('app.resize.floating')} value={ws.floatWidth} min={PANEL_MIN} max={() => maxWH()[0]} def={DEFAULT_SIZES.floatWidth} grow={1}
        onLive={(v) => set({ '--fw': px(v) })} onCommit={(v) => store.setWorkspace({ floatWidth: v })} />
      <CornerGrip key="fc" label={t('app.resize.corner')} size={() => [panel()?.offsetWidth ?? ws.floatWidth, panel()?.offsetHeight ?? 400]} min={[PANEL_MIN, 120]} max={maxWH}
        onLive={(w, h) => set({ '--fw': px(w), '--fh': px(h) })} onCommit={(w, h) => store.setWorkspace({ floatWidth: w, floatHeight: h })}
        onReset={() => { store.setWorkspace({ floatWidth: DEFAULT_SIZES.floatWidth, floatHeight: 0 }); set({ '--fw': null, '--fh': null }); }} />
    </>);
  }
  return { docked, floating };
}

/** "Reset layout": every panel size back to its default, the left panel unfolded. */
export function resetLayout(store: Store): void {
  store.resetLayout();
  const a = app();
  if (a) for (const k of ['--lw', '--rw', '--dh', '--fw', '--fh', '--lw-user', '--rw-user', '--dh-user']) a.style.removeProperty(k);
}
