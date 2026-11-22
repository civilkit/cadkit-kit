import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { placeTip } from '@kit/ui';
import { t } from './i18n';
import { currentTopic, helpCard, type HelpContext } from './helpMap';
import { closeHelp, helpAnchorFor, helpOpen, openHelp, subscribeHelp } from './helpState';

/** A round '?' that opens the help card of one topic (a tool, a feature editor, a wizard, or the guide itself). At least 44 px to hit on a touch screen. */
export function HelpButton(p: { topic: string; class?: string }) {
  const [, tick] = useState(0);
  useEffect(() => subscribeHelp(() => tick((n) => n + 1)), []);
  const open = helpOpen();
  const card = helpCard(p.topic);
  const name = t('help.openFor', { name: card.name });
  return (
    <button type="button" class={'help-btn' + (p.class ? ' ' + p.class : '')} data-help-topic={p.topic} data-testid="help-btn" title={name} aria-label={name}
      aria-haspopup="dialog" aria-expanded={!!open && open.topic === p.topic}
      onClick={(e) => { e.stopPropagation(); openHelp(p.topic, e.currentTarget as HTMLElement); }}>?</button>
  );
}

/** The help card: the topic's name, its one sentence and a link to the guide section, next to the button it came from. Closes on Escape or a tap outside.
 *  Mounted once. Also owns F1, which opens the card for what is being worked on: `context()`. */
export function HelpHost(p: { context: () => HelpContext }) {
  const [, tick] = useState(0);
  useEffect(() => subscribeHelp(() => tick((n) => n + 1)), []);
  const ctx = useRef(p.context);
  ctx.current = p.context;

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && helpOpen()) { e.preventDefault(); e.stopImmediatePropagation(); const a = helpOpen()?.anchor; closeHelp(); a?.focus?.(); return; }
      const f1 = e.key === 'F1' && !e.ctrlKey && !e.metaKey && !e.altKey;
      if (!f1) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const topic = currentTopic(ctx.current());
      openHelp(topic, helpAnchorFor(topic));
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, []);

  const o = helpOpen();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!o) return;
    const away = (e: Event) => { const n = e.target as Node; if (!box.current?.contains(n) && !o.anchor?.contains(n)) closeHelp(); };
    document.addEventListener('pointerdown', away, true);
    return () => { document.removeEventListener('pointerdown', away, true); };
  }, [o]);
  // placed beside its button, flipped and clamped to stay inside the window
  useLayoutEffect(() => {
    const el = box.current;
    if (!o || !el) return;
    const a = o.anchor?.getBoundingClientRect() ?? { left: window.innerWidth / 2, right: window.innerWidth / 2, top: 8, bottom: 8 };
    const pos = placeTip(a, el.offsetWidth, el.offsetHeight, window.innerWidth, window.innerHeight, 'bottom');
    el.style.left = pos.x + 'px'; el.style.top = pos.y + 'px'; el.style.visibility = 'visible';
    el.querySelector<HTMLElement>('a')?.focus?.({ preventScroll: true });
  }, [o?.topic, o?.anchor]);
  if (!o) return null;
  const card = helpCard(o.topic);
  return (
    <div ref={box} class="help-card" role="dialog" aria-label={card.name} data-testid="help-card" data-topic={card.topic} style={{ visibility: 'hidden' }}>
      <div class="help-card-head">
        <b class="help-card-title">{card.name}</b>
        <button type="button" class="help-card-x" aria-label={t('help.close')} title={t('help.close')} onClick={() => { const a = o.anchor; closeHelp(); a?.focus?.(); }}>×</button>
      </div>
      <p class="help-card-sum">{card.summary}</p>
      <a class="help-card-link" data-testid="help-link" href={card.url} target="_blank" rel="noopener">{t('help.guide')}</a>
      <span class="help-card-keys">{t('help.more')}</span>
    </div>
  );
}
