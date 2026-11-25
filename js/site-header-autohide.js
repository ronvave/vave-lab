/* Country dashboards: fold the Vave Lab site header away while presenting.
   The header shows when the page first opens (scroll position at the top).
   It slides up out of view as soon as the viewer scrolls down or uses the
   dashboard panel menu, and slides back only when the page returns to the
   top (for example with the "Top" pill). The panel menu then sits at the
   very top of the window. Profile/share views (no panel menu) are untouched. */
(function () {
  'use strict';
  if (window.self !== window.top) return;
  var TOP_ZONE = 8; // px from the top of the page where the header is shown
  var css = '.site-header{transition:transform .28s ease,box-shadow .2s ease!important;will-change:transform}' +
    '.site-header.site-header--tucked{transform:translateY(-100%);box-shadow:none!important;pointer-events:none}' +
    '@media (prefers-reduced-motion: reduce){.site-header{transition:none!important}}';

  function start() {
    var header = document.querySelector('.site-header');
    var nav = document.querySelector('.db-panel-menu');
    if (!header) return;
    if (!nav) { // the panel menu is built by a deferred script; wait briefly
      var tries = 0, t = setInterval(function () {
        nav = document.querySelector('.db-panel-menu');
        if (nav || ++tries > 50) { clearInterval(t); if (nav) init(header, nav); }
      }, 100);
      return;
    }
    init(header, nav);
  }

  function init(header, nav) {
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    var tucked = false, raf = 0, until = 0;

    // Keep the floating panel menu glued to the header's bottom edge while
    // the header slides, then let the menu script re-measure once.
    function follow() {
      nav.style.top = Math.max(0, header.getBoundingClientRect().bottom) + 'px';
      if (performance.now() < until) raf = requestAnimationFrame(follow);
      else { raf = 0; window.dispatchEvent(new Event('resize')); }
    }
    function set(hide) {
      if (hide === tucked) return;
      tucked = hide;
      header.classList.toggle('site-header--tucked', hide);
      if (hide) {
        var a = document.activeElement;
        if (a && header.contains(a)) a.blur();
      }
      until = performance.now() + 340;
      if (!raf) raf = requestAnimationFrame(follow);
    }
    function onScroll() { if (window.scrollY > TOP_ZONE) set(true); else set(false); }

    window.addEventListener('scroll', onScroll, { passive: true });
    // Any click on the panel menu (except "Top") folds the header away first,
    // so panel jumps land directly beneath the menu.
    nav.addEventListener('click', function (e) {
      if (e.target.closest('.db-panel-menu__pill--top')) {
        if (window.scrollY <= TOP_ZONE) set(false); // already at the top
        return;
      }
      if (e.target.closest('a, button')) set(true);
    }, true);
    // Keyboard users tabbing into the header bring it back into view.
    header.addEventListener('focusin', function () { set(false); });
    onScroll();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
