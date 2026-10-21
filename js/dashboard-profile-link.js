/* Opens one scholar's public dashboard profile when the page is opened with
   ?scholar=ID&explain=1&name=... . Used by the regional directory Share button.
   A normal visit, with no scholar id, is unchanged. */
(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  var id = String(params.get('scholar') || '').toUpperCase();
  if (!/^([A-Z]{2,4}-S)\d+$/.test(id) && !/^[A-Z]+-S\d+$/.test(id)) return;
  var explain = params.get('explain') === '1';
  var rawName = params.get('name') || '';

  function bare(v) {
    return String(v || '').replace(/\b(dr|mr|ms|prof|professor|sir)\.?\b/ig, ' ').replace(/\s+/g, ' ').trim();
  }

  function find() {
    var byId = document.querySelector('[data-scholar-id="' + id + '"]');
    if (byId) return byId;
    var want = bare(rawName).toLowerCase();
    if (!want) return null;
    var cards = document.querySelectorAll('[data-db-leaders] .db-scholar-card');
    for (var i = 0; i < cards.length; i++) {
      if ((cards[i].innerText || '').toLowerCase().indexOf(want) !== -1) return cards[i];
    }
    return null;
  }

  function expand(card) {
    if (!explain || !card) return false;
    var btn = card.querySelector('[data-insight-btn]');
    var panel = card.querySelector('[data-insight-panel]');
    if (!btn || btn.disabled) return false;
    if (btn.getAttribute('aria-expanded') !== 'true') btn.click();
    if (panel && btn.getAttribute('aria-expanded') !== 'true') {
      btn.setAttribute('aria-expanded', 'true');
      panel.hidden = false;
    }
    return btn.getAttribute('aria-expanded') === 'true';
  }

  var tries = 0;
  var stable = 0;
  var timer = setInterval(function () {
    tries += 1;
    var input = document.querySelector('[data-scholar-name-search]');
    var want = bare(rawName);
    var card = find();
    if (input && want && !card && input.value !== want) {
      input.value = want;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    card = find();
    if (card) {
      var header = document.querySelector('.site-header');
      var bar = document.querySelector('.db-panel-menu');
      var offset = 12;
      if (header) offset += header.getBoundingClientRect().height;
      if (bar) offset += bar.getBoundingClientRect().height;
      window.scrollTo({ top: Math.max(0, window.scrollY + card.getBoundingClientRect().top - offset), behavior: 'auto' });
      if (!explain || expand(card)) stable += 1;
      else stable = 0;
      if (stable >= 4) clearInterval(timer);
    } else stable = 0;
    if (tries > 45) clearInterval(timer);
  }, 400);
})();
