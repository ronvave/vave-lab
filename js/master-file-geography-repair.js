/*
 * Master-file publication geography repair — 2026-09-13
 *
 * The authoritative Research Geography sheet is already exported to
 * master.geography and consumed by the adapter for B4/C2 membership. The
 * legacy publication-card renderer, however, only renders state.provincesByItem
 * and therefore never shows country-level geography (Hawaii, Papua New Guinea,
 * etc.) or a general/national Fiji row. This layer keeps the existing renderer
 * intact and adds the verified Master geography to publication cards.
 */
(function () {
  'use strict';

  function norm(s) {
    return String(s == null ? '' : s)
      .normalize('NFKC')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function isVerified(row) {
    var v = norm(row && row.Verification);
    return v.indexOf('verified') === 0 || v === 'strong';
  }

  function publicationKey(pub) {
    return String((pub && (pub['Publication ID / BibTeX Key'] || pub.key)) || '').trim();
  }

  function buildIndex(master) {
    var geoByKey = new Map();
    (master.geography || []).forEach(function (g) {
      if (!isVerified(g)) return;
      var key = String(g['Publication ID / BibTeX Key'] || '').trim();
      if (!key) return;
      if (!geoByKey.has(key)) geoByKey.set(key, []);
      geoByKey.get(key).push(g);
    });

    var byTitleYear = new Map();
    (master.publications || []).forEach(function (p) {
      var key = publicationKey(p);
      if (!key || !geoByKey.has(key)) return;
      var title = norm(p.Title || p.title);
      var year = String(p.Year || p.year || '').trim();
      if (!title) return;
      var idx = title + '||' + year;
      if (!byTitleYear.has(idx)) byTitleYear.set(idx, []);
      byTitleYear.get(idx).push({ key: key, rows: geoByKey.get(key), pub: p });
    });
    return { geoByKey: geoByKey, byTitleYear: byTitleYear };
  }

  function cardYear(card) {
    var meta = card.querySelector('.db-item__meta');
    if (!meta) return '';
    var m = String(meta.textContent || '').match(/\b(19|20)\d{2}\b/);
    return m ? m[0] : '';
  }

  function uniqueLocations(rows) {
    var out = [];
    var seen = new Set();
    (rows || []).forEach(function (g) {
      var country = String(g.Country || '').trim();
      var province = String(g['Fiji Province'] || '').trim();

      // Named Fiji province: show the province. General/national Fiji rows:
      // show Fiji. Non-Fiji rows: show the recorded country/location.
      var label = '';
      var kind = 'country';
      if (norm(country) === 'fiji') {
        if (province && norm(province) !== 'unclassified' && norm(province) !== 'unsure') {
          label = province;
          kind = 'province';
        } else {
          label = 'Fiji';
        }
      } else if (country) {
        label = country;
      }
      if (!label) return;
      var k = norm(label);
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ label: label, kind: kind });
    });
    return out;
  }

  function existingTagNames(card) {
    var set = new Set();
    card.querySelectorAll('.db-item__tags .db-item__badge').forEach(function (el) {
      set.add(norm(el.textContent));
    });
    return set;
  }

  function ensureTagHost(card) {
    var host = card.querySelector('.db-item__tags');
    if (host) return host;
    host = document.createElement('div');
    host.className = 'db-item__tags';
    var actions = card.querySelector('.db-item__actions');
    if (actions) card.insertBefore(host, actions);
    else card.appendChild(host);
    return host;
  }

  function annotateCards(master, index) {
    var cards = document.querySelectorAll('[data-db-items] .db-item:not(.db-item__empty)');
    cards.forEach(function (card) {
      // Rebuild on every render, but never duplicate within the same card.
      card.querySelectorAll('.mf-geo-location-tag').forEach(function (n) { n.remove(); });

      var titleEl = card.querySelector('.db-item__title');
      if (!titleEl) return;
      var title = norm(titleEl.textContent);
      var year = cardYear(card);
      var candidates = index.byTitleYear.get(title + '||' + year) || [];
      if (!candidates.length) {
        // Year can be absent in a few records; fall back to title only if it is
        // unambiguous in the Master publication table.
        var titleMatches = [];
        index.byTitleYear.forEach(function (arr, k) {
          if (k.indexOf(title + '||') === 0) titleMatches = titleMatches.concat(arr);
        });
        if (titleMatches.length === 1) candidates = titleMatches;
      }
      if (!candidates.length) return;

      var rows = [];
      candidates.forEach(function (c) { rows = rows.concat(c.rows || []); });
      var locations = uniqueLocations(rows);
      if (!locations.length) return;

      var host = ensureTagHost(card);
      var existing = existingTagNames(card);
      locations.forEach(function (loc) {
        if (existing.has(norm(loc.label))) return;
        var chip = document.createElement('span');
        chip.className = 'db-item__badge db-item__badge--tag mf-geo-location-tag';
        chip.setAttribute('data-mf-geo-location', loc.label);
        chip.title = loc.kind === 'province'
          ? 'Verified Fiji province where this research was undertaken'
          : 'Verified country/location where this research was undertaken';
        chip.textContent = '📍 ' + loc.label;
        host.insertBefore(chip, host.firstChild);
        existing.add(norm(loc.label));
      });
    });
  }

  function syncNamedFijiProvincesIntoState(master, index) {
    var st = window.__vavelabDbState;
    if (!st || !st.provincesByItem || typeof st.provincesByItem.get !== 'function') return;
    index.geoByKey.forEach(function (rows, key) {
      rows.forEach(function (g) {
        if (norm(g.Country) !== 'fiji') return;
        var province = String(g['Fiji Province'] || '').trim();
        if (!province || norm(province) === 'unclassified' || norm(province) === 'unsure') return;
        var set = st.provincesByItem.get(key);
        if (!set) {
          set = new Set();
          st.provincesByItem.set(key, set);
        }
        set.add(province);
      });
    });
  }

  function installStyles() {
    if (document.getElementById('mf-geography-repair-style')) return;
    var s = document.createElement('style');
    s.id = 'mf-geography-repair-style';
    s.textContent =
      '.mf-geo-location-tag{cursor:default!important;}' +
      '.mf-geo-location-tag:hover{transform:none!important;}';
    document.head.appendChild(s);
  }

  function boot() {
    var tries = 0;
    (function waitForMaster() {
      var st = window.__vavelabDbState;
      var master = st && st.master;
      if (!master || !Array.isArray(master.geography) || !Array.isArray(master.publications)) {
        if (++tries < 240) setTimeout(waitForMaster, 50);
        return;
      }

      installStyles();
      var index = buildIndex(master);
      syncNamedFijiProvincesIntoState(master, index);

      var scheduled = false;
      function applySoon() {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(function () {
          scheduled = false;
          annotateCards(master, index);
        });
      }

      applySoon();
      var list = document.querySelector('[data-db-items]');
      if (list) {
        new MutationObserver(applySoon).observe(list, { childList: true, subtree: true });
      }
      window.addEventListener('vavelab:filters-changed', applySoon);
      window.addEventListener('vavelab:master-hydrated', applySoon);

      window.MasterFileGeographyRepair = {
        refresh: applySoon,
        verifiedRows: Array.from(index.geoByKey.values()).reduce(function (a, b) { return a.concat(b); }, [])
      };
    })();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
