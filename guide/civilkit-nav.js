// The suite navigation in the guide's menu bar: CivilKit, Calcs, Calculators, CAD, Guides, What's new. Keep the links in step with the site header
// (tools/pages/siteChrome.mjs, docs/releasing.md "Site chrome").
(function () {
  var NAV = [['/calc/', 'Calcs'], ['/calcs/learn/', 'Calculators'], ['/cad/', 'CAD'], ['/docs/', 'Guides'], ['/whats-new/', "What's new"]];
  function add() {
    var title = document.querySelector('#mdbook-menu-bar .menu-title, #menu-bar .menu-title');
    if (!title || document.querySelector('.ck-nav')) return;
    var nav = document.createElement('nav');
    nav.className = 'ck-nav';
    nav.setAttribute('aria-label', 'CivilKit');
    nav.innerHTML = '<a class="ck-brand" href="/">CivilKit</a>' + NAV.map(function (n) { return '<a href="' + n[0] + '"' + (n[0] === '/docs/' ? ' aria-current="page"' : '') + '>' + n[1] + '</a>'; }).join('');
    title.parentNode.insertBefore(nav, title);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
})();
