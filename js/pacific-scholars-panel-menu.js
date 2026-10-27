/* Panel menu for the Regional Pacific Scholars Dashboard.
   Same idea as the country dashboards' panel menu (js/itaukei-panel-menu.js):
   every panel carries a code badge (A1, A2 … F) and the bar under the
   headline figures jumps to any panel. Panels that are still hidden (no data
   for them yet) are left out of the menu until they appear. */
(function () {
  'use strict';
  const nav = document.getElementById('ps-pmenu');
  if (!nav) return;
  const strip = document.getElementById('ps-pmenu-pills');
  const drop = document.getElementById('ps-pmenu-drop');
  const GROUPS = {
    A: 'Overview', B: 'Firsts & university careers', C: 'People & pathways',
    D: 'Directory', E: 'Publications', F: 'Collaborators'
  };
  const panels = [...document.querySelectorAll('section[data-panel]')];
  const groupOf = el => el.dataset.panel[0];
  const visible = el => !el.hidden && el.offsetParent !== null;
  const pills = new Map();
  let opened = null, current = '', scheduled = false, lastJump = '';

  panels.forEach(el => { if (!el.id) el.id = 'panel-' + el.dataset.panel.toLowerCase(); });

  function close(restore) {
    if (opened) { opened.setAttribute('aria-expanded', 'false'); if (restore) opened.focus(); }
    drop.hidden = true; opened = null;
  }
  function jump(e, el) {
    if (e && (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) return;
    if (e) e.preventDefault();
    close(false);
    lastJump = el.dataset.panel;
    const top = window.scrollY + el.getBoundingClientRect().top - nav.getBoundingClientRect().height - 14;
    window.scrollTo({ top: Math.max(0, top), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    el.setAttribute('tabindex', '-1'); el.focus({ preventScroll: true });
  }
  function link(el, text) {
    const a = document.createElement('a');
    a.href = '#' + el.id; a.textContent = text; a.dataset.code = el.dataset.panel;
    a.addEventListener('click', e => jump(e, el));
    return a;
  }
  function position() {
    if (!opened) return;
    const b = opened.getBoundingClientRect(), bar = nav.getBoundingClientRect();
    const w = Math.min(360, innerWidth - 24);
    drop.style.width = w + 'px';
    drop.style.left = (Math.max(12, Math.min(b.left, innerWidth - w - 12)) - bar.left) + 'px';
    drop.style.top = (b.bottom + 6 - bar.top) + 'px';
    drop.style.maxHeight = Math.max(120, innerHeight - b.bottom - 18) + 'px';
  }

  // "Top" goes back to the top of the page (before Panel A).
  const top = document.createElement('a');
  top.href = '#'; top.className = 'ps-pmenu__pill ps-pmenu__pill--top'; top.textContent = '\u2191 Top';
  top.setAttribute('aria-label', 'Back to the top of the page');
  top.addEventListener('click', e => {
    if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault(); close(false); lastJump = '';
    window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });
  strip.appendChild(top);

  Object.keys(GROUPS).forEach(g => {
    const members = panels.filter(el => groupOf(el) === g);
    if (!members.length) return;
    let pill;
    if (members.length === 1) {
      pill = link(members[0], GROUPS[g]);
      pill.title = members[0].dataset.panel + ': ' + members[0].dataset.panelTitle;
      pill.setAttribute('aria-label', 'Panel ' + members[0].dataset.panel + ': ' + members[0].dataset.panelTitle);
    } else {
      pill = document.createElement('button');
      pill.type = 'button';
      pill.innerHTML = 'Panel ' + g + ' <span aria-hidden="true">\u25be</span>';
      pill.title = GROUPS[g];
      pill.setAttribute('aria-expanded', 'false');
      pill.setAttribute('aria-controls', drop.id);
      pill.addEventListener('click', () => {
        if (opened === pill) { close(false); return; }
        close(false); opened = pill; pill.setAttribute('aria-expanded', 'true');
        drop.replaceChildren();
        const head = document.createElement('div'); head.className = 'ps-pmenu__head'; head.textContent = 'Panel ' + g + ' \u00b7 ' + GROUPS[g];
        drop.appendChild(head);
        members.filter(visible).forEach(el => {
          const a = link(el, el.dataset.panel + ': ' + el.dataset.panelTitle);
          if (el.dataset.panel === current) a.setAttribute('aria-current', 'location');
          drop.appendChild(a);
        });
        drop.hidden = false; position();
      });
      pill.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown') { e.preventDefault(); if (opened !== pill) pill.click(); const a = drop.querySelector('a'); a && a.focus(); }
      });
    }
    pill.className = 'ps-pmenu__pill';
    pill.dataset.group = g;
    strip.appendChild(pill); pills.set(g, { pill, members });
  });

  drop.addEventListener('keydown', e => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...drop.querySelectorAll('a')], i = items.indexOf(document.activeElement);
    const nx = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]; nx && nx.focus();
  });

  function update() {
    scheduled = false;
    // Hide a pill whose panels are all hidden (data not available yet).
    pills.forEach(({ pill, members }) => { pill.hidden = !members.some(visible); });
    const edge = nav.getBoundingClientRect().bottom + 30;
    // Current panel = the passed panel nearest the bar; panels side by side
    // tie, and the one last jumped to wins the tie.
    let active = '', best = -Infinity;
    panels.forEach(el => {
      if (!visible(el)) return;
      const t = el.getBoundingClientRect().top;
      if (t > edge) return;
      if (t > best + 4 || (Math.abs(t - best) <= 4 && el.dataset.panel === lastJump)) { best = Math.max(t, best); active = el.dataset.panel; }
    });
    current = active;
    pills.forEach(({ pill }, g) => {
      const on = !!active && active[0] === g;
      pill.classList.toggle('is-current', on);
      if (on) pill.setAttribute('aria-current', 'location'); else pill.removeAttribute('aria-current');
    });
    drop.querySelectorAll('a').forEach(a => { if (a.dataset.code === active) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current'); });
    nav.classList.toggle('is-stuck', nav.getBoundingClientRect().top <= 0.5);
    position();
  }
  function schedule() { if (!scheduled) { scheduled = true; requestAnimationFrame(update); } }
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule);
  strip.addEventListener('scroll', position, { passive: true });
  document.addEventListener('click', e => { if (!nav.contains(e.target)) close(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && opened) { e.preventDefault(); close(true); } }, true);
  nav.addEventListener('focusout', () => setTimeout(() => { if (!nav.contains(document.activeElement)) close(false); }, 0));
  // Panels un-hide after the passcode unlocks the data.
  new MutationObserver(schedule).observe(document.getElementById('ps-main') || document.body, { attributes: true, attributeFilter: ['hidden'], subtree: true });
  update();
})();
