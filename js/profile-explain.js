/* Opens "Explain their research" on a country scholar profile.
   Used only by the profile link pages (s.html, s-tonga.html, s-solomon.html,
   s-vanuatu.html) when the link has explain=1. It does not change a profile
   opened any other way. */
(function () {
  'use strict';
  function cardOf(doc) {
    return doc.querySelector('.scholar-direct-main .db-scholar-card') || doc.querySelector('.db-scholar-card');
  }
  function expand(doc) {
    var card = cardOf(doc);
    if (!card) return false;
    var btn = card.querySelector('[data-insight-btn]');
    var panel = card.querySelector('[data-insight-panel]');
    if (!btn || !panel || btn.disabled) return false;
    if (btn.getAttribute('aria-expanded') !== 'true') btn.click();
    if (btn.getAttribute('aria-expanded') !== 'true') {
      btn.setAttribute('aria-expanded', 'true');
      panel.hidden = false;
    }
    return btn.getAttribute('aria-expanded') === 'true' && !panel.hidden;
  }
  function watch(frame) {
    if (new URLSearchParams(location.search).get('explain') !== '1' || !frame) return;
    var tries = 0;
    var stable = 0;
    var timer = setInterval(function () {
      tries += 1;
      var doc = null;
      try { doc = frame.contentDocument; } catch (e) { doc = null; }
      if (doc && expand(doc)) {
        var visible = frame.classList.contains('profile-ready') || getComputedStyle(frame).visibility !== 'hidden';
        if (visible) {
          var card = cardOf(doc);
          if (card) card.scrollIntoView({ block: 'start' });
          stable += 1;
        }
        // The profile page rebuilds the card once after it appears. Keep
        // reopening until the explanation has stayed open.
        if (stable >= 6) clearInterval(timer);
      } else stable = 0;
      if (tries > 40) clearInterval(timer);
    }, 500);
  }
  window.ProfileExplain = { watch: watch };
})();
