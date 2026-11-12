// The two small links the published site adds at the bottom of index.html (Licences, and Documentation on the /cad/ site). They float only until the
// app has drawn itself: a floating link prints over the status bar (desktop) or the bottom bar (phone, tablet), so a rule hides them in every layout
// and the app shows them itself, in its status bar on a desktop and in its more menu on a phone or a tablet.
// build_pages.mjs injects these; tools/ux/mobile.mjs injects the same strings to check the layout.
export const HIDE_LINKS = 'body:has(#app[data-layout="phone"]) .site-link,body:has(#app[data-layout="tablet"]) .site-link,body:has(#app[data-layout="desktop"]) .site-link{display:none}';
const base = (id, left) => `#${id}{position:fixed;left:${left}%;bottom:4px;z-index:1;font:10px/1.4 system-ui,sans-serif;color:inherit;opacity:.45;text-decoration:none}#${id}:hover{opacity:1;text-decoration:underline}`;

export const licencesLink = () => `<a id="licences-link" class="site-link" href="licenses.html">Licences</a><style>${base('licences-link', 62)}${HIDE_LINKS}</style>`;
export const docsLink = () => `<a id="docs-link" class="site-link" href="/docs/cad/">Documentation</a><style>${base('docs-link', 70)}</style>`;
