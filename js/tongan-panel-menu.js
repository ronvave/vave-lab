/* Tonga dashboard floating panel navigation. Mirrors the Fiji approved warm-sand navigator. */
(function () {
  'use strict';
  if (window.self !== window.top || new URLSearchParams(location.search).has('p') || new URLSearchParams(location.search).has('share')) return;
  const groups = {
    A: [['A1','Database overview'],['A2','Tongan scholarship'],['A3','About & methodology']],
    B: [['B1','Research across Tonga'],['B2','Where scholars studied'],['B3','Master’s–PhD pathways'],['B4','Graduate research disciplines'],['B5','Research around the world']],
    C: [['C1','Publications by gender'],['C2','Research by study district'],['C3','Research by scholar’s home district']],
    D: [['D','Publications over time']], E: [['E','Rankings by islands']],
    F: [['F','Scholar profiles']], G: [['G','Browse publications']]
  };
  const targets = new Map();
  document.querySelectorAll('.db-panel__label').forEach(label => {
    const code = label.textContent.trim();
    if (!Object.values(groups).flat().some(row => row[0] === code)) return;
    const panel = label.closest('.has-panel-badge, .db-panel');
    if (!panel) return;
    if (!panel.id) panel.id = 'panel-nav-' + code.toLowerCase();
    panel.classList.add('panel-menu-target'); targets.set(code, panel);
  });
  const navStyle = document.createElement('style');
  navStyle.textContent = '.site-header { z-index: 6000 !important; background: var(--color-bg) !important; } .db-panel-menu { z-index: 5000 !important; background: rgba(255, 241, 223, .97) !important; border-top: 1px solid rgba(236, 210, 173, .55); border-bottom: 1px solid rgba(236, 210, 173, .9); box-shadow: 0 5px 16px rgba(89, 64, 34, .11); } [data-theme="dark"] .db-panel-menu { background: rgba(65, 49, 37, .97) !important; border-color: rgba(236, 210, 173, .27); }';
  document.head.appendChild(navStyle);
  const nav = document.createElement('nav');
  nav.className = 'db-panel-menu'; nav.setAttribute('aria-label','Dashboard panels'); nav.hidden = false;
  const strip = document.createElement('div'); strip.className = 'db-panel-menu__pills'; nav.appendChild(strip);
  const dropdown = document.createElement('div'); dropdown.className = 'db-panel-menu__dropdown'; dropdown.id = 'dashboard-panel-dropdown'; dropdown.hidden = true; nav.appendChild(dropdown);
  let opened = null, current = '', scheduled = false;
  const pills = new Map();
  function close(restore) {
    if (opened) { opened.setAttribute('aria-expanded','false'); if (restore) opened.focus(); }
    dropdown.hidden = true; opened = null;
  }
  function jump(event, code) {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); close(false);
    const panel = targets.get(code); if (!panel) return;
    if (panel.tagName === 'DETAILS') panel.open = true;
    panel.setAttribute('tabindex','-1'); panel.focus({preventScroll:true});
    const header = document.querySelector('.site-header');
    const offset = Math.max(0, header ? header.getBoundingClientRect().bottom : 0) + nav.getBoundingClientRect().height + 16;
    window.scrollTo({top:Math.max(0,window.scrollY + panel.getBoundingClientRect().top - offset),behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
    // Do not replace location.hash: it stores B2's independent filter state.
  }
  function link(code, text) {
    const a = document.createElement('a'); a.href = '#' + targets.get(code).id; a.textContent = text; a.dataset.panelDestination = code;
    a.addEventListener('click', e => jump(e,code)); return a;
  }
  function positionDropdown() {
    if (!opened) return;
    const box = opened.getBoundingClientRect();
    const bar = nav.getBoundingClientRect();
    const width = Math.min(340,window.innerWidth - 24);
    const viewportLeft = Math.max(12,Math.min(box.left,window.innerWidth-width-12));
    const viewportTop = box.bottom + 4;
    // The blurred fixed bar establishes a containing block. Position the
    // dropdown relative to that bar, not in viewport coordinates a second time.
    dropdown.style.width = width + 'px';
    dropdown.style.left = (viewportLeft - bar.left) + 'px';
    dropdown.style.top = (viewportTop - bar.top) + 'px';
    dropdown.style.maxHeight = Math.max(100,window.innerHeight-viewportTop-12) + 'px';
  }
  Object.entries(groups).forEach(([group, entries]) => {
    entries = entries.filter(([code]) => targets.has(code)); if (!entries.length) return;
    let pill;
    if (entries.length === 1) {
      pill = link(entries[0][0], ({D:'Timeline',E:'Islands',F:'Profiles',G:'Publications'})[group] || 'Panel ' + group); pill.title = entries[0][1];
      pill.setAttribute('aria-label','Panel ' + group + ': ' + entries[0][1]);
    } else {
      pill = document.createElement('button'); pill.type = 'button'; pill.textContent = 'Panel ' + group + ' ▾';
      pill.setAttribute('aria-expanded','false'); pill.setAttribute('aria-controls',dropdown.id);
      pill.addEventListener('click', () => {
        if (opened === pill) { close(false); return; }
        close(false); opened = pill; pill.setAttribute('aria-expanded','true'); dropdown.replaceChildren();
        entries.forEach(([code,title]) => { const a=link(code,code+': '+title); if(code===current) a.setAttribute('aria-current','location'); dropdown.appendChild(a); });
        dropdown.hidden = false; positionDropdown();
      });
      pill.addEventListener('keydown', e => { if(e.key === 'ArrowDown') { e.preventDefault(); if(opened!==pill) pill.click(); dropdown.querySelector('a')?.focus(); } });
    }
    pill.className = 'db-panel-menu__pill'; strip.appendChild(pill); pills.set(group,pill);
  });
  document.body.appendChild(nav);
  function update() {
    scheduled = false;
    const header = document.querySelector('.site-header');
    const top = Math.max(0,header ? header.getBoundingClientRect().bottom : 0);
    nav.style.top = top + 'px';
    // Keep the dashboard navigator mounted from the beginning of the page.
    // This avoids any viewport-height/scroll-event threshold: it is already
    // available when the first downward scroll begins.
    nav.hidden = false;
    const edge = top + nav.getBoundingClientRect().height + 24;
    let active = targets.keys().next().value;
    targets.forEach((panel,code) => { if(panel.getBoundingClientRect().top <= edge) active=code; });
    current = active;
    pills.forEach((pill,group) => { pill.classList.toggle('is-current',active && active[0]===group); if(active && active[0]===group) pill.setAttribute('aria-current','location'); else pill.removeAttribute('aria-current'); });
    dropdown.querySelectorAll('a').forEach(a=> {if(a.dataset.panelDestination===active) a.setAttribute('aria-current','location'); else a.removeAttribute('aria-current');});
    positionDropdown();
  }
  function schedule() { if(!scheduled) {scheduled=true; requestAnimationFrame(update);} }
  window.addEventListener('scroll',schedule,{passive:true}); window.addEventListener('resize',schedule);
  window.addEventListener('vavelab:master-hydrated',schedule);
  strip.addEventListener('scroll',positionDropdown,{passive:true});
  document.addEventListener('click',e=>{if(!nav.contains(e.target)) close(false);});
  document.addEventListener('keydown',e=>{if(e.key==='Escape' && opened){e.preventDefault();e.stopPropagation();close(true);}},true);
  nav.addEventListener('focusout',()=>setTimeout(()=>{if(!nav.contains(document.activeElement))close(false);},0));
  if(window.ResizeObserver) new ResizeObserver(schedule).observe(document.querySelector('.site-header') || document.body);
  update();
})();
