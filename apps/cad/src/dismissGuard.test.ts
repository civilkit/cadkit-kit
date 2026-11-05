import { afterEach, describe, expect, it, vi } from 'vitest';
import { installDismissGuard } from './dismissGuard';

afterEach(() => { document.body.innerHTML = ''; });
const down = (el: Element) => el.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));

describe('the click that dismisses a popover does not reach the viewport', () => {
  it('is swallowed while a popover is open, and the next click goes through', () => {
    document.body.innerHTML = '<div id="vp"><canvas></canvas></div><button aria-haspopup="true" aria-expanded="true">Snaps</button>';
    const vp = document.getElementById('vp')!;
    const seen = vi.fn(); vp.addEventListener('pointerdown', seen);
    const off = installDismissGuard();
    down(vp.querySelector('canvas')!);
    expect(seen).not.toHaveBeenCalled();
    document.querySelector('button')!.setAttribute('aria-expanded', 'false');   // the popover closed itself
    down(vp.querySelector('canvas')!);
    expect(seen).toHaveBeenCalledTimes(1);
    off();
  });
  it('a context menu counts too, and clicks outside the viewport are left alone', () => {
    document.body.innerHTML = '<div id="vp"></div><div class="ctx-menu"></div><button id="x">x</button>';
    const seenVp = vi.fn(), seenBtn = vi.fn();
    document.getElementById('vp')!.addEventListener('pointerdown', seenVp);
    document.getElementById('x')!.addEventListener('pointerdown', seenBtn);
    const off = installDismissGuard();
    down(document.getElementById('vp')!); down(document.getElementById('x')!);
    expect(seenVp).not.toHaveBeenCalled();
    expect(seenBtn).toHaveBeenCalledTimes(1);
    off();
  });
  it('the view navigation ring keeps working while its own menu is open', () => {
    document.body.innerHTML = '<div id="vp"><div class="viewnav"><button id="arrow">a</button><button aria-haspopup="menu" aria-expanded="true">m</button></div><canvas></canvas></div>';
    const seenArrow = vi.fn(), seenCanvas = vi.fn();
    document.getElementById('arrow')!.addEventListener('pointerdown', seenArrow);
    document.querySelector('canvas')!.addEventListener('pointerdown', seenCanvas);
    const off = installDismissGuard();
    down(document.getElementById('arrow')!); down(document.querySelector('canvas')!);
    expect(seenArrow).toHaveBeenCalledTimes(1);
    expect(seenCanvas).not.toHaveBeenCalled();
    off();
  });
});
