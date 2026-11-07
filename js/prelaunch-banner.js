/* Country dashboards: "Dashboard not yet launched" notice.
   Attached to the bottom of the floating panel menu so it stays on screen
   while the page scrolls, exactly like the menu. Remove this script tag to
   take the notice down at launch. */
(function () {
  'use strict';
  if (window.self !== window.top) return;
  // Profile wrapper pages (s.html, s-*.html) load the script with
  // data-mode="top": the notice is fixed at the top of the window and the
  // embedded profile frame is shortened to sit below it.
  var me = document.currentScript;
  var topMode = !!(me && me.getAttribute('data-mode') === 'top');
  var css = '.db-prelaunch{display:flex;align-items:center;justify-content:center;gap:14px;' +
    'background:#fde58a;color:#111;border-top:1px solid #e9c94f;border-bottom:1px solid #e3c043;' +
    'padding:9px 18px;font-family:Arial,Helvetica,sans-serif;font-size:13.5px;line-height:1.35;text-align:left}' +
    '.db-prelaunch__icon{flex:0 0 auto;width:26px;height:26px}' +
    '.db-prelaunch__sep{flex:0 0 auto;width:1px;align-self:stretch;background:rgba(0,0,0,.45)}' +
    '.db-prelaunch__title{flex:0 0 auto;font-weight:700;font-size:15px;letter-spacing:.01em;text-transform:uppercase;white-space:nowrap}' +
    '.db-prelaunch__msg{min-width:0}' +
    '.db-prelaunch__mail{color:#0b3f8a;font-weight:700;text-decoration:underline}' +
    '.db-prelaunch__mail:hover{color:#062a5e}' +
    '[data-theme="dark"] .db-prelaunch{background:#fde58a;color:#111}' +
    '.db-prelaunch--top{position:fixed;top:0;left:0;right:0;z-index:2147483000;margin:0;box-sizing:border-box}' +
    'html.has-prelaunch body{box-sizing:border-box;padding-top:var(--prelaunch-h,46px)!important}' +
    'html.has-prelaunch body>iframe{height:calc(100dvh - var(--prelaunch-h,46px))!important}';
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  function build() {
    var bar = document.createElement('div');
    bar.className = 'db-prelaunch';
    bar.setAttribute('role', 'note');
    bar.setAttribute('aria-label', 'Dashboard not yet launched');
    bar.innerHTML =
      '<svg class="db-prelaunch__icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="#111" stroke-width="1.8" stroke-linejoin="round">' +
      '<path d="M12 3 22 20.5H2Z"/><path d="M12 9.5v5.2" stroke-linecap="round"/><circle cx="12" cy="17.4" r="1" fill="#111" stroke="none"/></svg>' +
      '<span class="db-prelaunch__sep" aria-hidden="true"></span>' +
      '<strong class="db-prelaunch__title">Dashboard not yet launched</strong>' +
      '<span class="db-prelaunch__sep" aria-hidden="true"></span>' +
      '<span class="db-prelaunch__msg">This dashboard is in pre-launch preview for collaborators only. ' +
      'Please do not share the weblink or screenshots publicly until it is officially launched. ' +
      'For more information, contact ' +
      '<a class="db-prelaunch__mail" href="mailto:ronvave@hawaii.edu">ronvave@hawaii.edu</a>.</span>';
    return bar;
  }

  function attach() {
    var nav = document.querySelector('.db-panel-menu, .ps-pmenu');
    if (!nav) return false;
    if (nav.querySelector('.db-prelaunch')) return true;
    var bar = build();
    var cs = getComputedStyle(nav);
    // Run edge to edge beneath the pills, cancelling the menu's own padding.
    bar.style.margin = '8px -' + cs.paddingRight + ' -' + cs.paddingBottom + ' -' + cs.paddingLeft;
    nav.appendChild(bar);
    // Let the menu re-measure its height (title spacing and scroll offsets).
    window.dispatchEvent(new Event('resize'));
    return true;
  }

  function attachTop() {
    var bar = document.querySelector('.db-prelaunch--top');
    if (!bar) { bar = build(); bar.classList.add('db-prelaunch--top'); }
    if (bar.parentNode !== document.body) document.body.insertBefore(bar, document.body.firstChild);
    document.documentElement.classList.add('has-prelaunch');
    document.documentElement.style.setProperty('--prelaunch-h', Math.ceil(bar.getBoundingClientRect().height) + 'px');
  }

  function start() {
    if (topMode) {
      attachTop();
      // The wrapper pages replace their body contents when the profile loads;
      // put the notice straight back if it is removed.
      new MutationObserver(function () {
        if (!document.querySelector('.db-prelaunch--top') || document.body.firstChild !== document.querySelector('.db-prelaunch--top')) attachTop();
      }).observe(document.body, { childList: true });
      window.addEventListener('resize', attachTop);
      return;
    }
    if (attach()) return;
    var tries = 0;
    var timer = setInterval(function () {
      if (attach() || ++tries > 50) clearInterval(timer);
    }, 100);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
