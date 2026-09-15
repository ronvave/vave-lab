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

// Research page: replace only the transdisciplinary overview illustration.
(() => {
  const replacementPath = 'img/research/vave-interdisciplinary-research.jpg';
  const targetAlt = 'Watercolour illustration summarising Vave Lab research themes across the Pacific';

  function swapResearchIllustration() {
    if (!/(^|\/)research\.html$/.test(window.location.pathname)) return;
    const illustration = Array.from(document.images).find((image) => image.alt === targetAlt);
    if (illustration && illustration.getAttribute('src') !== replacementPath) {
      illustration.src = replacementPath;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', swapResearchIllustration, { once: true });
  } else {
    swapResearchIllustration();
  }
})();

// ── Sticky header / navigation ────────────────────────────────
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

  const hamburger = document.querySelector('.nav-hamburger');
  const mobileMenu = document.querySelector('.mobile-menu');
  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', () => {
      const open = mobileMenu.classList.toggle('open');
      hamburger.setAttribute('aria-expanded', open);
    });
  }

  const links = document.querySelectorAll('.nav-links a, .mobile-menu a');
  const current = location.pathname.split('/').pop() || 'index.html';
  links.forEach(link => {
    const href = link.getAttribute('href');
    if (href === current || (current === 'index.html' && href === 'index.html')) link.classList.add('active');
  });

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

  const CAP_SID_KEY  = 'vavelab_share_cap_sid';
  const CAP_HASH_KEY = 'vavelab_share_cap_hash';
  const SHARE_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>';

  const publicShareMap = Object.create(null);
  let shareMapReady = false;
  const shareMapPromise = Promise.all([0,1,2,3,4].map(i =>
    fetch('data/share-public/' + i + '.json', { cache: 'no-store', credentials: 'same-origin' })
      .then(r => { if (!r.ok) throw new Error('share permalink index unavailable'); return r.json(); })
  )).then(parts => {
    parts.forEach(doc => Object.assign(publicShareMap, (doc && doc.m) || {}));
    shareMapReady = true;
    document.querySelectorAll('[data-scholar-share]').forEach(btn => {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      btn.setAttribute('title', 'Share this scholar profile');
    });
  }).catch(err => console.error('Scholar permalink index failed to load', err));

  // Public update forms use the same opaque per-scholar capability token as
  // direct profile links. Expose a deliberately tiny read-only bridge so the
  // dashboard submission module can authenticate a queued Admin V2 update
  // without duplicating or weakening the share-token implementation.
  window.VaveLabScholarShare = {
    ready: () => shareMapPromise,
    tokenFor: id => publicShareMap[String(id || '').toUpperCase()] || '',
    directScholarId: () => directCapabilityId()
  };

  function addStyles() {
    if (document.getElementById('scholar-share-style')) return;
    const style = document.createElement('style');
    style.id = 'scholar-share-style';
    style.textContent = `
      .db-scholar-card__share {
        margin-top:6px!important;background:#b72d4f!important;border-color:#b72d4f!important;color:#fff!important;
        display:flex!important;align-items:center!important;justify-content:center!important;gap:6px!important;text-align:center!important;box-sizing:border-box!important;
      }
      .db-scholar-card__share:hover{background:#9f2342!important;border-color:#9f2342!important}.db-scholar-card__share:disabled{opacity:.62;cursor:wait}.db-scholar-card__share svg{flex:0 0 auto}
      .scholar-direct-main{width:min(1080px,calc(100% - 28px));margin:24px auto 56px}.scholar-direct-main .db-scholar-card{width:min(680px,100%);max-width:none;margin:0 auto}
      body.scholar-direct-mode .nav-links,body.scholar-direct-mode .mobile-menu,body.scholar-direct-mode .nav-hamburger,body.scholar-direct-mode .site-footer{display:none!important}
      body.scholar-direct-mode .site-header{position:static!important}
      .scholar-direct-intro{max-width:980px;margin:0 auto 22px;padding:18px 20px;border:1px solid rgba(14,116,144,.20);border-radius:14px;background:rgba(14,116,144,.055);font-family:"DM Sans",sans-serif;color:#374151;line-height:1.58;font-size:.94rem}
      .scholar-direct-intro p{margin:0 0 10px}.scholar-direct-intro p:last-child{margin-bottom:0}.scholar-direct-intro strong{color:#0e5f6b}
      .scholar-direct-prelaunch{display:inline-block;margin-bottom:9px;padding:4px 9px;border-radius:999px;background:#fff3cd;border:1px solid #f2d27b;color:#7a4b00;font-weight:700;font-size:.78rem;letter-spacing:.02em;text-transform:uppercase}
      .scholar-direct-stats{max-width:1020px;margin:0 auto 24px}.scholar-direct-stats__heading{font-family:"DM Sans",sans-serif;font-size:1rem;font-weight:700;color:#163f46;margin:0 0 10px}
      .scholar-direct-stats .db-section{margin:0 0 12px!important;padding:14px 16px!important}.scholar-direct-stats .db-section__head{margin-bottom:9px!important}.scholar-direct-stats .db-section__label{font-size:1.05rem!important}.scholar-direct-stats .db-section__hint{font-size:.78rem!important}
      .scholar-direct-stats .db-kpis{grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:8px!important}.scholar-direct-stats .db-kpi{padding:10px!important;min-height:74px}.scholar-direct-stats .db-kpi__num{font-size:1.25rem!important}.scholar-direct-stats .db-kpi__label{font-size:.67rem!important}.scholar-direct-stats .db-kpi__icon{width:34px!important;height:34px!important}
      .scholar-direct-b2{margin:0 0 12px;padding:14px 16px;background:var(--color-surface,#fff);border:1px solid var(--color-border,#d9dfdf);border-radius:14px}.scholar-direct-b2 h3{margin:0 0 4px;font-family:"DM Sans",sans-serif;font-size:1rem;text-transform:uppercase;letter-spacing:.03em}.scholar-direct-b2 p{margin:0 0 10px;color:#6b7280;font-size:.78rem;line-height:1.45}.scholar-direct-b2 .db-kpis{margin-top:0}
      @media(max-width:720px){.scholar-direct-stats .db-kpis{grid-template-columns:repeat(2,minmax(0,1fr))!important}.scholar-direct-main{width:min(100% - 18px,1080px)}.scholar-direct-intro{padding:15px}}
      .scholar-direct-invalid{max-width:680px;margin:72px auto;padding:28px;text-align:center;font-family:"DM Sans",sans-serif;color:#374151}

      /* Update-info enhancements */
      #db-submit-modal .geo-fieldset{border-width:2px!important}.geo-fieldset--paternal{border-color:#0f5c9b!important}.geo-fieldset--maternal{border-color:#222!important}
      #db-submit-modal .geo-grid,#db-submit-modal .degree-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
      #db-submit-modal .geo-grid .full,#db-submit-modal .degree-grid .full{grid-column:1/-1}
      #db-submit-modal .derived-field{background:#f4f1e7!important;color:#6b7280!important}
      #db-submit-modal .upload-note{display:block;margin-top:5px;color:#6b7280;font-size:.78rem;line-height:1.4}
      #db-submit-modal .new-degree-fieldset legend{font-weight:700}.db-file-rename-preview{font-size:.75rem;color:#6b7280;margin-top:4px;display:block}
      @media(max-width:680px){#db-submit-modal .geo-grid,#db-submit-modal .degree-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function normalizeText(s){return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}
  function getState(){return window.__vavelabDbState||null}

  function profileForId(id){
    const st=getState(),map=st&&st.scholarProfilesByName;if(!map||typeof map.forEach!=='function')return null;let found=null;
    map.forEach((p,key)=>{if(!found&&p&&String(p.scholarId||'').toUpperCase()===String(id||'').toUpperCase())found={key,profile:p}});return found;
  }

  function profileForOpenForm(id,form){
    const byId=profileForId(id);if(byId)return byId;
    const st=getState(),map=st&&st.scholarProfilesByName;if(!map||typeof map.get!=='function')return null;
    const name=String(form?.querySelector('#db-sf-scholar-name')?.value||'').trim();
    if(name&&map.has(name))return {key:name,profile:map.get(name)};
    let found=null;map.forEach((p,key)=>{if(!found&&normalizeText(key)===normalizeText(name))found={key,profile:p}});return found;
  }

  function idForCard(card){
    if(!card)return'';const photo=card.querySelector('.db-scholar-card__photo');
    if(photo){const bg=photo.style.backgroundImage||getComputedStyle(photo).backgroundImage||'';const m=bg.match(/ITK-S\d+/i);if(m)return m[0].toUpperCase()}
    const st=getState(),map=st&&st.scholarProfilesByName;if(!map||typeof map.forEach!=='function')return'';
    const cardName=normalizeText(card.querySelector('.db-scholar-card__name')?.textContent||'');let found='';
    map.forEach(p=>{if(found||!p||!p.scholarId)return;const display=[p.salutation||'',p.first||'',p.last||''].join(' ');if(normalizeText(display)===cardName||normalizeText([p.first||'',p.last||''].join(' '))===cardName)found=String(p.scholarId).toUpperCase()});return found;
  }

  function directCapabilityId(){
    const qs=new URLSearchParams(location.search);const requested=String(qs.get('p')||'').toUpperCase();if(!requested||qs.get('share')!=='1')return'';
    const granted=String(sessionStorage.getItem(CAP_SID_KEY)||'').toUpperCase(),capHash=String(sessionStorage.getItem(CAP_HASH_KEY)||'');
    if(!/^[a-f0-9]{32}$/i.test(capHash)||granted!==requested)return'';return requested;
  }

  function secureParentUrlFor(id){
    try{const granted=String(sessionStorage.getItem(CAP_SID_KEY)||'').toUpperCase();if(granted!==String(id||'').toUpperCase())return'';
      if(window.parent&&window.parent!==window&&window.parent.location.origin===location.origin&&/\/s\.html$/i.test(window.parent.location.pathname)){const u=new URL(window.parent.location.href);if(/^[a-f0-9]{40}$/i.test(u.searchParams.get('k')||''))return u.href}}
    catch(_){}return'';
  }

  function publicPermalinkFor(id){const sid=String(id||'').toUpperCase(),token=publicShareMap[sid]||'';if(!/^[a-f0-9]{40}$/i.test(token))return'';const base=location.origin+location.pathname.replace(/itaukei-research-database-master\.html$/i,'s.html');return base+'?k='+encodeURIComponent(token)}

  function syncShareSize(updateBtn,shareBtn){if(!updateBtn||!shareBtn)return;const apply=()=>{const w=updateBtn.getBoundingClientRect().width,h=updateBtn.getBoundingClientRect().height;if(w)shareBtn.style.width=w+'px';if(h)shareBtn.style.minHeight=h+'px'};apply();if('ResizeObserver'in window){const ro=new ResizeObserver(apply);ro.observe(updateBtn)}else window.addEventListener('resize',apply,{passive:true})}
  function flashCopied(button){const old=button.innerHTML;button.innerHTML=SHARE_ICON+'<span>Copied</span>';setTimeout(()=>{button.innerHTML=old},1600)}

  async function shareScholar(id,card,button){
    let url=secureParentUrlFor(id);if(!url){if(!shareMapReady){button.disabled=true;button.setAttribute('aria-busy','true');button.innerHTML=SHARE_ICON+'<span>Preparing…</span>';try{await shareMapPromise}catch(_){}button.disabled=false;button.removeAttribute('aria-busy');button.innerHTML=SHARE_ICON+'<span>Share</span>'}url=publicPermalinkFor(id)}
    if(!url){window.alert('This scholar profile link is temporarily unavailable. Please refresh the page and try again.');return}
    const name=card?.querySelector('.db-scholar-card__name')?.textContent?.trim()||'iTaukei scholar';const data={title:name+' — iTaukei Scholar',text:'View this iTaukei scholar profile.',url};
    try{if(navigator.share){await navigator.share(data);return}await navigator.clipboard.writeText(url);flashCopied(button)}catch(err){if(err&&err.name==='AbortError')return;try{await navigator.clipboard.writeText(url);flashCopied(button)}catch(_){window.prompt('Copy this scholar profile link:',url)}}
  }

  function ensureShareButton(card){
    if(!card||card.querySelector('[data-scholar-share]'))return;const updateBtn=card.querySelector('[data-submit-info]');if(!updateBtn)return;const id=idForCard(card);if(!id)return;
    const share=document.createElement('button');share.type='button';share.className='db-scholar-card__submit db-scholar-card__share';share.setAttribute('data-scholar-share',id);share.setAttribute('title',shareMapReady?'Share this scholar profile':'Preparing scholar profile link');share.setAttribute('aria-label','Share direct link to this scholar profile');share.innerHTML=SHARE_ICON+'<span>Share</span>';
    if(!shareMapReady&&!secureParentUrlFor(id)){share.disabled=true;share.setAttribute('aria-busy','true')}
    share.addEventListener('click',ev=>{ev.preventDefault();ev.stopPropagation();shareScholar(id,card,share)});updateBtn.insertAdjacentElement('afterend',share);syncShareSize(updateBtn,share);
  }

  function scanCards(){document.querySelectorAll('.db-scholar-card').forEach(ensureShareButton)}
  function findCardForId(id){return Array.from(document.querySelectorAll('.db-scholar-card')).find(c=>idForCard(c)===String(id).toUpperCase())||null}

  function requestTargetCard(id){const found=profileForId(id);if(!found)return false;const input=document.querySelector('[data-scholar-name-search]');if(!input)return false;const p=found.profile||{},q=[p.first||'',p.last||''].join(' ').trim()||found.key||'';if(!q)return false;if(input.value!==q){input.value=q;input.dispatchEvent(new Event('input',{bubbles:true}))}return true}

  function buildDirectIntro(){
    const box=document.createElement('section');box.className='scholar-direct-intro';box.innerHTML=`
      <span class="scholar-direct-prelaunch">Pre-launch profile review</span>
      <p><strong>About this database.</strong> The Fiji Scholarly Research Database is an evolving resource highlighting the scholarship and contributions of iTaukei (Indigenous Fijian) scholars in Fiji and around the world. The project is led and curated by <a href="https://ronvave.github.io/vave-lab/" target="_blank" rel="noopener">Dr. Ron Vave</a>, an <em>iTaukei</em> scholar and Assistant Professor at the University of Hawaiʻi at Mānoa, and forms part of a wider regional scholarly database initiative that he is spearheading through UH Mānoa’s Center for Pacific Islands Studies. The initiative is being developed across Pacific Island countries to support the visibility, networking, collaboration and mentorship of Indigenous students and researchers, while making their scholarship more accessible to wider audiences. As an ongoing passion project, the database is not yet comprehensive. <strong>The database and dashboard remain under development and have not yet been publicly launched.</strong></p>
      <p><strong>Why you have been sent this link.</strong> You have been sent a direct link to this scholar profile so the information can be checked and improved. If this is your profile, please use <strong>Update info</strong> to correct or add details. You can provide missing paternal and maternal geography, current professional information, graduate-study details and publication information.</p>
      <p>You can also attach your latest <strong>CV</strong>, upload a <strong>high-resolution JPEG headshot</strong>, and provide either a direct link to or a PDF copy of your Master’s and/or PhD thesis. These materials help us verify information, identify publications or other scholarly outputs we may have missed, and ensure that the public scholar profile reflects your work as accurately as possible. All submissions are reviewed before changes appear.</p>
      <p>After public launch, this permanent profile link can also be shared by the scholar, recruiters, collaborators, students and others who want a direct view of the scholar’s profile.</p>`;return box;
  }

  function makeB2SummaryClone(){
    const panel=document.querySelector('[data-panel="B2"], .db-panel-b2, [data-db-world-panel]');if(!panel)return null;
    const wrap=document.createElement('section');wrap.className='scholar-direct-b2';
    const title=panel.querySelector('.db-panel__title, .db-panel-b2__title, h2');const hint=panel.querySelector('.db-panel__hint, p');const kpis=panel.querySelector('.db-kpis');
    wrap.innerHTML='<h3>'+(title?title.textContent.trim():'iTaukei graduates — global database')+'</h3>'+(hint?'<p>'+hint.textContent.trim()+'</p>':'');if(kpis)wrap.appendChild(kpis.cloneNode(true));return wrap;
  }

  function syncDirectStats(stats){
    if(!stats||!stats.isConnected)return;const a1=document.querySelector('.db-section:not(.db-section--itaukei)'),a2=document.querySelector('.db-section--itaukei');
    const old=stats.querySelector('[data-direct-stats-body]');const body=document.createElement('div');body.setAttribute('data-direct-stats-body','');
    if(a1)body.appendChild(a1.cloneNode(true));if(a2)body.appendChild(a2.cloneNode(true));const b2=makeB2SummaryClone();if(b2)body.appendChild(b2);if(old)old.replaceWith(body);else stats.appendChild(body);
  }

  function buildDirectStats(){const section=document.createElement('section');section.className='scholar-direct-stats';section.innerHTML='<h2 class="scholar-direct-stats__heading">Current database totals</h2><div data-direct-stats-body></div>';syncDirectStats(section);return section}

  function enterDirectMode(card,id){
    if(!card||document.querySelector('.scholar-direct-main'))return;document.body.classList.add('scholar-direct-mode');Array.from(document.querySelectorAll('main')).forEach(m=>{m.style.display='none'});
    const main=document.createElement('main');main.className='scholar-direct-main';main.setAttribute('data-direct-scholar',id);main.appendChild(buildDirectIntro());const stats=buildDirectStats();main.appendChild(stats);main.appendChild(card);
    const footer=document.querySelector('.site-footer');if(footer)footer.insertAdjacentElement('beforebegin',main);else document.body.appendChild(main);
    card.addEventListener('click',ev=>{if(ev.target.closest('a,button,input,select,textarea,label'))return;ev.preventDefault();ev.stopImmediatePropagation()},true);ensureShareButton(card);
    document.title=(card.querySelector('.db-scholar-card__name')?.textContent?.trim()||'iTaukei Scholar')+' — iTaukei Scholar Profile';
    let statTicks=0;const statsTimer=setInterval(()=>{if(!main.isConnected||statTicks++>300){clearInterval(statsTimer);return}syncDirectStats(stats)},2000);
  }

  function showInvalidDirectLink(){document.body.classList.add('scholar-direct-mode');Array.from(document.querySelectorAll('main')).forEach(m=>{m.style.display='none'});const box=document.createElement('main');box.className='scholar-direct-invalid';box.textContent='This scholar link is invalid or has expired.';document.body.appendChild(box)}

  // ── Update-info form enhancements ───────────────────────────
  function fieldWrap(labelText,input,helper){const d=document.createElement('div');const lab=document.createElement('label');lab.textContent=labelText;d.appendChild(lab);d.appendChild(input);if(helper){const s=document.createElement('small');s.className='upload-note';s.textContent=helper;d.appendChild(s)}return d}
  function textInput(name,value){const i=document.createElement('input');i.type='text';i.name=name;i.value=value||'';return i}
  function urlInput(name,value){const i=document.createElement('input');i.type='url';i.name=name;i.value=value||'';i.placeholder='https://…';return i}
  function yearInput(name,value){const i=document.createElement('input');i.type='number';i.name=name;i.min='1900';i.max='2100';i.step='1';i.value=value||'';return i}
  function fileInput(name,accept){const i=document.createElement('input');i.type='file';i.name=name;if(accept)i.accept=accept;return i}
  function selectInput(name,values,value){const s=document.createElement('select');s.name=name;values.forEach(([v,t])=>{const o=document.createElement('option');o.value=v;o.textContent=t;if(String(v)===String(value||''))o.selected=true;s.appendChild(o)});return s}

  function profileFromOpenModal(){const modal=document.getElementById('db-submit-modal');const sid=(modal&&modal.dataset&&modal.dataset.scholarId)||document.querySelector('[data-direct-scholar]')?.getAttribute('data-direct-scholar')||'';return {id:sid,hit:profileForId(sid)}}

  function inferOpenScholarId(){const direct=document.querySelector('[data-direct-scholar]')?.getAttribute('data-direct-scholar');if(direct)return direct;const modal=document.getElementById('db-submit-modal');if(modal?.dataset?.scholarId)return modal.dataset.scholarId;const sub=document.getElementById('db-submit-modal-sub')?.textContent||'';const cards=Array.from(document.querySelectorAll('.db-scholar-card'));const named=cards.find(c=>sub&&normalizeText(sub).includes(normalizeText(c.querySelector('.db-scholar-card__name')?.textContent||'')));return named?idForCard(named):''}

  function clean(v){const s=String(v==null?'':v).trim();return /^(unclassified|unknown|n\/a|na|-)$/i.test(s)?'':s}
  const PROV_CONF={Ba:'Kubuna',Lomaiviti:'Kubuna',Naitasiri:'Kubuna',Ra:'Kubuna',Tailevu:'Kubuna',Kadavu:'Burebasaga','Nadroga/Navosa':'Burebasaga',Namosi:'Burebasaga',Rewa:'Burebasaga',Serua:'Burebasaga',Bua:'Tovata',Cakaudrove:'Tovata',Lau:'Tovata',Macuata:'Tovata'};

  function geoFieldset(which,p){
    const lower=which.toLowerCase(),fs=document.createElement('fieldset');fs.className='geo-fieldset geo-fieldset--'+lower;const lg=document.createElement('legend');lg.textContent=which+' geography';fs.appendChild(lg);const grid=document.createElement('div');grid.className='geo-grid';
    const provVal=clean(p?.[lower+'Province']);const province=selectInput(lower+'_province',[['','(select)'],...Object.keys(PROV_CONF).map(x=>[x,x])],provVal);province.id='db-sf-'+lower+'-province';
    const conf=textInput(lower+'_confederacy',PROV_CONF[provVal]||clean(p?.[lower+'Confederacy']));conf.readOnly=true;conf.className='derived-field';
    province.addEventListener('change',()=>{conf.value=PROV_CONF[province.value]||''});
    grid.appendChild(fieldWrap(which+' Province',province));grid.appendChild(fieldWrap(which+' Confederacy (derived)',conf));grid.appendChild(fieldWrap(which+' District',textInput(lower+'_district',clean(p?.[lower+'District']))));grid.appendChild(fieldWrap(which+' Village',textInput(lower+'_village',clean(p?.[lower+'Village']))));grid.appendChild(fieldWrap(which+' Island',textInput(lower+'_island',clean(p?.[lower+'Island']))));fs.appendChild(grid);return fs;
  }

  function degreeFieldset(stage,p){
    const lower=stage.toLowerCase(),fs=document.createElement('fieldset');fs.className='new-degree-fieldset';const lg=document.createElement('legend');lg.textContent=stage;fs.appendChild(lg);const g=document.createElement('div');g.className='degree-grid';
    const degree=p?.[lower]||{};const uni=degree.university||p?.[lower+'University']||'',country=degree.country||p?.[lower+'Country']||'',year=degree.year||p?.[lower+'Year']||'';
    g.appendChild(fieldWrap(stage+' — University',textInput(lower+'_university',uni)));g.appendChild(fieldWrap(stage+' — Country',textInput(lower+'_country',country)));g.appendChild(fieldWrap(stage+' — Year completed',yearInput(lower+'_year',year)));
    const linkWrap=fieldWrap('Link to '+stage+' thesis / degree',urlInput(lower+'_thesis_url',degree.url||''),'Provide a direct university/repository link where possible.');g.appendChild(linkWrap);
    const pdf=fileInput(lower+'_thesis_pdf','application/pdf,.pdf');g.appendChild(fieldWrap('Upload '+stage+' thesis PDF',pdf,'Optional PDF. The uploaded filename will be standardised using the Scholar ID and scholar name.'));fs.appendChild(g);return fs;
  }

  function renameFileInput(input,suffix,id,personName){
    if(!input||input.dataset.renameWired)return;input.dataset.renameWired='1';input.addEventListener('change',()=>{const f=input.files&&input.files[0];if(!f||!id)return;const safeName=String(personName||'Scholar').replace(/[\\/:*?"<>|]+/g,'').replace(/\s+/g,' ').trim();const ext=(f.name.match(/\.[A-Za-z0-9]+$/)||[''])[0].toLowerCase();const newName=id+'-'+safeName+(suffix?'-'+suffix:'')+(ext||'');try{const nf=new File([f],newName,{type:f.type,lastModified:f.lastModified});const dt=new DataTransfer();dt.items.add(nf);input.files=dt.files;let preview=input.parentElement?.querySelector('.db-file-rename-preview');if(!preview){preview=document.createElement('small');preview.className='db-file-rename-preview';input.insertAdjacentElement('afterend',preview)}preview.textContent='Will upload as: '+newName}catch(_){}})
  }

  function enhanceUpdateForm(){
    const modal=document.getElementById('db-submit-modal'),form=document.getElementById('db-submit-form');if(!modal||!form)return;
    const sid=inferOpenScholarId();if(sid)modal.dataset.scholarId=sid;const found=profileForOpenForm(sid,form);const p=found?.profile||{};
    if(form.dataset.scholarEnhanced==='1'){
      const set=(name,value)=>{const el=form.querySelector('[name="'+name+'"]');if(el&&el.type!=='file')el.value=value==null?'':String(value)};
      set('paternal_province',clean(p.paternalProvince));set('paternal_district',clean(p.paternalDistrict));set('paternal_village',clean(p.paternalVillage));set('paternal_island',clean(p.paternalIsland));
      set('maternal_province',clean(p.maternalProvince));set('maternal_district',clean(p.maternalDistrict));set('maternal_village',clean(p.maternalVillage));set('maternal_island',clean(p.maternalIsland));
      set('paternal_confederacy',PROV_CONF[clean(p.paternalProvince)]||clean(p.paternalConfederacy));set('maternal_confederacy',PROV_CONF[clean(p.maternalProvince)]||clean(p.maternalConfederacy));set('gender',p.gender||'');
      const master=p.masters||{},phd=p.phd||{};set('masters_university',master.university||p.mastersUniversity||'');set('masters_country',master.country||p.mastersCountry||'');set('masters_year',master.year||p.mastersYear||'');set('masters_thesis_url',master.url||'');
      set('phd_university',phd.university||p.phdUniversity||'');set('phd_country',phd.country||p.phdCountry||'');set('phd_year',phd.year||p.phdYear||'');set('phd_thesis_url',phd.url||'');
      form.querySelectorAll('input[type="file"]').forEach(el=>{el.value=''});form.dispatchEvent(new Event('scholar-form-ready'));return;
    }
    form.dataset.scholarEnhanced='1';
    const fieldsets=Array.from(form.querySelectorAll(':scope > fieldset'));const who=fieldsets.find(fs=>/who is submitting/i.test(fs.querySelector('legend')?.textContent||''));const scholar=fieldsets.find(fs=>/scholar profile/i.test(fs.querySelector('legend')?.textContent||''));const grad=fieldsets.find(fs=>/graduate studies/i.test(fs.querySelector('legend')?.textContent||''));
    if(who){who.insertAdjacentElement('afterend',geoFieldset('Paternal',p));who.nextElementSibling.insertAdjacentElement('afterend',geoFieldset('Maternal',p))}
    if(scholar){
      // Remove legacy village/paternal fields from Scholar profile because they now live in lineage-specific blocks.
      scholar.querySelectorAll('input,select').forEach(el=>{const n=(el.name||'').toLowerCase(),id=(el.id||'').toLowerCase();if(n==='village'||n==='paternal_province'||id==='db-sf-village'||id==='db-sf-paternal'){const holder=el.closest('div');if(holder)holder.remove()}});
      if(!scholar.querySelector('[name="gender"]')){const grid=scholar.querySelector('.grid')||scholar;const gender=selectInput('gender',[['','(select)'],['Male','Male'],['Female','Female'],['Other','Other'],['Prefer not to say','Prefer not to say']],p.gender||'');grid.appendChild(fieldWrap('Gender',gender))}
      // Never expose the internal image path/URL. Keep only a high-resolution JPEG upload.
      const photoUrl=scholar.querySelector('#db-sf-photo-url,[name="photo_url"],[name="profile_photo_url"]');if(photoUrl){const holder=photoUrl.closest('div');if(holder)holder.remove()}
      const existingPhotoFile=scholar.querySelector('input[type="file"][name*="photo" i]');if(existingPhotoFile){existingPhotoFile.accept='image/jpeg,.jpg,.jpeg';const lab=existingPhotoFile.closest('div')?.querySelector('label');if(lab)lab.textContent='High-resolution headshot (JPEG)';let note=existingPhotoFile.closest('div')?.querySelector('.upload-note');if(!note){note=document.createElement('small');note.className='upload-note';existingPhotoFile.insertAdjacentElement('afterend',note)}note.textContent='Please upload a clear, high-resolution headshot as a JPEG (.jpg or .jpeg).'}
    }
    if(grad){const masters=degreeFieldset('Masters',p),phd=degreeFieldset('PhD',p);grad.insertAdjacentElement('beforebegin',masters);masters.insertAdjacentElement('afterend',phd);grad.remove()}

    // Standardise upload filenames: ScholarID-First Last-<short label>.<ext>
    const name=(p.first&&p.last)?(p.first+' '+p.last):(document.querySelector('[data-direct-scholar] .db-scholar-card__name')?.textContent||document.querySelector('.db-scholar-card__name')?.textContent||'Scholar').replace(/^(Dr|Prof|Mr|Mrs|Ms)\.?\s+/i,'').trim();
    renameFileInput(form.querySelector('[name="masters_thesis_pdf"]'),'Masters',sid,name);renameFileInput(form.querySelector('[name="phd_thesis_pdf"]'),'PhD',sid,name);
    const cv=form.querySelector('input[type="file"][name*="cv" i]');renameFileInput(cv,'CV',sid,name);const photo=form.querySelector('input[type="file"][name*="photo" i]');renameFileInput(photo,'',sid,name);
    form.dispatchEvent(new Event('scholar-form-ready'));
  }

  function watchUpdateModal(){const modal=document.getElementById('db-submit-modal');if(!modal)return;const obs=new MutationObserver(()=>{if(modal.classList.contains('is-open')||modal.getAttribute('aria-hidden')==='false'||getComputedStyle(modal).display!=='none'){const sid=inferOpenScholarId();if(sid)modal.dataset.scholarId=sid;enhanceUpdateForm()}});obs.observe(modal,{attributes:true,attributeFilter:['class','style','aria-hidden']});document.addEventListener('click',ev=>{if(ev.target.closest('[data-submit-info]'))setTimeout(()=>{const sid=inferOpenScholarId();if(sid)modal.dataset.scholarId=sid;enhanceUpdateForm()},30)},true)}

  function init(){
    addStyles();scanCards();watchUpdateModal();const qs=new URLSearchParams(location.search),requestedP=qs.get('p'),directId=directCapabilityId();if(requestedP&&!directId){showInvalidDirectLink();return}
    const grid=document.querySelector('[data-db-leaders]');if(grid){const obs=new MutationObserver(()=>{scanCards();if(directId){const card=findCardForId(directId);if(card)enterDirectMode(card,directId)}});obs.observe(grid,{childList:true,subtree:true})}
    if(!directId)return;let attempts=0;const timer=setInterval(()=>{attempts+=1;requestTargetCard(directId);const card=findCardForId(directId);if(card){clearInterval(timer);enterDirectMode(card,directId)}else if(attempts>160)clearInterval(timer)},125);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
