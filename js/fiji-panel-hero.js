/* Fiji dashboard: wraps each panel's existing title and description in an
   image header (.tph-hero). Elements are moved, never copied or rewritten,
   so every script that updates a title or hint keeps working. */
(function () {
  'use strict';
  var FLAG = 'img/fiji/flag-fingerprint.webp?v=2';
  var TITLE = '.db-section__label, .db-panel__title, .db-leaderboard__title, .db-items-header > h3';
  var HINT = '.db-section__hint, .db-panel__hint, .db-leaderboard__hint';
  function flag() {
    var i = document.createElement('img');
    i.className = 'tph-flag'; i.src = FLAG; i.alt = ''; i.setAttribute('aria-hidden', 'true');
    return i;
  }
  // Island picture on the right, sized to the header height so the whole
  // island, sunset and sea always show; text is kept clear of its solid part.
  var ro = window.ResizeObserver ? new ResizeObserver(function (es) { es.forEach(function (e) { fit(e.target); }); }) : null;
  function fit(hero) {
    var art = hero.querySelector(':scope > .tph-art'); if (!art) return;
    // The canoe spans from about 17% of the picture to its right edge (2.06 : 1),
    // so text stops just before the sail.
    var pr = Math.round(hero.offsetHeight * 1.71) + 24;
    hero.style.setProperty('padding-right', pr + 'px', hero.tagName === 'SUMMARY' ? 'important' : '');
  }
  function addArt(hero) {
    var a = document.createElement('span'); a.className = 'tph-art'; a.setAttribute('aria-hidden', 'true');
    hero.insertBefore(a, hero.firstChild); fit(hero); if (ro) ro.observe(hero);
  }
  function nextEl(n) { n = n && n.nextElementSibling; return n; }
  function bleed(panel, hero) {
    var cs = getComputedStyle(panel);
    hero.style.margin = '-' + cs.paddingTop + ' -' + cs.paddingRight + ' 16px -' + cs.paddingLeft;
    hero.style.borderRadius = cs.borderTopLeftRadius + ' ' + cs.borderTopRightRadius + ' 0 0';
  }
  function build(panel) {
    if (panel.classList.contains('tph-panel')) return;
    // A3: the <summary> bar itself becomes the header.
    if (panel.tagName === 'DETAILS') {
      var s = panel.querySelector(':scope > summary'); if (!s) return;
      var t = document.createElement('span'); t.className = 'tph-title';
      [].slice.call(s.childNodes).forEach(function (n) { if (!(n.nodeType === 1 && n.classList.contains('db-panel__label'))) t.appendChild(n); });
      var txt = document.createElement('div'); txt.className = 'tph-text'; txt.appendChild(t);
      s.insertBefore(txt, s.firstChild); s.insertBefore(flag(), txt);
      s.classList.add('tph-hero'); panel.classList.add('tph-panel'); bleed(panel, s); s.style.marginBottom = '0'; addArt(s);
      return;
    }
    var title = panel.querySelector(TITLE); if (!title) return;
    var hint = nextEl(title);
    if (!(hint && hint.matches(HINT)) && title.parentElement !== panel) hint = nextEl(title.parentElement);
    if (!(hint && hint.matches(HINT))) hint = null;
    var hero = document.createElement('div'); hero.className = 'tph-hero';
    var text = document.createElement('div'); text.className = 'tph-text';
    hero.appendChild(flag()); hero.appendChild(text);
    var badge = panel.querySelector(':scope > .db-panel__label');
    var oldHead = title.parentElement.matches('header.db-section__head') ? title.parentElement : null;
    if (badge && badge.nextSibling) panel.insertBefore(hero, badge.nextSibling); else panel.insertBefore(hero, panel.firstChild);
    text.appendChild(title); if (hint) text.appendChild(hint);
    if (oldHead && !oldHead.children.length) oldHead.remove();
    panel.classList.add('tph-panel'); bleed(panel, hero); addArt(hero);
    // Controls that other scripts insert next to the title or hint (for
    // example the B3 "Study pathways / University positions" toggle) belong
    // under the header, not inside it.
    var keep = [title, hint];
    var evict = function () {
      var after = hero;
      [].slice.call(text.children).forEach(function (c) {
        if (keep.indexOf(c) === -1 && !c.classList.contains('tph-art')) { after.parentNode.insertBefore(c, after.nextSibling); after = c; }
      });
    };
    evict();
    new MutationObserver(evict).observe(text, { childList: true });
  }
  function run() {
    var sel = '.db-panel[data-panel], .has-panel-badge';
    document.querySelectorAll(sel).forEach(function (p) {
      if (p.parentElement && p.parentElement.closest(sel)) return; // top-level panels only
      if (!p.querySelector(':scope > .db-panel__label, :scope > summary > .db-panel__label')) return;
      build(p);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
