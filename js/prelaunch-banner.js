/* Country dashboards: "Dashboard not yet launched" notice.
   Attached to the bottom of the floating panel menu so it stays on screen
   while the page scrolls, exactly like the menu. Remove this script tag to
   take the notice down at launch. */
(function () {
  'use strict';
  if (window.self !== window.top) return;
  var css = '.db-prelaunch{display:flex;align-items:center;justify-content:center;gap:14px;' +
    'background:#fde58a;color:#111;border-top:1px solid #e9c94f;border-bottom:1px solid #e3c043;' +
    'padding:9px 18px;font-family:Arial,Helvetica,sans-serif;font-size:13.5px;line-height:1.35;text-align:left}' +
    '.db-prelaunch__icon{flex:0 0 auto;width:26px;height:26px}' +
    '.db-prelaunch__sep{flex:0 0 auto;width:1px;align-self:stretch;background:rgba(0,0,0,.45)}' +
    '.db-prelaunch__title{flex:0 0 auto;font-weight:700;font-size:15px;letter-spacing:.01em;text-transform:uppercase;white-space:nowrap}' +
    '.db-prelaunch__msg{min-width:0}' +
    '[data-theme="dark"] .db-prelaunch{background:#fde58a;color:#111}';
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
      'Please do not share the weblink or screenshots publicly until it is officially launched.</span>';
    return bar;
  }

  function attach() {
    var nav = document.querySelector('.db-panel-menu');
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

  function start() {
    if (attach()) return;
    var tries = 0;
    var timer = setInterval(function () {
      if (attach() || ++tries > 50) clearInterval(timer);
    }, 100);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
