import { describe, expect, it } from 'vitest';
import { isTextEntry, scriptOwnsKey } from './keyGuard';

const el = (html: string): HTMLElement => { const d = document.createElement('div'); d.innerHTML = html; document.body.append(d); return d.firstElementChild as HTMLElement; };
describe('keyGuard', () => {
  it('treats inputs, textareas, selects, editable regions and CodeMirror as text entry', () => {
    expect(isTextEntry(el('<textarea></textarea>'))).toBe(true);
    expect(isTextEntry(el('<input>'))).toBe(true);
    expect(isTextEntry(el('<select></select>'))).toBe(true);
    expect(isTextEntry(el('<div contenteditable="true"><span id="in">x</span></div>').querySelector('#in'))).toBe(true);
    expect(isTextEntry(el('<div class="cm-editor"><div class="cm-content"><span id="cm">x</span></div></div>').querySelector('#cm'))).toBe(true);
    expect(isTextEntry(el('<div role="textbox"></div>'))).toBe(true);
    expect(isTextEntry(el('<button></button>'))).toBe(false);
    expect(isTextEntry(document.body)).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });
  it('gives plain keys to the Script box while that tab shows and the viewport is not the target', () => {
    const vp = el('<div id="vp"><canvas></canvas></div>');
    expect(scriptOwnsKey(true, document.body)).toBe(true);
    expect(scriptOwnsKey(true, el('<button></button>'))).toBe(true);
    expect(scriptOwnsKey(true, vp.querySelector('canvas'))).toBe(false);
    expect(scriptOwnsKey(true, el('<div id="vp2"><button></button></div>').querySelector('button'))).toBe(true);   // a button inside the viewport overlay (Fit) is not the canvas
    expect(scriptOwnsKey(false, document.body)).toBe(false);
    expect(scriptOwnsKey(true, document.body, true)).toBe(false);   // the last press was on the canvas, which takes no focus
    expect(scriptOwnsKey(true, document.body, false)).toBe(true);
  });
});
