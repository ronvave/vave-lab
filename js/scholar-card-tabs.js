/* Restyles the "Explain their research" and "Positions" buttons on scholar cards
 * (country dashboards and the regional directory) into icon tabs with a count badge.
 * It only rewrites each button's inner markup; ids, data attributes and click handlers stay unchanged. */
(function () {
  'use strict';
  var ICON = {
    explain: '<svg viewBox="0 0 40 40" aria-hidden="true" focusable="false"><path fill="currentColor" d="M20 5 35 12.5 20 20 5 12.5Z"/><path fill="currentColor" opacity=".78" d="M8.6 17.3 20 23 31.4 17.3 35 19.1 20 26.6 5 19.1Z"/><path fill="currentColor" opacity=".58" d="M8.6 23.9 20 29.6 31.4 23.9 35 25.7 20 33.2 5 25.7Z"/></svg>',
    positions: '<svg viewBox="0 0 40 40" aria-hidden="true" focusable="false"><path fill="currentColor" d="M15 8h10a3 3 0 0 1 3 3v2h-3v-2H15v2h-3v-2a3 3 0 0 1 3-3Z"/><rect x="5" y="13" width="30" height="20" rx="4" fill="currentColor"/><rect x="5" y="20" width="30" height="2.4" fill="#fff" opacity=".35"/><rect x="17" y="18.5" width="6" height="5.5" rx="1.4" fill="#fff"/></svg>'
  };
  var CHEV = '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M5 7.5 10 12.5 15 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function isPositions(btn) {
    var l = btn.querySelector('.db-scholar-card__insight-btn-label');
    return btn.classList.contains('cpos-btn') || btn.classList.contains('psd-pos__btn') || /^\s*Positions\s*$/.test(l ? l.textContent : '');
  }
  function decorate(btn) {
    if (btn.getAttribute('data-sct') === '1') return;
    var label = btn.querySelector('.db-scholar-card__insight-btn-label');
    if (!label) return;
    var tag = btn.querySelector('.db-scholar-card__insight-btn-tag');
    var tagText = tag ? tag.textContent : '';
    var kind = isPositions(btn) ? 'positions' : 'explain';
    var count, meta = '', aria;
    if (kind === 'positions') {
      var m = tagText.match(/(\d+)/), c = tagText.match(/(\d+)\s*current/i);
      var total = m ? parseInt(m[1], 10) : 0, cur = c ? parseInt(c[1], 10) : 0;
      count = cur;
      meta = '(' + total + ' total | ' + cur + ' current)';
      aria = 'Positions: ' + total + ' total, ' + cur + ' current';
    } else {
      var panel = document.getElementById(btn.getAttribute('aria-controls') || '');
      var has = !!(panel && panel.querySelector('.db-scholar-card__insight-summary') && !panel.querySelector('.db-scholar-card__insight-summary--empty'));
      count = has ? 1 : 0;
      aria = 'Explain their research: ' + (has ? '1 AI-generated summary recorded' : 'no summary recorded yet');
    }
    var sub = kind === 'positions' ? 'Academic, professional, and leadership roles.' : 'AI-generated summary of their research focus, themes, and impact.';
    btn.classList.add('sct-btn', 'sct-btn--' + kind);
    btn.setAttribute('data-sct', '1');
    btn.setAttribute('aria-label', aria);
    btn.innerHTML =
      '<span class="sct-icon">' + ICON[kind] + '</span>' +
      '<span class="sct-text"><span class="sct-head"><span class="sct-title db-scholar-card__insight-btn-label">' + (kind === 'positions' ? 'Positions' : 'Explain their research') + '</span>' +
        (meta ? '<span class="sct-meta">' + meta + '</span>' : '') + '</span>' +
        '<span class="sct-sub">' + sub + '</span></span>' +
      '<span class="sct-count' + (count ? '' : ' is-zero') + '" aria-hidden="true">' + count + '</span>' +
      '<span class="sct-chev db-scholar-card__insight-btn-chev" aria-hidden="true">' + CHEV + '</span>';
  }
  function scan(root) {
    var list = (root && root.querySelectorAll ? root : document).querySelectorAll('.db-scholar-card__insight-btn:not([data-sct])');
    for (var i = 0; i < list.length; i++) decorate(list[i]);
  }
  var queued = false;
  function queue() { if (queued) return; queued = true; (window.requestAnimationFrame || setTimeout)(function () { queued = false; scan(document); }); }
  function start() {
    scan(document);
    if (window.MutationObserver) new MutationObserver(queue).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.ScholarCardTabs = { scan: scan };
})();
