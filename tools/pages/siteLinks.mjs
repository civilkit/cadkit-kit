// The two small links the published site adds at the bottom of index.html (Licences, and Documentation on the /cad/ site). On a phone or a tablet
// the bottom bar is there and a floating link would print over it, so a rule hides them in those layouts and the app lists them in its more menu.
// build_pages.mjs injects these; tools/ux/mobile.mjs injects the same strings to check the layout.
export const HIDE_LINKS = 'body:has(#app[data-layout="phone"]) .site-link,body:has(#app[data-layout="tablet"]) .site-link{display:none}';
const base = (id, left) => `#${id}{position:fixed;left:${left}%;bottom:4px;z-index:1;font:10px/1.4 system-ui,sans-serif;color:inherit;opacity:.45;text-decoration:none}#${id}:hover{opacity:1;text-decoration:underline}`;

export const licencesLink = () => `<a id="licences-link" class="site-link" href="licenses.html">Licences</a><style>${base('licences-link', 62)}${HIDE_LINKS}</style>`;
export const docsLink = () => `<a id="docs-link" class="site-link" href="/docs/cad/">Documentation</a><style>${base('docs-link', 70)}</style>`;
