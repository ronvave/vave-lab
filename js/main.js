/* =============================================
   VAVE LAB — Main JavaScript
   ============================================= */

// ── Theme toggle ──────────────────────────────
(function () {
  const html = document.documentElement;
  let theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  html.setAttribute('data-theme', theme);

  function updateToggle(btn) {
    if (!btn) return;
    const isDark = theme === 'dark';
    btn.setAttribute('aria-label', `Switch to ${isDark ? 'light' : 'dark'} mode`);
    btn.innerHTML = isDark
      ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`
      : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.querySelector('[data-theme-toggle]');
    updateToggle(btn);
    if (btn) {
      btn.addEventListener('click', () => {
        theme = theme === 'dark' ? 'light' : 'dark';
        html.setAttribute('data-theme', theme);
        updateToggle(btn);
      });
    }
  });
})();

// ── Sticky header scroll shadow ───────────────
document.addEventListener('DOMContentLoaded', () => {
  const header = document.querySelector('.site-header');
  if (!header) return;
  const obs = new IntersectionObserver(
    ([e]) => header.classList.toggle('site-header--scrolled', !e.isIntersecting),
    { threshold: 1, rootMargin: '-1px 0px 0px 0px' }
  );
  const sentinel = document.createElement('div');
  sentinel.style.cssText = 'position:absolute;top:0;left:0;height:1px;width:1px;pointer-events:none';
  document.body.prepend(sentinel);
  obs.observe(sentinel);

  // ── Mobile menu ────────────────────────────
  const hamburger = document.querySelector('.nav-hamburger');
  const mobileMenu = document.querySelector('.mobile-menu');
  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', () => {
      const open = mobileMenu.classList.toggle('open');
      hamburger.setAttribute('aria-expanded', open);
    });
  }

  // ── Active nav link ────────────────────────
  const links = document.querySelectorAll('.nav-links a, .mobile-menu a');
  const current = location.pathname.split('/').pop() || 'index.html';
  links.forEach(link => {
    const href = link.getAttribute('href');
    if (href === current || (current === 'index.html' && href === 'index.html')) {
      link.classList.add('active');
    }
  });

  // ── Scroll-reveal animation ────────────────
  if ('IntersectionObserver' in window) {
    const revealObs = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('revealed');
          revealObs.unobserve(e.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

    document.querySelectorAll('.reveal').forEach(el => revealObs.observe(el));
  }
});

// ── iTaukei scholar-card share / direct-profile mode ──────────
(function () {
  'use strict';

  const MASTER_PAGE = 'itaukei-research-database-master.html';
  if (!location.pathname.endsWith('/' + MASTER_PAGE) && !location.pathname.endsWith(MASTER_PAGE)) return;

  const SHARE_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>';

  function addStyles() {
    if (document.getElementById('scholar-share-style')) return;
    const style = document.createElement('style');
    style.id = 'scholar-share-style';
    style.textContent = `
      .db-scholar-card__share {
        margin-top: 6px !important;
        background: #b72d4f !important;
        border-color: #b72d4f !important;
        color: #fff !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 6px !important;
        text-align: center !important;
        box-sizing: border-box !important;
      }
      .db-scholar-card__share:hover { background:#9f2342 !important; border-color:#9f2342 !important; }
      .db-scholar-card__share svg { flex:0 0 auto; }
      .scholar-direct-main {
        width: min(680px, calc(100% - 28px));
        margin: 28px auto 56px;
      }
      .scholar-direct-main .db-scholar-card { width:100%; max-width:none; }
      body.scholar-direct-mode .nav-links,
      body.scholar-direct-mode .mobile-menu,
      body.scholar-direct-mode .nav-hamburger,
      body.scholar-direct-mode .site-footer { display:none !important; }
      body.scholar-direct-mode .site-header { position:static !important; }
      body.scholar-direct-mode .scholar-direct-note {
        font-family: "DM Sans", sans-serif;
        font-size: .88rem;
        color: #6b7280;
        margin: 0 0 12px;
        text-align: center;
      }
    `;
    document.head.appendChild(style);
  }

  function normalizeText(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function getState() {
    return window.__vavelabDbState || null;
  }

  function profileForId(id) {
    const st = getState();
    const map = st && st.scholarProfilesByName;
    if (!map || typeof map.forEach !== 'function') return null;
    let found = null;
    map.forEach((p, key) => {
      if (found || !p) return;
      if (String(p.scholarId || '').toUpperCase() === String(id || '').toUpperCase()) {
        found = { key, profile: p };
      }
    });
    return found;
  }

  function idForCard(card) {
    if (!card) return '';
    const photo = card.querySelector('.db-scholar-card__photo');
    if (photo) {
      const bg = photo.style.backgroundImage || getComputedStyle(photo).backgroundImage || '';
      const m = bg.match(/ITK-S\d+/i);
      if (m) return m[0].toUpperCase();
    }
    const st = getState();
    const map = st && st.scholarProfilesByName;
    if (!map || typeof map.forEach !== 'function') return '';
    const cardName = normalizeText(card.querySelector('.db-scholar-card__name')?.textContent || '');
    let found = '';
    map.forEach(p => {
      if (found || !p || !p.scholarId) return;
      const display = [p.salutation || '', p.first || '', p.last || ''].join(' ');
      if (normalizeText(display) === cardName || normalizeText([p.first || '', p.last || ''].join(' ')) === cardName) {
        found = String(p.scholarId).toUpperCase();
      }
    });
    return found;
  }

  function shortUrlFor(id) {
    const base = location.origin + location.pathname.replace(/itaukei-research-database-master\.html$/i, 's.html');
    return base + '?i=' + encodeURIComponent(id);
  }

  function syncShareSize(updateBtn, shareBtn) {
    if (!updateBtn || !shareBtn) return;
    const apply = () => {
      const w = updateBtn.getBoundingClientRect().width;
      const h = updateBtn.getBoundingClientRect().height;
      if (w) shareBtn.style.width = w + 'px';
      if (h) shareBtn.style.minHeight = h + 'px';
    };
    apply();
    if ('ResizeObserver' in window) {
      const ro = new ResizeObserver(apply);
      ro.observe(updateBtn);
    } else {
      window.addEventListener('resize', apply, { passive: true });
    }
  }

  async function shareScholar(id, card, button) {
    const url = shortUrlFor(id);
    const name = card?.querySelector('.db-scholar-card__name')?.textContent?.trim() || 'iTaukei scholar';
    const data = { title: name + ' — iTaukei Scholar', text: 'View and update this iTaukei scholar profile.', url };
    try {
      if (navigator.share) {
        await navigator.share(data);
        return;
      }
      await navigator.clipboard.writeText(url);
      const old = button.innerHTML;
      button.innerHTML = SHARE_ICON + '<span>Copied</span>';
      setTimeout(() => { button.innerHTML = old; }, 1600);
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      try {
        await navigator.clipboard.writeText(url);
        const old = button.innerHTML;
        button.innerHTML = SHARE_ICON + '<span>Copied</span>';
        setTimeout(() => { button.innerHTML = old; }, 1600);
      } catch (_) {
        window.prompt('Copy this scholar link:', url);
      }
    }
  }

  function ensureShareButton(card) {
    if (!card || card.querySelector('[data-scholar-share]')) return;
    const updateBtn = card.querySelector('[data-submit-info]');
    if (!updateBtn) return;
    const id = idForCard(card);
    if (!id) return;
    const share = document.createElement('button');
    share.type = 'button';
    share.className = 'db-scholar-card__submit db-scholar-card__share';
    share.setAttribute('data-scholar-share', id);
    share.setAttribute('title', 'Share a private direct link to this scholar profile');
    share.setAttribute('aria-label', 'Share direct link to this scholar profile');
    share.innerHTML = SHARE_ICON + '<span>Share</span>';
    share.addEventListener('click', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      shareScholar(id, card, share);
    });
    updateBtn.insertAdjacentElement('afterend', share);
    syncShareSize(updateBtn, share);
  }

  function scanCards() {
    document.querySelectorAll('.db-scholar-card').forEach(ensureShareButton);
  }

  function findCardForId(id) {
    const cards = Array.from(document.querySelectorAll('.db-scholar-card'));
    return cards.find(c => idForCard(c) === String(id).toUpperCase()) || null;
  }

  function requestTargetCard(id) {
    const found = profileForId(id);
    if (!found) return false;
    const input = document.querySelector('[data-scholar-name-search]');
    if (!input) return false;
    const p = found.profile || {};
    const q = [p.first || '', p.last || ''].join(' ').trim() || found.key || '';
    if (!q) return false;
    if (input.value !== q) {
      input.value = q;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return true;
  }

  function enterDirectMode(card, id) {
    if (!card || document.querySelector('.scholar-direct-main')) return;
    document.body.classList.add('scholar-direct-mode');

    Array.from(document.querySelectorAll('main')).forEach(m => { m.style.display = 'none'; });

    const main = document.createElement('main');
    main.className = 'scholar-direct-main';
    main.setAttribute('data-direct-scholar', id);
    const note = document.createElement('p');
    note.className = 'scholar-direct-note';
    note.textContent = 'Scholar profile — use “Update info” to submit corrections, missing locality details, a CV, or publications for review.';
    main.appendChild(note);
    main.appendChild(card);

    const footer = document.querySelector('.site-footer');
    if (footer) footer.insertAdjacentElement('beforebegin', main);
    else document.body.appendChild(main);

    // In direct-profile mode the card itself must not expose/filter the rest
    // of the unpublished dashboard. External links, Update info and Share stay live.
    card.addEventListener('click', ev => {
      if (ev.target.closest('a, button, input, select, textarea, label')) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
    }, true);

    ensureShareButton(card);
    document.title = (card.querySelector('.db-scholar-card__name')?.textContent?.trim() || 'iTaukei Scholar') + ' — iTaukei Scholar Profile';
  }

  function init() {
    addStyles();
    scanCards();

    const grid = document.querySelector('[data-db-leaders]');
    if (grid) {
      const obs = new MutationObserver(() => {
        scanCards();
        const directId = new URLSearchParams(location.search).get('p');
        if (directId) {
          const card = findCardForId(directId);
          if (card) enterDirectMode(card, directId);
        }
      });
      obs.observe(grid, { childList: true, subtree: true });
    }

    const directId = new URLSearchParams(location.search).get('p');
    if (!directId) return;

    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      requestTargetCard(directId);
      const card = findCardForId(directId);
      if (card) {
        clearInterval(timer);
        enterDirectMode(card, directId);
      } else if (attempts > 160) {
        clearInterval(timer);
      }
    }, 125);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
