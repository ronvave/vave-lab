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
    'html.has-prelaunch body>iframe{height:calc(100dvh - var(--prelaunch-h,46px))!important}' +
    // Country dashboards: card in the empty left margin beside the panels.
    '.db-prelaunch--side{position:fixed;left:16px;z-index:4000;margin:0;box-sizing:border-box;flex-direction:column;align-items:flex-start;' +
    'justify-content:flex-start;gap:10px;padding:16px 15px;border:1px solid #e3c043;border-left:6px solid #d4a514;border-radius:10px;' +
    'box-shadow:0 6px 18px rgba(89,64,34,.16);font-size:13px;line-height:1.45;max-height:calc(100vh - 120px);overflow:auto}' +
    '.db-prelaunch--side .db-prelaunch__sep{display:none}' +
    '.db-prelaunch--side .db-prelaunch__icon{width:30px;height:30px}' +
    '.db-prelaunch--side .db-prelaunch__title{white-space:normal;font-size:15px;line-height:1.25;border-bottom:1px solid rgba(0,0,0,.35);padding-bottom:9px;width:100%}' +
    '.db-prelaunch--side .db-prelaunch__mail{font-size:12.5px}';
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
      '<span class="db-prelaunch__msg">This dashboard is in <span style="white-space:nowrap">pre-launch</span> preview for collaborators only. ' +
      'Please do not share the weblink or screenshots publicly until it is officially launched. ' +
      'For more information, contact ' +
      '<a class="db-prelaunch__mail" href="mailto:ronvave@hawaii.edu">ronvave@<wbr>hawaii.edu</a>.</span>';
    return bar;
  }

  // Country dashboards (.db-panel-menu): show the notice as a card in the
  // left margin when the window leaves enough room beside the panels;
  // otherwise fall back to the strip under the panel menu.
  var SIDE_MIN = 172; // px of free left margin needed for the card
  function attachSide(nav) {
    var bar = build();
    bar.classList.add('db-prelaunch--side');
    bar.hidden = true;
    document.body.appendChild(bar);
    var mode = '', lastTop = -1;
    function gutter() {
      // Left edge of the first visible panel (some panels are hidden until
      // a gate unlocks); otherwise the dashboard title in the page banner.
      var list = document.querySelectorAll('.panel-menu-target, .db-panel');
      for (var i = 0; i < list.length; i++) {
        var r = list[i].getBoundingClientRect();
        if (r.width > 0 && r.width < window.innerWidth - 40) return r.left;
      }
      var h = document.querySelector('.page-banner h1') || document.querySelector('.page-banner .container');
      return h ? h.getBoundingClientRect().left : 0;
    }
    function layout() {
      var g = gutter();
      var want = g >= SIDE_MIN ? 'side' : 'strip';
      if (want !== mode) {
        mode = want;
        if (want === 'side') {
          bar.classList.add('db-prelaunch--side'); bar.removeAttribute('style');
          document.body.appendChild(bar); lastTop = -1;
        } else {
          bar.classList.remove('db-prelaunch--side');
          var cs = getComputedStyle(nav);
          bar.removeAttribute('style');
          bar.style.margin = '8px -' + cs.paddingRight + ' -' + cs.paddingBottom + ' -' + cs.paddingLeft;
          nav.appendChild(bar);
        }
        bar.hidden = false;
        window.dispatchEvent(new Event('resize')); // let the menu re-measure
      }
      if (mode === 'side') bar.style.width = Math.min(200, Math.round(g - 32)) + 'px';
    }
    // Keep the card just below the floating menu, following it when the
    // site header folds away.
    var tick = 0;
    function follow() {
      if (++tick % 30 === 0) layout(); // re-check after gates unlock
      if (mode === 'side') {
        // Sit below the page banner on load, then rise to just under the menu.
        var pb = document.querySelector('.page-banner');
        var t = Math.round(Math.max(nav.getBoundingClientRect().bottom, pb ? pb.getBoundingClientRect().bottom : 0)) + 18;
        if (t !== lastTop) { lastTop = t; bar.style.top = t + 'px'; }
      }
      requestAnimationFrame(follow);
    }
    var pending = false;
    window.addEventListener('resize', function () {
      if (pending) return; pending = true;
      requestAnimationFrame(function () { pending = false; layout(); });
    });
    window.addEventListener('vavelab:master-hydrated', layout);
    layout();
    requestAnimationFrame(follow);
    return true;
  }

  function attach() {
    var nav = document.querySelector('.db-panel-menu, .ps-pmenu');
    if (!nav) return false;
    if (document.querySelector('.db-prelaunch')) return true;
    if (nav.classList.contains('db-panel-menu')) return attachSide(nav);
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
