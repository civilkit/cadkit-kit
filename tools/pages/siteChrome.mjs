// The CivilKit site chrome (head links, header with the main navigation, footer) shared by every static page of the suite, so a page on
// /cad/, /docs/ or /calcs/ looks like the home page. The one stylesheet is https://civilkit.io/styles.css (the civilkit-site repo owns it,
// including the release-notes components used here); the header and footer markup below is a copy of that site's, and the same copy
// lives in the Calcs repo's tools. Change all of them together (docs/releasing.md, "Site chrome").

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const NAV = [
  ['/calc/', 'Calcs', 'calc'], ['/calcs/learn/', 'Calculators', 'learn'], ['/cad/', 'CAD', 'cad'],
  ['/docs/', 'Guides', 'docs'], ['/whats-new/', "What's new", 'news'], ['https://github.com/internal-org/civilkit-calcs', 'GitHub', 'gh'],
];

/** The <head> links every page needs after its own title, description and canonical. */
export const siteHeadLinks = () => '<meta name="color-scheme" content="light dark">\n<link rel="icon" href="/favicon.ico" sizes="48x48">\n<link rel="icon" type="image/png" href="/assets/favicon.png">\n<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">\n<link rel="stylesheet" href="/styles.css">';

/** Skip link and header. `current` is a NAV key (the page's own entry is marked); `button` is the primary action on the right. */
export function siteHeader(current = '', button = { href: '/cad/', label: 'Open CAD' }) {
  const nav = NAV.map(([h, n, k]) => `<a href="${h}"${k === current ? ' aria-current="page"' : ''}>${esc(n)}</a>`).join('');
  return `<a class="skip" href="#main">Skip to content</a>
<header class="site"><div class="wrap">
<a class="brand" href="/"><img src="/assets/mark-512.png" alt="" width="30" height="30">CivilKit</a>
<nav class="site" aria-label="Main">${nav}</nav>
<a class="btn primary" href="${button.href}">${esc(button.label)}</a>
</div></header>`;
}

export const siteFooter = () => `<footer class="site"><div class="wrap"><span>CivilKit: tools for engineers who calculate and model.</span><a href="/calc/">Calcs</a><a href="https://civilkit.io/calcs/learn/">Calculators</a><a href="/calcs/guide/">Calcs guide</a><a href="/docs/cad/">CAD guide</a><a href="/whats-new/">What's new</a><a href="/cad/">CAD</a><a href="https://civilkit.io/calcs/learn/mathcad-alternative/">Mathcad alternative</a><a href="https://civilkit.io/calcs/learn/mathcad-worksheet-converter/">Open .xmcd and .mcdx files</a><a href="/calcs/embed/">Embed</a><a href="/mcp">AI tools (MCP)</a><a href="https://github.com/internal-org/civilkit-calcs">GitHub</a></div></footer>`;
